/**
 * 跟读练习接口。全部登录用户可用（跟读是练习，不是管理功能）。
 * 录音用 multipart 上传（CSRF 守卫放行 multipart/form-data），回听用流式下载。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { readUpload } from './import.js';
import { synthesizeRef } from '../services/tts.js';
import {
  SHADOW_MODE, shadowPools, createShadowSession, submitShadowAttempt, finishShadowSession,
} from '../services/shadowpractice.js';

export async function shadowRoutes(app) {
  const db = app.db;

  app.get('/api/shadow/pools', async () => shadowPools(db));

  app.post('/api/shadow/sessions', async req => {
    const b = req.body || {};
    return createShadowSession(db, req.user, {
      count: b.count, levels: b.levels, bankId: b.bankId, excludeRecentDays: b.excludeRecentDays,
    });
  });

  // 提交录音：multipart，file = 录音，seq = 题号
  app.post('/api/shadow/sessions/:id/attempt', async req => {
    const { buffer, fields } = await readUpload(req);
    if (!fields.seq) throw badRequest('no_seq', '缺少题号');
    return submitShadowAttempt(db, req.user, Number(req.params.id), {
      seq: Number(fields.seq), audioBuffer: buffer, mime: fields.mime || '',
    });
  });

  app.post('/api/shadow/sessions/:id/finish', async req =>
    finishShadowSession(db, req.user, Number(req.params.id)));

  // 回听自己的录音
  app.get('/api/shadow/sessions/:id/audio/:seq', async (req, reply) => {
    const s = db.prepare(`SELECT * FROM practice_session WHERE id=?`).get(Number(req.params.id));
    if (!s) throw notFound('练习会话不存在');
    if (req.user.role !== 'admin' && s.user_id !== req.user.id) throw badRequest('forbidden', '只能听自己的录音');
    const row = db.prepare(`SELECT shadow_audio_path AS p FROM practice_item WHERE session_id=? AND seq=?`)
      .get(Number(req.params.id), Number(req.params.seq));
    if (!row?.p) throw notFound('没有录音');
    const abs = path.join(config.dataDir, row.p);
    if (!fs.existsSync(abs)) throw notFound('录音文件已清理');
    const ext = path.extname(abs).toLowerCase();
    reply.header('Content-Type', ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : 'audio/webm');
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(fs.createReadStream(abs));
  });

  // 浏览器没有英文语音时的兜底：把服务端合成的参考音发给前端播放
  app.get('/api/shadow/ref', async (req, reply) => {
    const text = String(req.query.text || '').trim();
    if (!text) throw badRequest('no_text', '缺少句子');
    const { file } = await synthesizeRef(text);
    reply.header('Content-Type', 'audio/wav');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(file));
  });

  app.get('/api/shadow/mode', async () => ({ mode: SHADOW_MODE }));
}
