/**
 * 听写练习（dictation）：抽句、逐词判分、重试计数。
 *
 * 判分口径（与参考产品一致）：
 * - 首次提交决定对错（写入 is_correct / first_correct，统计只用这个）
 * - 之后允许重试改错：attempts 累加，不改统计
 * - diff 不泄露写错/漏掉的词，只回显学生自己打的词和空槽
 */
import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { loadSession } from './practice.js';

export const DICTATION_MODE = 'dictation';
/** 连续尝试到这个次数后解锁逐词解析（词性/音标/释义） */
export const ANALYSIS_ATTEMPTS = 3;

/** 归一化成小写词序列：去标点、统一空白、保留词内连字符与撇号 */
export function words(text) {
  return String(text ?? '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * 逐词对齐（LCS）：返回 [{status,expected,got}]
 * status: correct | wrong | missing | extra
 */
export function diffWords(expectedText, givenText) {
  const E = words(expectedText);
  const G = words(givenText);
  const n = E.length;
  const m = G.length;
  const dp = Array.from({ length: n + 1 }, () => new Int16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = E[i] === G[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (E[i] === G[j]) {
      ops.push({ status: 'correct', expected: E[i], got: G[j] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ status: 'missing', expected: E[i], got: '' });
      i++;
    } else {
      ops.push({ status: 'extra', expected: '', got: G[j] });
      j++;
    }
  }
  while (i < n) { ops.push({ status: 'missing', expected: E[i], got: '' }); i++; }
  while (j < m) { ops.push({ status: 'extra', expected: '', got: G[j] }); j++; }

  // 相邻的「漏一个 + 多一个」视为写错：status=wrong，显示学生写的词
  for (let k = 0; k < ops.length - 1; k++) {
    const a = ops[k];
    const b = ops[k + 1];
    if ((a.status === 'missing' && b.status === 'extra') || (a.status === 'extra' && b.status === 'missing')) {
      ops.splice(k, 2, { status: 'wrong', expected: a.expected || b.expected, got: a.got || b.got });
      k--;
    }
  }
  const correct = ops.length === n && ops.every(o => o.status === 'correct');
  return { ops, correct, wordCount: n, typedCount: m };
}

/** 练习池统计 */
export function dictationPools(db) {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM dictation_item`).get().c;
  return {
    total,
    mode: DICTATION_MODE,
    analysisAttempts: ANALYSIS_ATTEMPTS,
    byLevel: db.prepare(`SELECT COALESCE(NULLIF(level,''),'（未分级）') AS level, COUNT(*) AS count
                         FROM dictation_item GROUP BY level ORDER BY count DESC`).all(),
    byTopic: db.prepare(`SELECT COALESCE(NULLIF(topic,''),'（未分类）') AS topic, COUNT(*) AS count
                         FROM dictation_item GROUP BY topic ORDER BY count DESC`).all(),
  };
}

function eligible(db, opts) {
  const parts = ['1=1'];
  const p = {};
  if (opts.levels?.length) {
    parts.push(`COALESCE(NULLIF(level,''),'（未分级）') IN (${opts.levels.map((_, i) => `@lv${i}`).join(',')})`);
    opts.levels.forEach((v, i) => { p[`lv${i}`] = v; });
  }
  if (opts.topics?.length) {
    parts.push(`COALESCE(NULLIF(topic,''),'（未分类）') IN (${opts.topics.map((_, i) => `@tp${i}`).join(',')})`);
    opts.topics.forEach((v, i) => { p[`tp${i}`] = v; });
  }
  if (opts.bankId) {
    // 只抽该词库里出现过的句子（按 source 里的 bank 标记不可靠，这里用句子包含词库单词近似）
    p.bankId = Number(opts.bankId);
    parts.push(`id IN (SELECT di.id FROM dictation_item di JOIN word w
                       ON instr(' '||lower(di.sentence_en)||' ', ' '||lower(w.word)||' ') > 0
                       WHERE w.bank_id=@bankId)`);
  }
  if (Number(opts.excludeRecentDays) > 0) {
    p.recent = `-${Math.floor(Number(opts.excludeRecentDays))} days`;
    parts.push(`id NOT IN (SELECT pi.dictation_id FROM practice_item pi
                           JOIN practice_session ps ON ps.id=pi.session_id
                           WHERE ps.mode='dictation' AND ps.user_id=@userId
                             AND pi.dictation_id IS NOT NULL
                             AND pi.asked_at >= datetime('now','localtime',@recent))`);
    p.userId = Number(opts.userId);
  }
  return { where: parts.join(' AND '), params: p };
}

/** 创建一次听写练习：返回题面（不含英文原句，避免泄题；音频走 /api/dictation/audio/:itemId） */
export function createDictationSession(db, user, opts = {}) {
  const count = Math.max(1, Math.min(config.practice.maxPerSession, Number(opts.count) || 10));
  const e = eligible(db, { ...opts, userId: user.id });
  e.params.limit = count;
  const rows = db.prepare(`SELECT * FROM dictation_item WHERE ${e.where} ORDER BY RANDOM() LIMIT @limit`).all(e.params);
  if (!rows.length) throw badRequest('no_questions', '当前筛选条件下没有听写题目，请调整范围');

  const now = nowStr();
  const sess = db.prepare(`
    INSERT INTO practice_session(user_id,bank_id,mode,scope_json,total,status,started_at)
    VALUES(?,NULL,?,?,?,'active',?)`).run(
    user.id, DICTATION_MODE,
    JSON.stringify({ count, levels: opts.levels || null, topics: opts.topics || null, excludeRecentDays: Number(opts.excludeRecentDays) || 0 }),
    rows.length, now,
  );
  const sessionId = sess.lastInsertRowid;
  const ins = db.prepare(`
    INSERT INTO practice_item(session_id,seq,dictation_id,question_type,stem_snapshot,answer_snapshot,asked_at)
    VALUES(?,?,?, 'dictation', ?,?,?)`);
  const questions = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      ins.run(sessionId, i + 1, r.id, r.sentence_cn || '', r.sentence_en, now);
      questions.push({
        seq: i + 1,
        prompt: r.sentence_cn || '',
        wordCount: words(r.sentence_en).length,
        level: r.level || '',
        topic: r.topic || '',
        audio: `/api/dictation/audio/${r.id}`,
      });
    });
  })();
  return { sessionId, mode: DICTATION_MODE, total: questions.length, analysisAttempts: ANALYSIS_ATTEMPTS, questions };
}

function parseTokens(row) {
  try {
    const t = JSON.parse(row.tokens_json || '[]');
    return Array.isArray(t) ? t : [];
  } catch { return []; }
}

/**
 * 提交一次听写。
 * @returns {{seq,correct,diff,attempts,firstCorrect,unlockedAnswer,reveal,analysis}}
 *   correct=true 时 reveal 含完整答案与逐词解析；错误时只回显学生打的词/空槽，不泄露答案
 */
export function submitDictation(db, user, sessionId, { seq, given, latencyMs } = {}) {
  const s = loadSession(db, user, sessionId);
  if (s.mode !== DICTATION_MODE) throw badRequest('wrong_mode', '这不是听写练习');
  if (s.status !== 'active') throw conflict('finished', '该练习已结束');
  const item = db.prepare(`SELECT * FROM practice_item WHERE session_id=? AND seq=?`).get(sessionId, Number(seq));
  if (!item) throw notFound('题目不存在');

  const row = db.prepare(`SELECT * FROM dictation_item WHERE id=?`).get(item.dictation_id);
  if (!row) throw notFound('听写题目已被删除');

  const first = (item.attempts || 0) === 0;
  const attempts = (item.attempts || 0) + 1;
  const diff = diffWords(row.sentence_en, given);
  const correct = diff.correct;

  if (first) {
    db.prepare(`UPDATE practice_item SET given=?, diff_json=?, attempts=?, first_correct=?, is_correct=?,
                  latency_ms=?, answered_at=? WHERE id=?`)
      .run(String(given ?? '').trim(), JSON.stringify(diff.ops), attempts, correct ? 1 : 0, correct ? 1 : 0,
        Number(latencyMs) || null, nowStr(), item.id);
  } else {
    // 重试：只更新过程数据，不改统计（is_correct 保持首次结果）
    db.prepare(`UPDATE practice_item SET given=?, diff_json=?, attempts=?, answered_at=? WHERE id=?`)
      .run(String(given ?? '').trim(), JSON.stringify(diff.ops), attempts, nowStr(), item.id);
  }

  const unlocked = correct || attempts >= ANALYSIS_ATTEMPTS;
  const tokens = parseTokens(row);
  return {
    seq: item.seq,
    correct,
    diff: diff.ops,
    attempts,
    firstCorrect: first ? correct : !!item.first_correct,
    unlockedAnswer: unlocked,
    // 只有答对或达到尝试上限才展示完整英文/中文/逐词解析
    reveal: unlocked ? {
      sentence: row.sentence_en,
      sentenceCn: row.sentence_cn || '',
      tokens,
      grammarLabel: row.grammar_label || '',
      analysis: row.analysis || '',
    } : null,
  };
}

/** 记录详情里听写题的分组数据 */
export function dictationSessionDetail(db, sessionId) {
  return db.prepare(`
    SELECT pi.seq, pi.stem_snapshot AS sentenceCn, pi.answer_snapshot AS sentence,
           pi.given, pi.is_correct AS isCorrect, pi.first_correct AS firstCorrect,
           pi.diff_json AS diff, pi.attempts, pi.latency_ms AS latencyMs, pi.answered_at AS answeredAt,
           pi.dictation_id AS itemId
    FROM practice_item pi WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId)
    .map(r => ({ ...r, diff: (() => { try { return JSON.parse(r.diff || '[]'); } catch { return []; } })() }));
}
