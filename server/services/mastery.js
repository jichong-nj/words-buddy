import { nowStr } from '../db/index.js';

/** 掌握度档位（全局唯一定义，报表与练习都引用这里） */
export const BANDS = [
  { band: 'new', label: '未接触' },
  { band: 'weak', label: '薄弱' },
  { band: 'fuzzy', label: '模糊' },
  { band: 'known', label: '已掌握' },
  { band: 'mastered', label: '精通' },
];

const ALPHA = 0.35;

export function bandOf(score, attempts, streak) {
  if (!attempts) return 'new';
  if (score >= 85 && streak >= 3) return 'mastered';
  if (score >= 70) return 'known';
  if (score >= 40) return 'fuzzy';
  return 'weak';
}

/**
 * 单题作答后增量更新掌握度。
 * score 用指数加权平均：首题答对 70 / 答错 20，其后 new = old*0.65 + 本次*0.35
 * streak 为正表示连对，为负表示连错。
 */
export function applyMastery(db, userId, wordId, isCorrect) {
  const now = nowStr();
  const cur = db.prepare(`SELECT * FROM word_mastery WHERE user_id=? AND word_id=?`).get(userId, wordId);
  const prevScore = cur ? cur.score : null;
  const delta = isCorrect ? 100 : 0;
  const score = prevScore === null ? (isCorrect ? 70 : 20) : Math.round(prevScore * (1 - ALPHA) + delta * ALPHA);
  const attempts = (cur?.attempts || 0) + 1;
  const correct = (cur?.correct || 0) + (isCorrect ? 1 : 0);
  const prevStreak = cur?.streak || 0;
  const streak = isCorrect ? (prevStreak >= 0 ? prevStreak + 1 : 1) : (prevStreak <= 0 ? prevStreak - 1 : -1);
  const band = bandOf(score, attempts, streak);
  db.prepare(`
    INSERT INTO word_mastery(user_id,word_id,attempts,correct,streak,last_result,last_at,score,band,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,word_id) DO UPDATE SET
      attempts=excluded.attempts, correct=excluded.correct, streak=excluded.streak,
      last_result=excluded.last_result, last_at=excluded.last_at, score=excluded.score,
      band=excluded.band, updated_at=excluded.updated_at`)
    .run(userId, wordId, attempts, correct, streak, isCorrect ? 1 : 0, now, score, band, now);
  return { score, band, attempts, correct, streak };
}

/** 全量重算（掌握度是派生数据，必须可从明细重建） */
export function recomputeMastery(db, userId = null) {
  const filter = userId ? 'AND ps.user_id=?' : '';
  const params = userId ? [userId] : [];
  const rows = db.prepare(`
    SELECT ps.user_id AS user_id, pi.word_id AS word_id,
           COUNT(*) AS n, SUM(pi.is_correct) AS c
    FROM practice_item pi
    JOIN practice_session ps ON ps.id = pi.session_id
    WHERE pi.is_correct IS NOT NULL ${filter}
    GROUP BY ps.user_id, pi.word_id`).all(...params);

  const upsert = db.prepare(`
    INSERT INTO word_mastery(user_id,word_id,attempts,correct,streak,last_result,last_at,score,band,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,word_id) DO UPDATE SET
      attempts=excluded.attempts, correct=excluded.correct, streak=excluded.streak,
      last_result=excluded.last_result, last_at=excluded.last_at, score=excluded.score,
      band=excluded.band, updated_at=excluded.updated_at`);

  let updated = 0;
  db.transaction(() => {
    for (const r of rows) {
      const hist = db.prepare(`SELECT pi.is_correct AS ok, pi.answered_at AS at FROM practice_item pi
                               JOIN practice_session ps ON ps.id = pi.session_id
                               WHERE ps.user_id=? AND pi.word_id=? AND pi.is_correct IS NOT NULL
                               ORDER BY pi.answered_at, pi.id`).all(r.user_id, r.word_id);
      let score = null;
      for (const h of hist) score = score === null ? (h.ok ? 70 : 20) : Math.round(score * (1 - ALPHA) + (h.ok ? 100 : 0) * ALPHA);
      let streak = 0;
      for (let i = hist.length - 1; i >= 0; i--) {
        const ok = !!hist[i].ok;
        if (i === hist.length - 1) { streak = ok ? 1 : -1; continue; }
        if (ok && streak > 0) streak++;
        else if (!ok && streak < 0) streak--;
        else break;
      }
      const last = hist[hist.length - 1];
      const at = last?.at || nowStr();
      upsert.run(r.user_id, r.word_id, r.n, r.c, streak, last.ok ? 1 : 0, at, score, bandOf(score, r.n, streak), nowStr());
      updated++;
    }
  })();
  return { updated };
}

export function masterySummary(db, userId, bankId = null) {
  const args = [];
  let join = '';
  if (bankId) { join = 'JOIN word w ON w.id=m.word_id AND w.bank_id=?'; args.push(bankId); }
  args.push(userId);
  const rows = db.prepare(`
    SELECT m.band AS band, COUNT(*) AS count FROM word_mastery m ${join}
    WHERE m.user_id=? GROUP BY m.band`).all(...args);
  const byBand = Object.fromEntries(BANDS.map(b => [b.band, 0]));
  for (const r of rows) if (byBand[r.band] !== undefined) byBand[r.band] = r.count;
  return { byBand, items: BANDS.map(b => ({ ...b, count: byBand[b.band] || 0 })) };
}
