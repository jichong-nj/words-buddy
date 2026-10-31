import { nowStr } from '../db/index.js';
import { notFound } from '../lib/errors.js';
import { BANDS } from './mastery.js';

export function overview(db, userId) {
  // 跟读练习没有对错：计入练习次数与时长，但不计入题数与正确率
  const sess = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_ms),0) AS ms
    FROM practice_session WHERE user_id=? AND status='finished'`).get(userId);
  const scored = db.prepare(`
    SELECT COALESCE(SUM(total),0) AS items, COALESCE(SUM(correct),0) AS correct
    FROM practice_session WHERE user_id=? AND status='finished' AND mode<>'shadowing'`).get(userId);
  const shadow = db.prepare(`
    SELECT COUNT(*) AS sessions, COALESCE(AVG(score),0) AS avg
    FROM practice_session WHERE user_id=? AND status='finished' AND mode='shadowing'`).get(userId);
  const today = db.prepare(`
    SELECT COUNT(*) AS answered, COALESCE(SUM(pi.is_correct),0) AS correct
    FROM practice_item pi JOIN practice_session ps ON ps.id=pi.session_id
    WHERE ps.user_id=? AND pi.is_correct IS NOT NULL
      AND date(pi.answered_at) = date('now','localtime')`).get(userId);
  const learned = db.prepare(`
    SELECT COUNT(*) AS c FROM word_mastery WHERE user_id=? AND attempts>0`).get(userId).c;
  const bands = db.prepare(`SELECT band, COUNT(*) AS c FROM word_mastery WHERE user_id=? GROUP BY band`).all(userId);
  const byBand = Object.fromEntries(BANDS.map(b => [b.band, 0]));
  for (const b of bands) if (byBand[b.band] !== undefined) byBand[b.band] = b.c;
  const totalWords = db.prepare(`SELECT COALESCE(SUM(word_count),0) AS c FROM word_bank WHERE status='active'`).get().c;
  const days = db.prepare(`
    SELECT COUNT(DISTINCT date(pi.answered_at)) AS c FROM practice_item pi
    JOIN practice_session ps ON ps.id=pi.session_id
    WHERE ps.user_id=? AND pi.is_correct IS NOT NULL`).get(userId).c;

  return {
    sessions: sess.sessions,
    itemsAnswered: scored.items,
    accuracy: scored.items ? Math.round((scored.correct / scored.items) * 100) : 0,
    studyMs: sess.ms,
    shadowSessions: shadow.sessions,
    shadowAvgScore: shadow.sessions ? Math.round(shadow.avg) : 0,
    todayAnswered: today.answered,
    todayAccuracy: today.answered ? Math.round((today.correct / today.answered) * 100) : 0,
    wordsPracticed: learned,
    totalWords,
    coverage: totalWords ? Math.round((learned / totalWords) * 100) : 0,
    activeDays: days,
    byBand,
  };
}

export function masteryList(db, userId, { bankId = null, band = null, page = 1, size = 20, q = '' } = {}) {
  const p = { uid: userId, size: Number(size), off: (Number(page) - 1) * Number(size) };
  const where = ['m.user_id=@uid'];
  if (bankId) { p.bid = Number(bankId); where.push('w.bank_id=@bid'); }
  if (band) { p.band = band; where.push('m.band=@band'); }
  if (q) { p.q = `%${q}%`; where.push('w.word LIKE @q'); }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM word_mastery m JOIN word w ON w.id=m.word_id WHERE ${W}`).get(p).c;
  const items = db.prepare(`
    SELECT m.word_id AS wordId, w.word, w.topic, s.def_cn AS defCn, s.def_en AS defEn,
           m.attempts, m.correct, m.score, m.band, m.streak, m.last_at AS lastAt
    FROM word_mastery m JOIN word w ON w.id=m.word_id
    LEFT JOIN word_sense s ON s.word_id=w.id AND s.sort=1
    WHERE ${W} ORDER BY m.score ASC, m.attempts DESC LIMIT @size OFFSET @off`).all(p);
  return { total, page: Number(page), size: Number(size), items };
}

export function weakWords(db, userId, { bankId = null, limit = 20 } = {}) {
  const p = { uid: userId, limit: Number(limit) };
  let sql = `
    SELECT m.word_id AS wordId, w.word, w.topic, s.def_cn AS defCn, s.def_en AS defEn,
           m.attempts, m.correct, m.score, m.band, m.streak, m.last_at AS lastAt
    FROM word_mastery m JOIN word w ON w.id=m.word_id
    LEFT JOIN word_sense s ON s.word_id=w.id AND s.sort=1
    WHERE m.user_id=@uid AND m.attempts>0 AND m.band IN ('weak','fuzzy')`;
  if (bankId) { p.bid = Number(bankId); sql += ' AND w.bank_id=@bid'; }
  sql += ' ORDER BY m.score ASC, m.streak ASC LIMIT @limit';
  return { items: db.prepare(sql).all(p) };
}

export function topicStats(db, userId, bankId) {
  const p = { uid: userId };
  let where = 'w.bank_id=@bid';
  if (bankId) p.bid = Number(bankId); else where = '1=1';
  return {
    items: db.prepare(`
      SELECT COALESCE(w.topic,'（未分类）') AS topic,
             COUNT(DISTINCT w.id) AS words,
             COUNT(DISTINCT m.word_id) AS practiced,
             ROUND(AVG(m.score),1) AS avgScore
      FROM word w
      LEFT JOIN word_mastery m ON m.word_id=w.id AND m.user_id=@uid
      WHERE ${where} GROUP BY COALESCE(w.topic,'（未分类）') ORDER BY words DESC`).all(p),
  };
}

export function daily(db, userId, days = 30) {
  const n = Math.max(1, Math.min(365, Number(days)));
  const rows = db.prepare(`
    SELECT date(pi.answered_at) AS day, COUNT(*) AS answered, SUM(pi.is_correct) AS correct
    FROM practice_item pi JOIN practice_session ps ON ps.id=pi.session_id
    WHERE ps.user_id=? AND pi.is_correct IS NOT NULL
      AND pi.answered_at >= datetime('now','localtime',?)
    GROUP BY date(pi.answered_at) ORDER BY day`).all(userId, `-${n} days`);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const r = rows.find(x => x.day === key);
    out.push({ day: key, answered: r?.answered || 0, correct: r?.correct || 0,
               accuracy: r?.answered ? Math.round((r.correct / r.answered) * 100) : 0 });
  }
  return { items: out };
}

export function wordHistory(db, userId, wordId, limit = 50) {
  const w = db.prepare(`
    SELECT w.*, b.name AS bankName FROM word w JOIN word_bank b ON b.id=w.bank_id WHERE w.id=?`).get(wordId);
  if (!w) throw notFound('单词不存在');
  const mastery = db.prepare(`SELECT * FROM word_mastery WHERE user_id=? AND word_id=?`).get(userId, wordId);
  const items = db.prepare(`
    SELECT pi.seq, pi.given, pi.is_correct AS isCorrect, pi.stem_snapshot AS stem,
           pi.answered_at AS answeredAt, pi.session_id AS sessionId, pi.latency_ms AS latencyMs
    FROM practice_item pi JOIN practice_session ps ON ps.id=pi.session_id
    WHERE ps.user_id=? AND pi.word_id=?
    ORDER BY pi.answered_at DESC LIMIT ?`).all(userId, wordId, Number(limit));
  const senses = db.prepare(`SELECT * FROM word_sense WHERE word_id=? ORDER BY sort`).all(wordId);
  return {
    word: {
      id: w.id, word: w.word, bankId: w.bank_id, bankName: w.bankName, topic: w.topic, tags: w.tags,
      phoneticUk: w.phonetic_uk, phoneticUs: w.phonetic_us,
    },
    senses,
    mastery: mastery ? {
      attempts: mastery.attempts, correct: mastery.correct, score: mastery.score, band: mastery.band,
      streak: mastery.streak, lastAt: mastery.last_at,
    } : null,
    items,
  };
}
