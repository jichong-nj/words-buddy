/**
 * 阅读理解练习：按「篇」抽题（每篇通常 4 道单选），判分与错题记录。
 * 会话复用 practice_session（mode='reading'），题目快照存 practice_item。
 */
import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { recordAttempt } from './mistakes.js';
import { loadSession } from './practice.js';

export const READING_MODE = 'reading';

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
  if (opts.tag) {
    p.tag = opts.tag;
    parts.push(`(','||tags||',') LIKE '%,' || @tag || ',%'`);
  }
  if (Number(opts.excludeRecentDays) > 0) {
    p.recent = `-${Math.floor(Number(opts.excludeRecentDays))} days`;
    parts.push(`id NOT IN (SELECT rp.passage_id FROM practice_item pi
                           JOIN practice_session ps ON ps.id=pi.session_id
                           JOIN reading_question rq ON rq.id=pi.reading_question_id
                           JOIN reading_passage rp ON rp.id=rq.passage_id
                           WHERE ps.mode='reading' AND ps.user_id=@userId
                             AND pi.asked_at >= datetime('now','localtime',@recent))`);
    p.userId = Number(opts.userId);
  }
  return { where: parts.join(' AND '), params: p };
}

/** 创建一次阅读练习：选 N 篇，每篇的题目全部出 */
export function createReadingSession(db, user, opts = {}) {
  const passagesWanted = Math.max(1, Math.min(10, Number(opts.passages) || 2));
  const e = eligible(db, { ...opts, userId: user.id });
  e.params.limit = passagesWanted;
  const passages = db.prepare(`
    SELECT * FROM reading_passage WHERE ${e.where} AND EXISTS (SELECT 1 FROM reading_question q WHERE q.passage_id=reading_passage.id)
    ORDER BY RANDOM() LIMIT @limit`).all(e.params);
  if (!passages.length) throw badRequest('no_questions', '当前筛选条件下没有阅读理解文章，请调整范围');

  const now = nowStr();
  const scope = {
    passages: passagesWanted, levels: opts.levels || null, topics: opts.topics || null,
    tag: opts.tag || null, excludeRecentDays: Number(opts.excludeRecentDays) || 0,
  };
  const ids = passages.map(p => p.id);
  const questions = db.prepare(`
    SELECT * FROM reading_question WHERE passage_id IN (${ids.map(() => '?').join(',')}) ORDER BY passage_id, seq`).all(...ids);

  const sess = db.prepare(`
    INSERT INTO practice_session(user_id,bank_id,mode,scope_json,total,status,started_at)
    VALUES(?,NULL,?,?,?, 'active', ?)`).run(user.id, READING_MODE, JSON.stringify(scope), questions.length, now);
  const sessionId = sess.lastInsertRowid;

  const ins = db.prepare(`
    INSERT INTO practice_item(session_id,seq,reading_question_id,question_type,stem_snapshot,answer_snapshot,
                              accepted_json,explain_snapshot,options_json,passage_title,passage_text,asked_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);

  const out = [];
  let seq = 0;
  db.transaction(() => {
    for (const p of passages) {
      const qs = [];
      for (const q of questions.filter(x => x.passage_id === p.id)) {
        seq += 1;
        const options = JSON.parse(q.options_json || '[]');
        const answerText = options[q.answer_index] ?? '';
        ins.run(sessionId, seq, q.id, READING_MODE, q.stem, answerText, JSON.stringify(options),
          q.explain, JSON.stringify(options), p.title, p.text, now);
        qs.push({ seq, questionId: q.id, stem: q.stem, options });
      }
      out.push({
        passageId: p.id, title: p.title, text: p.text, level: p.level || '', topic: p.topic || '',
        source: p.source || '', questions: qs,
      });
    }
  })();
  return { sessionId, mode: READING_MODE, total: seq, passages: out };
}

/** 判分：choice 传选项下标 0-3（也接受 A/B/C/D） */
export function answerReadingItem(db, user, sessionId, { seq, choice, latencyMs } = {}) {
  const s = loadSession(db, user, sessionId);
  if (s.mode !== READING_MODE) throw badRequest('wrong_mode', '这不是阅读理解练习');
  if (s.status !== 'active') throw conflict('finished', '该练习已结束');
  const item = db.prepare(`SELECT * FROM practice_item WHERE session_id=? AND seq=?`).get(sessionId, Number(seq));
  if (!item) throw notFound('题目不存在');
  if (item.is_correct !== null) throw conflict('already_answered', '该题已作答');

  const options = JSON.parse(item.options_json || '[]');
  let idx = -1;
  if (typeof choice === 'number' || /^\d+$/.test(String(choice))) idx = Number(choice);
  else if (/^[A-Da-d]$/.test(String(choice || ''))) idx = String(choice).toUpperCase().charCodeAt(0) - 65;
  if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) throw badRequest('bad_choice', '请选择一个选项');

  const answerText = item.answer_snapshot;
  const isCorrect = options[idx] === answerText;
  db.prepare(`UPDATE practice_item SET given=?, is_correct=?, latency_ms=?, answered_at=? WHERE id=?`)
    .run(String(idx), isCorrect ? 1 : 0, Number(latencyMs) || null, nowStr(), item.id);

  const answerIndex = options.findIndex(o => o === answerText);
  recordAttempt(db, user.id, {
    qtype: 'reading', refId: item.reading_question_id || 0, isCorrect,
    snapshot: {
      passageTitle: item.passage_title, passageText: item.passage_text,
      stem: item.stem_snapshot, options, answerIndex, answerText,
      explain: item.explain_snapshot || '',
    },
  });

  return {
    seq: item.seq,
    isCorrect,
    answerIndex,
    answerText,
    explain: item.explain_snapshot || '',
    options,
    chosenIndex: idx,
  };
}

/** 记录详情里阅读题的分组展示用 */
export function readingSessionDetail(db, sessionId) {
  const items = db.prepare(`
    SELECT pi.seq, pi.stem_snapshot AS stem, pi.options_json, pi.given, pi.is_correct AS isCorrect,
           pi.answer_snapshot AS answerText, pi.explain_snapshot AS explain,
           pi.passage_title AS passageTitle, pi.passage_text AS passageText,
           pi.latency_ms AS latencyMs, pi.answered_at AS answeredAt, pi.reading_question_id AS questionId
    FROM practice_item pi WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId);
  return items.map(i => {
    const options = JSON.parse(i.options_json || '[]');
    return {
      ...i,
      options,
      chosenIndex: i.given === null || i.given === '' ? null : Number(i.given),
      answerIndex: options.findIndex(o => o === i.answerText),
    };
  });
}
