/**
 * 错题集：按题型累计每道题的对错次数。
 * - 答错：写入/累加错题记录（人工移除过的会重新出现）
 * - 答对：只更新已存在记录的 right_count，不会把没做错过的题加进来
 * - 支持人工从错题集移除（removed=1），题目被删仍能凭快照回看
 */
import { nowStr } from '../db/index.js';
import { notFound, badRequest } from '../lib/errors.js';

export const QTYPES = ['definition', 'form', 'reading'];
export const QTYPE_LABEL = { definition: '释义填空', form: '变形填空', reading: '阅读理解' };

const pickSnapshot = snap => (snap ? JSON.stringify(snap) : null);

/** 记录一次作答；isCorrect=false 时确保进入错题集 */
export function recordAttempt(db, userId, { qtype, refId, isCorrect, snapshot }) {
  if (!QTYPES.includes(qtype)) throw badRequest('bad_qtype', '未知题型');
  const id = Number(refId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const now = nowStr();
  if (!isCorrect) {
    db.prepare(`
      INSERT INTO mistake(user_id,qtype,ref_id,wrong_count,right_count,last_wrong_at,removed,snapshot_json,updated_at)
      VALUES(?,?,?,1,0,?,0,?,?)
      ON CONFLICT(user_id,qtype,ref_id) DO UPDATE SET
        wrong_count = wrong_count + 1,
        last_wrong_at = excluded.last_wrong_at,
        removed = 0,
        snapshot_json = COALESCE(excluded.snapshot_json, mistake.snapshot_json),
        updated_at = excluded.updated_at`)
      .run(userId, qtype, id, now, pickSnapshot(snapshot), now);
    return { qtype, refId: id, isCorrect: false };
  }
  db.prepare(`
    UPDATE mistake SET right_count = right_count + 1, last_right_at = ?, updated_at = ?
    WHERE user_id=? AND qtype=? AND ref_id=?`)
    .run(now, now, userId, qtype, id);
  return { qtype, refId: id, isCorrect: true };
}

function parseRow(r) {
  return {
    id: r.id,
    qtype: r.qtype,
    qtypeLabel: QTYPE_LABEL[r.qtype] || r.qtype,
    refId: r.ref_id,
    wrongCount: r.wrong_count,
    rightCount: r.right_count,
    lastWrongAt: r.last_wrong_at,
    lastRightAt: r.last_right_at,
    removed: !!r.removed,
    snapshot: (() => { try { return JSON.parse(r.snapshot_json || 'null'); } catch { return null; } })(),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** 错题集列表：默认不含人工移除的题；includeRemoved=1 时一并返回 */
export function listMistakes(db, userId, { qtype = '', q = '', page = 1, size = 20, includeRemoved = false } = {}) {
  const p = { uid: userId, size: Math.min(100, Math.max(1, Number(size) || 20)) };
  p.off = (Math.max(1, Number(page) || 1) - 1) * p.size;
  const where = ['user_id=@uid'];
  if (qtype) { p.qtype = qtype; where.push('qtype=@qtype'); }
  if (!includeRemoved) where.push('removed=0');
  if (q) { p.q = `%${String(q).trim()}%`; where.push('(snapshot_json LIKE @q OR CAST(ref_id AS TEXT) LIKE @q)'); }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM mistake WHERE ${W}`).get(p).c;
  const items = db.prepare(`SELECT * FROM mistake WHERE ${W} ORDER BY wrong_count DESC, last_wrong_at DESC, id DESC LIMIT @size OFFSET @off`)
    .all(p).map(parseRow);
  return { total, page: Number(page) || 1, size: p.size, items };
}

/** 按题型汇总（错题数、累计错次） */
export function mistakeSummary(db, userId) {
  const rows = db.prepare(`
    SELECT qtype, COUNT(*) AS count, COALESCE(SUM(wrong_count),0) AS wrongs, COALESCE(SUM(right_count),0) AS rights
    FROM mistake WHERE user_id=? AND removed=0 GROUP BY qtype`).all(userId);
  const byType = {};
  for (const t of QTYPES) byType[t] = { qtype: t, label: QTYPE_LABEL[t], count: 0, wrongs: 0, rights: 0 };
  for (const r of rows) {
    byType[r.qtype] = { qtype: r.qtype, label: QTYPE_LABEL[r.qtype] || r.qtype, count: r.count, wrongs: r.wrongs, rights: r.rights };
  }
  return { total: Object.values(byType).reduce((n, x) => n + x.count, 0), byType: Object.values(byType) };
}

export function removeMistakes(db, userId, ids) {
  const list = (ids || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  if (!list.length) throw badRequest('no_ids', '请选择要移除的题目');
  const stmt = db.prepare(`UPDATE mistake SET removed=1, updated_at=? WHERE id=? AND user_id=?`);
  let removed = 0;
  db.transaction(() => { for (const id of list) removed += stmt.run(nowStr(), id, userId).changes; })();
  return { removed };
}

/** 恢复：把人工移除的题放回错题集 */
export function restoreMistakes(db, userId, ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  const stmt = db.prepare(`UPDATE mistake SET removed=0, updated_at=? WHERE id=? AND user_id=?`);
  let restored = 0;
  db.transaction(() => { for (const id of list) restored += stmt.run(nowStr(), id, userId).changes; })();
  return { restored };
}

export function getMistake(db, userId, id) {
  const r = db.prepare(`SELECT * FROM mistake WHERE id=? AND user_id=?`).get(Number(id), userId);
  if (!r) throw notFound('错题记录不存在');
  return parseRow(r);
}

/** 统计：各题型答题数、正确率、错题数（用于「统计」页） */
export function statsByType(db, userId) {
  const rows = db.prepare(`
    SELECT pi.question_type AS type,
           COUNT(*) AS items,
           COALESCE(SUM(pi.is_correct),0) AS correct,
           COUNT(DISTINCT pi.session_id) AS sessions,
           MAX(pi.answered_at) AS lastAt
    FROM practice_item pi
    JOIN practice_session ps ON ps.id = pi.session_id
    WHERE ps.user_id=? AND pi.is_correct IS NOT NULL
    GROUP BY pi.question_type`).all(userId).map(r => {
    const label = r.type === 'form_fill' ? '变形填空'
      : r.type === 'reading' ? '阅读理解'
        : r.type === 'definition_fill' ? '释义填空' : r.type;
    return {
      type: r.type, label, sessions: r.sessions, items: r.items, correct: r.correct,
      accuracy: r.items ? Math.round((r.correct / r.items) * 100) : 0, lastAt: r.lastAt, mistakes: 0,
    };
  });
  const sum = mistakeSummary(db, userId);
  const keyMap = { definition_fill: 'definition', form_fill: 'form', reading: 'reading' };
  for (const r of rows) r.mistakes = sum.byType.find(b => b.qtype === keyMap[r.type])?.count || 0;
  // 三种题型固定顺序展示，没做过的补 0
  const order = [['definition_fill', '释义填空'], ['form_fill', '变形填空'], ['reading', '阅读理解']];
  const items = order.map(([type, label]) => rows.find(r => r.type === type)
    || { type, label, sessions: 0, items: 0, correct: 0, accuracy: 0, lastAt: null, mistakes: sum.byType.find(b => b.qtype === keyMap[type])?.count || 0 });
  const totalItems = items.reduce((n, x) => n + x.items, 0);
  const totalCorrect = items.reduce((n, x) => n + x.correct, 0);
  return {
    items,
    total: {
      items: totalItems, correct: totalCorrect,
      accuracy: totalItems ? Math.round((totalCorrect / totalItems) * 100) : 0,
      mistakes: sum.total,
    },
  };
}
