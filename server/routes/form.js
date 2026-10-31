/**
 * 变形填空：练习接口（全部登录用户）+ 题库维护接口（仅管理员）。
 * 题库维护包括：列表/详情/新增/修改/删除/批量删除/模板下载/导入（预览与落库同一接口，dryRun 区分）/导出。
 */
import { badRequest } from '../lib/errors.js';
import { replyXlsx } from './banks.js';
import { readUpload, parseJsonField } from './import.js';
import {
  listItems, getItem, createItem, updateItem, deleteItem, batchDelete,
  importFormItems, formStats, buildFormTemplate, exportFormItems,
} from '../services/formbank.js';
import { formPools, createFormSession, answerFormItem, FORM_MODE } from '../services/formpractice.js';
import { finishSession } from '../services/practice.js';

export async function formRoutes(app) {
  const db = app.db;
  const admin = { preHandler: app.requireRole('admin') };

  // ── 练习（所有登录用户） ──
  app.get('/api/form/pools', async () => formPools(db));

  app.post('/api/form/sessions', async req => {
    const b = req.body || {};
    return createFormSession(db, req.user, {
      count: b.count, points: b.points, levels: b.levels, topics: b.topics,
      excludeRecentDays: b.excludeRecentDays,
    });
  });

  app.post('/api/form/sessions/:id/answer', async req =>
    answerFormItem(db, req.user, Number(req.params.id), req.body || {}));

  app.post('/api/form/sessions/:id/finish', async req =>
    finishSession(db, req.user, Number(req.params.id)));

  // ── 题库维护（仅管理员） ──
  app.get('/api/form/items', admin, async req => listItems(db, {
    q: req.query.q || '',
    point: req.query.point || '',
    topic: req.query.topic || '',
    level: req.query.level || '',
    tag: req.query.tag || '',
    needs: req.query.needs === '0' || req.query.needs === '1' ? Number(req.query.needs) : null,
    page: Number(req.query.page) || 1,
    size: Number(req.query.size) || 20,
  }));

  app.get('/api/form/items/:id', admin, async req => getItem(db, Number(req.params.id)));

  app.post('/api/form/items', admin, async req => createItem(db, req.body || {}));

  app.put('/api/form/items/:id', admin, async req => updateItem(db, Number(req.params.id), req.body || {}));

  app.delete('/api/form/items/:id', admin, async req => deleteItem(db, Number(req.params.id)));

  app.post('/api/form/items/batch-delete', admin, async req => batchDelete(db, (req.body || {}).ids));

  app.get('/api/form/stats', admin, async () => formStats(db));

  app.get('/api/form/template', admin, async (req, reply) => {
    const buf = await buildFormTemplate();
    return replyXlsx(reply, buf, '变形填空导入模板.xlsx');
  });

  app.get('/api/form/export.xlsx', admin, async (req, reply) => {
    const all = db.prepare(`SELECT * FROM transform_item ORDER BY id`).all();
    const items = all.map(r => ({
      prompt: r.prompt, base: r.base, answer: r.answer,
      accepted: JSON.parse(r.accepted_json || '[]'), point: r.point, level: r.level,
      topic: r.topic, tags: r.tags, explain: r.explain, notes: r.notes,
    }));
    const buf = await exportFormItems(items);
    return replyXlsx(reply, buf, '变形填空题库.xlsx');
  });

  /** 导入：dryRun=1 只预览校验；dryRun=0 落库（onDuplicate=skip|overwrite） */
  app.post('/api/form/import', admin, async req => {
    const { buffer, filename, fields } = await readUpload(req);
    const dryRun = !(fields.dryRun === '0' || fields.dryRun === 'false');
    return importFormItems(db, {
      buffer, filename,
      sheet: fields.sheet || undefined,
      headerRow: Number(fields.headerRow) || 1,
      columnMap: parseJsonField(fields.columnMap, undefined),
      onDuplicate: fields.onDuplicate === 'overwrite' ? 'overwrite' : 'skip',
      dryRun,
    });
  });
}
