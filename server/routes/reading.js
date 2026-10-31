/**
 * 阅读理解：练习接口（全部登录用户）+ 题库维护（仅管理员）。
 */
import { replyXlsx } from './banks.js';
import { readUpload, parseJsonField } from './import.js';
import {
  listPassages, getPassage, createPassage, updatePassage, deletePassage, batchDelete,
  importReading, readingPools, buildReadingTemplate, exportReading,
} from '../services/readingbank.js';
import { createReadingSession, answerReadingItem } from '../services/readingpractice.js';
import { finishSession } from '../services/practice.js';

export async function readingRoutes(app) {
  const db = app.db;
  const admin = { preHandler: app.requireRole('admin') };

  // ── 练习 ──
  app.get('/api/reading/pools', async () => readingPools(db));

  app.post('/api/reading/sessions', async req => {
    const b = req.body || {};
    return createReadingSession(db, req.user, {
      passages: b.passages, levels: b.levels, topics: b.topics, tag: b.tag,
      excludeRecentDays: b.excludeRecentDays,
    });
  });

  app.post('/api/reading/sessions/:id/answer', async req =>
    answerReadingItem(db, req.user, Number(req.params.id), req.body || {}));

  app.post('/api/reading/sessions/:id/finish', async req =>
    finishSession(db, req.user, Number(req.params.id)));

  // ── 题库维护 ──
  app.get('/api/reading/passages', admin, async req => listPassages(db, {
    q: req.query.q || '', topic: req.query.topic || '', level: req.query.level || '',
    tag: req.query.tag || '',
    needs: req.query.needs === '0' || req.query.needs === '1' ? Number(req.query.needs) : null,
    page: Number(req.query.page) || 1, size: Number(req.query.size) || 20,
  }));

  app.get('/api/reading/passages/:id', admin, async req => getPassage(db, Number(req.params.id)));

  app.post('/api/reading/passages', admin, async req => createPassage(db, req.body || {}));

  app.put('/api/reading/passages/:id', admin, async req => updatePassage(db, Number(req.params.id), req.body || {}));

  app.delete('/api/reading/passages/:id', admin, async req => deletePassage(db, Number(req.params.id)));

  app.post('/api/reading/passages/batch-delete', admin, async req => batchDelete(db, (req.body || {}).ids));

  app.get('/api/reading/template', admin, async (req, reply) => {
    const buf = await buildReadingTemplate();
    return replyXlsx(reply, buf, '阅读理解导入模板.xlsx');
  });

  app.get('/api/reading/export.xlsx', admin, async (req, reply) => {
    const rows = db.prepare(`SELECT * FROM reading_passage ORDER BY id`).all();
    const passages = rows.map(r => ({
      ...r,
      questions: db.prepare(`SELECT * FROM reading_question WHERE passage_id=? ORDER BY seq`).all(r.id)
        .map(q => ({ ...q, options: JSON.parse(q.options_json || '[]'), answerIndex: q.answer_index })),
    }));
    const buf = await exportReading(passages);
    return replyXlsx(reply, buf, '阅读理解题库.xlsx');
  });

  /** 导入：dryRun=1 预览；dryRun=0 落库；onDuplicate=skip|overwrite（按标题） */
  app.post('/api/reading/import', admin, async req => {
    const { buffer, filename, fields } = await readUpload(req);
    const dryRun = !(fields.dryRun === '0' || fields.dryRun === 'false');
    return importReading(db, {
      buffer, filename,
      sheet: fields.sheet || undefined,
      headerRow: Number(fields.headerRow) || 1,
      columnMap: parseJsonField(fields.columnMap, undefined),
      onDuplicate: fields.onDuplicate === 'overwrite' ? 'overwrite' : 'skip',
      dryRun,
    });
  });
}
