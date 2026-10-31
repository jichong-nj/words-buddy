import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js';
import { applyMastery, masterySummary } from './mastery.js';
import { recordAttempt } from './mistakes.js';
import { readingSessionDetail } from './readingpractice.js';
import { shadowSessionItems } from './shadowpractice.js';

const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 常见变形：在题干里一并打码，避免 painter 的释义里出现 paints 泄答案 */
export function inflections(word) {
  const w = String(word).toLowerCase().trim();
  if (!w) return [];
  const set = new Set([w]);
  const last = w[w.length - 1];

  // 复数 / 三单
  if (/(s|x|z|ch|sh)$/.test(w)) set.add(w + 'es');
  else if (/[^aeiou]y$/.test(w)) set.add(w.slice(0, -1) + 'ies');
  else set.add(w + 's');

  // 过去式 / 过去分词
  set.add(last === 'e' ? w + 'd' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ied' : w + 'ed');
  // 现在分词
  set.add(last === 'e' ? w.slice(0, -1) + 'ing' : w + 'ing');
  // 比较级 / 最高级
  set.add(last === 'e' ? w + 'r' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ied' : w + 'er');
  set.add(last === 'e' ? w + 'st' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'iest' : w + 'est');
  return [...set].filter(Boolean);
}

/**
 * 生成题干：把答案词及其常见变形在英文释义中打码成「首字母 + 下划线」。
 * 释义中若不含答案词，则原样返回（学生纯靠释义回忆单词）。
 */
export function buildStem(word, defEn) {
  const forms = inflections(word);
  const re = new RegExp(`\\b(${forms.map(escapeRe).join('|')})\\b`, 'gi');
  let masked = false;
  const stem = String(defEn).replace(re, m => {
    masked = true;
    return m[0] + '_'.repeat(Math.max(1, m.length - 1));
  });
  return { stem, masked };
}

export function buildHint(word) {
  const w = String(word).trim();
  return w[0] + '_'.repeat(Math.max(1, w.length - 1));
}

function normalizeOpts(opts) {
  const minLen = Math.max(1, Number(opts.minLen) || config.practice.minLen);
  const maxLen = Math.min(30, Number(opts.maxLen) || config.practice.maxLen);
  const count = Math.max(1, Math.min(config.practice.maxPerSession, Number(opts.count) || 20));
  return { ...opts, minLen, maxLen, count };
}

/**
 * 可出题义项的筛选条件。全部使用命名参数，便于 LIMIT 与 IN 混用。
 * 返回 { sql, params }
 */
function eligible(opts) {
  const parts = [
    'w.bank_id = @bankId',
    's.def_en IS NOT NULL',
    'length(trim(s.def_en)) >= 8',
    'w.word NOT LIKE \'% %\'',
    "w.word GLOB '[A-Za-z]*'",
    "w.word NOT GLOB '*[^A-Za-z]*'",
    'length(w.word) BETWEEN @minLen AND @maxLen',
  ];
  const params = { bankId: Number(opts.bankId), minLen: opts.minLen, maxLen: opts.maxLen };

  if (opts.topics?.length) {
    const keys = opts.topics.map((t, i) => { params[`tp${i}`] = t; return `@tp${i}`; });
    parts.push(`w.topic IN (${keys.join(',')})`);
  }
  (opts.tags || []).forEach((t, i) => {
    const k = `tg${i}`; params[k] = t;
    parts.push(`(','||w.tags||',') LIKE '%,' || @${k} || ',%'`);
  });
  if (opts.wordIds?.length) {
    const keys = opts.wordIds.map((id, i) => { params[`wi${i}`] = Number(id); return `@wi${i}`; });
    parts.push(`w.id IN (${keys.join(',')})`);
  }
  if (opts.bands?.length) {
    params.userId = Number(opts.userId);
    const keys = opts.bands.map((b, i) => { params[`bd${i}`] = b; return `@bd${i}`; });
    const hasNew = opts.bands.includes('new');
    const inBand = `m.band IN (${keys.join(',')})`;
    parts.push(hasNew ? `(m.band IS NULL OR ${inBand})` : `(${inBand})`);
  }
  if (Number(opts.excludeRecentDays) > 0) {
    params.userId = Number(opts.userId);
    params.recent = `-${Math.floor(Number(opts.excludeRecentDays))} days`;
    parts.push(`w.id NOT IN (SELECT pi.word_id FROM practice_item pi
                             JOIN practice_session ps ON ps.id=pi.session_id
                             WHERE ps.user_id=@userId AND pi.answered_at >= datetime('now','localtime',@recent))`);
  }
  const joinBand = opts.bands?.length ? 'LEFT JOIN word_mastery m ON m.word_id=w.id AND m.user_id=@userId' : '';
  return { sql: parts.join(' AND '), params, joinBand };
}

/** 某词库可出题的义项数 */
export function poolStats(db, userId, bankId) {
  const o = normalizeOpts({ bankId, userId, minLen: config.practice.minLen, maxLen: config.practice.maxLen });
  const e = eligible(o);
  // 一个词可能有多个义项都满足条件，这里按「可出题的单词数」去重统计
  const total = db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS c FROM word w
    JOIN word_sense s ON s.word_id = w.id
    ${e.joinBand}
    WHERE ${e.sql}`).get(e.params).c;
  const bank = db.prepare(`SELECT id,name,level FROM word_bank WHERE id=?`).get(bankId);
  const { byBand } = masterySummary(db, userId, bankId);
  return { bankId, bankName: bank?.name, level: bank?.level, total, answerable: total, byBand };
}

export function listPools(db, userId) {
  const banks = db.prepare(`SELECT id,name,level FROM word_bank WHERE status='active' ORDER BY id`).all();
  return banks.map(b => poolStats(db, userId, b.id));
}

/** 创建一次练习会话：题目与答案只留在服务端 */
export function createSession(db, user, opts) {
  const o = normalizeOpts(opts);
  if (!o.bankId) throw badRequest('no_bank', '请选择词库');
  const bank = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(o.bankId);
  if (!bank) throw notFound('词库不存在');

  const e = eligible({ ...o, userId: user.id });
  e.params.limit = o.count;
  const rows = db.prepare(`
    SELECT w.id AS word_id, w.word, w.topic, s.id AS sense_id, s.def_en, s.pos
    FROM word w
    JOIN word_sense s ON s.word_id = w.id
    ${e.joinBand}
    WHERE ${e.sql}
    GROUP BY w.id
    ORDER BY RANDOM() LIMIT @limit`).all(e.params);

  if (!rows.length) {
    throw badRequest('no_questions', '该范围内没有可出题的单词（需要英文释义，且单词长度在设定范围内）');
  }

  const now = nowStr();
  const scope = {
    bankId: o.bankId, count: o.count, topics: o.topics || null, tags: o.tags || null,
    bands: o.bands || null, wordIds: o.wordIds || null, minLen: o.minLen, maxLen: o.maxLen,
    excludeRecentDays: o.excludeRecentDays || 0,
  };
  const sess = db.prepare(`
    INSERT INTO practice_session(user_id,bank_id,mode,scope_json,total,status,started_at)
    VALUES(?,?, 'definition_fill', ?,?, 'active', ?)`)
    .run(user.id, o.bankId, JSON.stringify(scope), rows.length, now);
  const sessionId = sess.lastInsertRowid;

  const ins = db.prepare(`
    INSERT INTO practice_item(session_id,seq,word_id,sense_id,question_type,stem_snapshot,answer_snapshot,accepted_json,asked_at)
    VALUES(?,?,?,?, 'definition_fill', ?,?,?,?)`);
  const questions = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      const { stem, masked } = buildStem(r.word, r.def_en);
      ins.run(sessionId, i + 1, r.word_id, r.sense_id, stem, r.word, JSON.stringify([r.word.toLowerCase()]), now);
      questions.push({
        seq: i + 1, stem, hint: buildHint(r.word), length: r.word.length,
        topic: r.topic, mainPos: r.pos, masked: !!masked,
      });
    });
  })();

  return { sessionId, total: questions.length, questions };
}

export function loadSession(db, user, sessionId) {
  const s = db.prepare(`SELECT * FROM practice_session WHERE id=?`).get(sessionId);
  if (!s) throw notFound('练习会话不存在');
  if (user.role !== 'admin' && s.user_id !== user.id) throw forbidden('只能操作自己的练习记录');
  return s;
}

/** 服务端判分：忽略大小写与首尾空格，严格原形匹配 */
export function answerItem(db, user, sessionId, { seq, given, latencyMs }) {
  const s = loadSession(db, user, sessionId);
  if (s.status !== 'active') throw conflict('finished', '该练习已结束');
  const item = db.prepare(`SELECT * FROM practice_item WHERE session_id=? AND seq=?`).get(sessionId, Number(seq));
  if (!item) throw notFound('题目不存在');
  if (item.is_correct !== null) throw conflict('already_answered', '该题已作答');

  const accepted = JSON.parse(item.accepted_json || '[]');
  const clean = String(given ?? '').trim().toLowerCase();
  const isCorrect = !!clean && accepted.includes(clean);
  db.prepare(`UPDATE practice_item SET given=?, is_correct=?, latency_ms=?, answered_at=? WHERE id=?`)
    .run(String(given ?? '').trim(), isCorrect ? 1 : 0, Number(latencyMs) || null, nowStr(), item.id);
  const mastery = applyMastery(db, s.user_id, item.word_id, isCorrect);
  if (item.word_id) {
    const w = db.prepare(`SELECT s.def_cn AS defCn, s.pos FROM word w
                          LEFT JOIN word_sense s ON s.word_id=w.id AND s.sort=1 WHERE w.id=?`).get(item.word_id);
    recordAttempt(db, s.user_id, {
      qtype: 'definition', refId: item.word_id, isCorrect,
      snapshot: {
        word: item.answer_snapshot, stem: item.stem_snapshot,
        defCn: w?.defCn || '', pos: w?.pos || '', answer: item.answer_snapshot,
      },
    });
  }
  return { seq: item.seq, isCorrect, answer: item.answer_snapshot, accepted, stem: item.stem_snapshot, mastery };
}

export function finishSession(db, user, sessionId) {
  const s = loadSession(db, user, sessionId);
  if (s.status === 'finished') {
    return { sessionId, total: s.total, correct: s.correct, score: s.score, durationMs: s.duration_ms };
  }
  const agg = db.prepare(`
    SELECT COUNT(*) AS answered, COALESCE(SUM(is_correct),0) AS correct
    FROM practice_item WHERE session_id=? AND is_correct IS NOT NULL`).get(sessionId);
  const score = s.total ? Math.round((agg.correct / s.total) * 100) : 0;
  const started = new Date(String(s.started_at).replace(' ', 'T')).getTime();
  const duration = Math.max(0, Math.round(Date.now() - started));
  db.prepare(`UPDATE practice_session SET correct=?, score=?, duration_ms=?, status='finished', finished_at=? WHERE id=?`)
    .run(agg.correct, score, duration, nowStr(), sessionId);
  return { sessionId, total: s.total, correct: agg.correct, score, durationMs: duration };
}

export function getSessionDetail(db, user, sessionId) {
  const s = loadSession(db, user, sessionId);
  const bank = s.bank_id ? db.prepare(`SELECT name FROM word_bank WHERE id=?`).get(s.bank_id) : null;
  if (s.mode === 'reading' || s.mode === 'shadowing') {
    return {
      session: {
        id: s.id, bankId: s.bank_id, bankName: bank?.name || null, mode: s.mode, total: s.total,
        correct: s.correct, score: s.score, startedAt: s.started_at, finishedAt: s.finished_at,
        durationMs: s.duration_ms, status: s.status, userId: s.user_id,
      },
      items: s.mode === 'reading' ? readingSessionDetail(db, sessionId) : shadowSessionItems(db, sessionId),
    };
  }
  const isForm = s.mode === 'form_fill';
  const items = isForm
    ? db.prepare(`
        SELECT pi.seq, pi.stem_snapshot AS prompt, pi.base_snapshot AS base,
               pi.given, pi.is_correct AS isCorrect, pi.answer_snapshot AS answer,
               pi.accepted_json AS accepted, pi.point_snapshot AS point,
               pi.explain_snapshot AS explain, pi.latency_ms AS latencyMs, pi.answered_at AS answeredAt,
               pi.sentence_cn_snapshot AS sentenceCn, pi.word_cn_snapshot AS wordCn
        FROM practice_item pi WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId)
    : db.prepare(`
        SELECT pi.seq, pi.stem_snapshot AS stem, pi.given, pi.is_correct AS isCorrect,
               pi.answer_snapshot AS answer, pi.accepted_json AS accepted, pi.latency_ms AS latencyMs,
               pi.answered_at AS answeredAt, w.word, s.def_en AS defEn, s.pos
        FROM practice_item pi LEFT JOIN word w ON w.id=pi.word_id
        LEFT JOIN word_sense s ON s.id=pi.sense_id
        WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId);
  return {
    session: {
      id: s.id, bankId: s.bank_id, bankName: bank?.name || null, mode: s.mode, total: s.total,
      correct: s.correct, score: s.score, startedAt: s.started_at, finishedAt: s.finished_at,
      durationMs: s.duration_ms, status: s.status, userId: s.user_id,
    },
    items: items.map(i => ({ ...i, accepted: JSON.parse(i.accepted || '[]') })),
  };
}

export function listSessions(db, user, { page = 1, size = 20, bankId = null, userId = null, mode = null } = {}) {
  const p = { size: Number(size), off: (Number(page) - 1) * Number(size) };
  p.uid = (user.role === 'admin' && userId) ? Number(userId) : user.id;
  const where = ['s.user_id=@uid'];
  if (bankId) { p.bid = Number(bankId); where.push('s.bank_id=@bid'); }
  if (mode) { p.mode = mode; where.push('s.mode=@mode'); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM practice_session s WHERE ${where.join(' AND ')}`).get(p).c;
  const items = db.prepare(`
    SELECT s.id, s.bank_id AS bankId, b.name AS bankName, s.mode, s.total, s.correct, s.score,
           s.started_at AS startedAt, s.finished_at AS finishedAt, s.status, u.username AS username
    FROM practice_session s LEFT JOIN word_bank b ON b.id=s.bank_id
    LEFT JOIN app_user u ON u.id=s.user_id
    WHERE ${where.join(' AND ')} ORDER BY s.id DESC LIMIT @size OFFSET @off`).all(p);
  return { total, page: Number(page), size: Number(size), items };
}
