/**
 * 错题集 + 分题型统计。
 * 错题记录由各练习判分时自动写入（见 practice / formpractice / readingpractice）。
 */
import {
  listMistakes, mistakeSummary, removeMistakes, restoreMistakes, getMistake, statsByType,
} from '../services/mistakes.js';

export async function mistakeRoutes(app) {
  const db = app.db;

  app.get('/api/mistakes', async req => {
    const type = req.query.type || '';
    return {
      ...listMistakes(db, req.user.id, {
        qtype: type,
        q: req.query.q || '',
        page: Number(req.query.page) || 1,
        size: Number(req.query.size) || 20,
        includeRemoved: req.query.removed === '1',
      }),
      summary: mistakeSummary(db, req.user.id),
    };
  });

  app.get('/api/mistakes/summary', async req => mistakeSummary(db, req.user.id));

  app.get('/api/mistakes/:id', async req => getMistake(db, req.user.id, Number(req.params.id)));

  /** 人工从错题集移除（removed=1，可恢复） */
  app.post('/api/mistakes/remove', async req => removeMistakes(db, req.user.id, (req.body || {}).ids));

  app.post('/api/mistakes/restore', async req => restoreMistakes(db, req.user.id, (req.body || {}).ids));

  /** 统计页：分题型正确率 + 错题数 */
  app.get('/api/stats/by-type', async req => statsByType(db, req.user.id));
}
