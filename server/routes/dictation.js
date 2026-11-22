/**
 * 听写练习：练习接口（全部登录用户）+ 音频 + 句库维护（管理员）。
 * 音频优先取外部引擎（MOSS-TTS-Nano）离线预生成的缓存，缺失时回落 espeak-ng；
 * 客户端只拿 URL，避免提前泄露英文原句。
 */
import fs from 'node:fs';
import { replyXlsx } from './banks.js';
import { readUpload, parseJsonField } from './import.js';
import { dictationAudio, audioMime } from '../services/tts.js';
import { finishSession } from '../services/practice.js';
import { dictationPools, createDictationSession, submitDictation } from '../services/dictation.js';
import {
  listDictation, getDictation, createDictation, updateDictation, deleteDictation,
  batchDeleteDictation, importDictation,
} from '../services/dictationbank.js';

export async function dictationRoutes(app) {
  const db = app.db;
  const admin = { preHandler: app.requireRole('admin') };

  // ── 练习 ──
  app.get('/api/dictation/pools', async () => dictationPools(db));

  app.post('/api/dictation/sessions', async req => {
    const b = req.body || {};
    return createDictationSession(db, req.user, {
      count: b.count, levels: b.levels, topics: b.topics, bankId: b.bankId,
      excludeRecentDays: b.excludeRecentDays,
    });
  });

  app.post('/api/dictation/sessions/:id/submit', async req =>
    submitDictation(db, req.user, Number(req.params.id), req.body || {}));

  app.post('/api/dictation/sessions/:id/finish', async req =>
    finishSession(db, req.user, Number(req.params.id)));

  // ── 参考音频：外部引擎（MOSS-TTS-Nano）预生成优先，缺失回落 espeak-ng ──
  app.get('/api/dictation/audio/:itemId', async (req, reply) => {
    const row = db.prepare(`SELECT sentence_en FROM dictation_item WHERE id=?`).get(Number(req.params.itemId));
    if (!row) return reply.code(404).send({ code: 'not_found', message: '题目不存在' });
    const { file, provider } = await dictationAudio(row.sentence_en);
    reply.header('Content-Type', audioMime(file));
    reply.header('Cache-Control', 'private, max-age=86400');
    reply.header('X-TTS-Provider', provider);
    return reply.send(fs.createReadStream(file));
  });

  // ── 句库维护（管理员） ──
  app.get('/api/dictation/items', admin, async req => listDictation(db, {
    q: req.query.q || '', level: req.query.level || '', topic: req.query.topic || '',
    needs: req.query.needs === '0' || req.query.needs === '1' ? Number(req.query.needs) : null,
    page: Number(req.query.page) || 1, size: Number(req.query.size) || 20,
  }));

  app.get('/api/dictation/items/:id', admin, async req => getDictation(db, Number(req.params.id)));

  app.post('/api/dictation/items', admin, async req => createDictation(db, req.body || {}));

  app.put('/api/dictation/items/:id', admin, async req => updateDictation(db, Number(req.params.id), req.body || {}));

  app.delete('/api/dictation/items/:id', admin, async req => deleteDictation(db, Number(req.params.id)));

  app.post('/api/dictation/items/batch-delete', admin, async req => batchDeleteDictation(db, (req.body || {}).ids));

  app.get('/api/dictation/template', admin, async (req, reply) => {
    const { buildDictationTemplate } = await import('../lib/dictationexcel.js');
    const buf = await buildDictationTemplate();
    return replyXlsx(reply, buf, '听写句库导入模板.xlsx');
  });

  app.get('/api/dictation/export.xlsx', admin, async (req, reply) => {
    const { exportDictation } = await import('../lib/dictationexcel.js');
    const rows = db.prepare(`SELECT * FROM dictation_item ORDER BY id`).all();
    const items = rows.map(r => ({
      sentenceEn: r.sentence_en, sentenceCn: r.sentence_cn, level: r.level, topic: r.topic,
      tags: r.tags, source: r.source, grammarLabel: r.grammar_label, analysis: r.analysis,
      tokens: (() => { try { return JSON.parse(r.tokens_json || '[]'); } catch { return []; } })(),
    }));
    const buf = await exportDictation(items);
    return replyXlsx(reply, buf, '听写句库.xlsx');
  });

  app.post('/api/dictation/import', admin, async req => {
    const { buffer, filename, fields } = await readUpload(req);
    const dryRun = !(fields.dryRun === '0' || fields.dryRun === 'false');
    return importDictation(db, {
      buffer, filename,
      sheet: fields.sheet || undefined,
      headerRow: Number(fields.headerRow) || 1,
      columnMap: parseJsonField(fields.columnMap, undefined),
      onDuplicate: fields.onDuplicate === 'overwrite' ? 'overwrite' : 'skip',
      dryRun,
    });
  });
}
