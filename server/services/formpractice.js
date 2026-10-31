/**
 * 变形填空练习：抽题、判分、交卷。会话复用 practice_session（mode='form_fill'），
 * 题目快照存在 practice_item（word_id 为空，transform_id 指向题库）。
 */
import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, notFound, conflict, forbidden } from '../lib/errors.js';
import { normalizeAnswer, splitAlternatives } from './formbank.js';
import { loadSession } from './practice.js';
import { recordAttempt } from './mistakes.js';

export const FORM_MODE = 'form_fill';

export function formPoolSize(db) {
  return db.prepare(`SELECT COUNT(*) AS c FROM transform_item`).get().c;
}

/** 练习页展示用：可选范围与题量 */
export function formPools(db) {
  return {
    total: formPoolSize(db),
    mode: FORM_MODE,
    byPoint: db.prepare(`SELECT COALESCE(NULLIF(point,''),'（未标注）') AS point, COUNT(*) AS count
                         FROM transform_item GROUP BY point ORDER BY count DESC, point`).all(),
    byLevel: db.prepare(`SELECT COALESCE(NULLIF(level,''),'（未分级）') AS level, COUNT(*) AS count
                         FROM transform_item GROUP BY level ORDER BY count DESC, level`).all(),
    byTopic: db.prepare(`SELECT COALESCE(NULLIF(topic,''),'（未分类）') AS topic, COUNT(*) AS count
                        FROM transform_item GROUP BY topic ORDER BY count DESC, topic`).all(),
  };
}

function eligibleSql(opts) {
  const parts = ['1=1'];
  const p = {};
  if (opts.points?.length) {
    p.points = opts.points;
    parts.push(`COALESCE(NULLIF(point,''),'（未标注）') IN (${opts.points.map((_, i) => `@pt${i}`).join(',')})`);
    opts.points.forEach((v, i) => { p[`pt${i}`] = v; });
  }
  if (opts.levels?.length) {
    parts.push(`COALESCE(NULLIF(level,''),'（未分级）') IN (${opts.levels.map((_, i) => `@lv${i}`).join(',')})`);
    opts.levels.forEach((v, i) => { p[`lv${i}`] = v; });
  }
  if (opts.topics?.length) {
    parts.push(`COALESCE(NULLIF(topic,''),'（未分类）') IN (${opts.topics.map((_, i) => `@tp${i}`).join(',')})`);
    opts.topics.forEach((v, i) => { p[`tp${i}`] = v; });
  }
  if (opts.excludeRecentDays > 0) {
    p.recent = `-${Math.floor(Number(opts.excludeRecentDays))} days`;
    parts.push(`id NOT IN (SELECT ti.transform_id FROM practice_item ti
                           JOIN practice_session ps ON ps.id=ti.session_id
                           WHERE ps.mode='${FORM_MODE}' AND ps.user_id=@userId
                             AND ti.transform_id IS NOT NULL
                             AND ti.asked_at >= datetime('now','localtime',@recent))`);
    p.userId = Number(opts.userId);
  }
  return { where: parts.join(' AND '), params: p };
}

/** 创建一次变形填空练习 */
export function createFormSession(db, user, opts = {}) {
  const count = Math.max(1, Math.min(config.practice.maxPerSession, Number(opts.count) || 10));
  const e = eligibleSql({ ...opts, userId: user.id });
  e.params.limit = count;
  const rows = db.prepare(`
    SELECT * FROM transform_item WHERE ${e.where} ORDER BY RANDOM() LIMIT @limit`).all(e.params);
  if (!rows.length) throw badRequest('no_questions', '当前筛选条件下没有变形填空题目，请调整范围');

  const now = nowStr();
  const scope = {
    count, points: opts.points || null, levels: opts.levels || null,
    topics: opts.topics || null, excludeRecentDays: Number(opts.excludeRecentDays) || 0,
  };
  const sess = db.prepare(`
    INSERT INTO practice_session(user_id,bank_id,mode,scope_json,total,status,started_at)
    VALUES(?,NULL,?,?,?, 'active', ?)`).run(user.id, FORM_MODE, JSON.stringify(scope), rows.length, now);
  const sessionId = sess.lastInsertRowid;

  const ins = db.prepare(`
    INSERT INTO practice_item(session_id,seq,transform_id,question_type,stem_snapshot,answer_snapshot,
                              accepted_json,base_snapshot,point_snapshot,explain_snapshot,asked_at,
                              sentence_cn_snapshot,word_cn_snapshot)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const questions = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      const accepted = JSON.parse(r.accepted_json || '[]');
      ins.run(sessionId, i + 1, r.id, FORM_MODE, r.prompt, r.answer, JSON.stringify(accepted),
        r.base, r.point, r.explain, now, r.sentence_cn, r.word_cn);
      questions.push({
        seq: i + 1,
        prompt: r.prompt,
        base: r.base,
        // 出题阶段不返回 point（复数/比较级等考点），避免泄题；答完判分时再返回
        topic: r.topic || '',
        length: r.answer.length,
      });
    });
  })();
  return { sessionId, mode: FORM_MODE, total: questions.length, questions };
}

/** 判分：忽略大小写/首尾空格/句末标点，按 accepted 列表逐条比对 */
export function gradeAnswer(given, accepted) {
  const clean = normalizeAnswer(given);
  const list = (accepted || []).map(normalizeAnswer).filter(Boolean);
  return { clean, isCorrect: !!clean && list.includes(clean), accepted: list };
}

export function answerFormItem(db, user, sessionId, { seq, given, latencyMs } = {}) {
  const s = loadSession(db, user, sessionId);
  if (s.mode !== FORM_MODE) throw badRequest('wrong_mode', '这不是变形填空练习');
  if (s.status !== 'active') throw conflict('finished', '该练习已结束');
  const item = db.prepare(`SELECT * FROM practice_item WHERE session_id=? AND seq=?`).get(sessionId, Number(seq));
  if (!item) throw notFound('题目不存在');
  if (item.is_correct !== null) throw conflict('already_answered', '该题已作答');

  const accepted = JSON.parse(item.accepted_json || '[]');
  const { clean, isCorrect } = gradeAnswer(given, accepted);
  db.prepare(`UPDATE practice_item SET given=?, is_correct=?, latency_ms=?, answered_at=? WHERE id=?`)
    .run(String(given ?? '').trim(), isCorrect ? 1 : 0, Number(latencyMs) || null, nowStr(), item.id);
  if (item.transform_id) {
    recordAttempt(db, user.id, {
      qtype: 'form', refId: item.transform_id, isCorrect,
      snapshot: {
        prompt: item.stem_snapshot, base: item.base_snapshot, answer: item.answer_snapshot,
        point: item.point_snapshot || '', explain: item.explain_snapshot || '',
        sentenceCn: item.sentence_cn_snapshot || '', wordCn: item.word_cn_snapshot || '',
      },
    });
  }
  return {
    seq: item.seq,
    isCorrect,
    answer: item.answer_snapshot,
    accepted,
    base: item.base_snapshot,
    point: item.point_snapshot || '',
    explain: item.explain_snapshot || '',
    prompt: item.stem_snapshot,
    // 作答后展示：填好答案的完整句、整句中文意思、原型词中文意思
    filled: String(item.stem_snapshot || '').replace(/_{2,}/, item.answer_snapshot),
    sentenceCn: item.sentence_cn_snapshot || '',
    wordCn: item.word_cn_snapshot || '',
  };
}

/** 变形填空的会话明细（与释义填空同一个 /api/practice/sessions/:id 接口返回） */
export function formSessionItems(db, sessionId) {
  return db.prepare(`
    SELECT pi.seq, pi.stem_snapshot AS prompt, pi.base_snapshot AS base,
           pi.given, pi.is_correct AS isCorrect, pi.answer_snapshot AS answer,
           pi.accepted_json AS accepted, pi.point_snapshot AS point,
           pi.explain_snapshot AS explain, pi.latency_ms AS latencyMs, pi.answered_at AS answeredAt
    FROM practice_item pi WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId)
    .map(i => ({ ...i, accepted: JSON.parse(i.accepted || '[]') }));
}
