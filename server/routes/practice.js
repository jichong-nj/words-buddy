import {
  listPools, createSession, answerItem, finishSession, getSessionDetail, listSessions,
} from '../services/practice.js';
import { overview, masteryList, weakWords, topicStats, daily, wordHistory } from '../services/stats.js';
import { recomputeMastery } from '../services/mastery.js';
import { badRequest } from '../lib/errors.js';

export async function practiceRoutes(app) {
  const db = app.db;

  app.get('/api/practice/pools', async req => ({ items: listPools(db, req.user.id) }));

  app.post('/api/practice/sessions', async req => {
    const b = req.body || {};
    return createSession(db, req.user, {
      bankId: b.bankId, count: b.count, topics: b.topics, tags: b.tags, bands: b.bands,
      wordIds: b.wordIds, minLen: b.minLen, maxLen: b.maxLen, excludeRecentDays: b.excludeRecentDays,
    });
  });

  app.post('/api/practice/sessions/:id/answer', async req =>
    answerItem(db, req.user, Number(req.params.id), req.body || {}));

  app.post('/api/practice/sessions/:id/finish', async req =>
    finishSession(db, req.user, Number(req.params.id)));

  app.get('/api/practice/sessions', async req => {
    const userId = req.query.user ? Number(req.query.user) : null;
    if (userId && req.user.role !== 'admin') throw badRequest('forbidden_scope', '仅管理员可查看他人记录', 403);
    return listSessions(db, req.user, {
      page: Number(req.query.page) || 1, size: Number(req.query.size) || 20,
      bankId: req.query.bank ? Number(req.query.bank) : null, userId,
      mode: req.query.mode || null,
    });
  });

  app.get('/api/practice/sessions/:id', async req => getSessionDetail(db, req.user, Number(req.params.id)));
}

export async function statsRoutes(app) {
  const db = app.db;

  app.get('/api/stats/overview', async req => overview(db, req.user.id));

  app.get('/api/stats/mastery', async req => masteryList(db, req.user.id, {
    bankId: req.query.bank ? Number(req.query.bank) : null,
    band: req.query.band || null,
    q: req.query.q || '',
    page: Number(req.query.page) || 1, size: Number(req.query.size) || 20,
  }));

  app.get('/api/stats/weak-words', async req => weakWords(db, req.user.id, {
    bankId: req.query.bank ? Number(req.query.bank) : null,
    limit: Number(req.query.limit) || 20,
  }));

  app.get('/api/stats/topic', async req => topicStats(db, req.user.id, req.query.bank ? Number(req.query.bank) : null));

  app.get('/api/stats/daily', async req => daily(db, req.user.id, Number(req.query.days) || 30));

  app.get('/api/stats/words/:wordId', async req => wordHistory(db, req.user.id, Number(req.params.wordId)));

  app.post('/api/stats/recompute', { preHandler: app.requireRole('admin') }, async req => {
    const userId = req.body?.userId ? Number(req.body.userId) : null;
    if (userId) return recomputeMastery(db, userId);
    return recomputeMastery(db);
  });
}
