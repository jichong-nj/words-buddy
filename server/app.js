import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import { config, ensureDirs } from './config.js';
import { openDb, migrate } from './db/index.js';
import { ApiError } from './lib/errors.js';
import { registerAuth } from './lib/auth.js';
import { authRoutes, userRoutes } from './routes/auth.js';
import { bankRoutes, wordRoutes } from './routes/banks.js';
import { importRoutes } from './routes/import.js';
import { practiceRoutes, statsRoutes } from './routes/practice.js';
import { formRoutes } from './routes/form.js';
import { readingRoutes } from './routes/reading.js';
import { mistakeRoutes } from './routes/mistakes.js';

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger === undefined ? { transport: undefined, level: 'info' } : opts.logger,
    bodyLimit: 2 * 1024 * 1024,
    genReqId: req => `${req.method}-${Date.now().toString(36)}`,
  });

  const db = opts.db || openDb(opts.dbFile || config.dbFile);
  app.decorate('db', db);
  if (opts.migrate !== false) migrate(db);
  ensureDirs();

  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, {
    limits: { fileSize: config.upload.maxBytes, files: 1, fields: 30 },
    attachFieldsToBody: false,
  });

  registerAuth(app);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    const code = err.code || 'internal_error';
    if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'RequestFileTooLargeError') {
      return reply.code(400).send({ code: 'file_too_large', message: `文件超过 ${Math.round(config.upload.maxBytes / 1024 / 1024)}MB 上限` });
    }
    if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.code(400).send({ code: 'bad_body', message: '请求体格式不正确' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ code, message: err.message });
    }
    req.log.error({ err }, '未处理的服务端错误');
    return reply.code(500).send({ code: 'internal_error', message: '服务器内部错误' });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString(), schema: app.db.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).get()?.value || null }));

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(bankRoutes);
  await app.register(wordRoutes);
  await app.register(importRoutes);
  await app.register(practiceRoutes);
  await app.register(statsRoutes);
  await app.register(formRoutes);
  await app.register(readingRoutes);
  await app.register(mistakeRoutes);

  // 前端产物：存在则托管并做 SPA fallback，不存在时给出构建提示
  const dist = config.webDist;
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    // wildcard: true —— 每次请求都从磁盘找文件，重新 build 后无需重启服务（旧 hash 文件自然 404）
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      index: ['index.html'],
      wildcard: true,
    });
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url || '';
      if (url.startsWith('/api/')) {
        return reply.code(404).send({ code: 'not_found', message: '接口不存在' });
      }
      if (url.startsWith('/assets/')) {
        return reply.code(404).type('text/plain').send('asset not found');
      }
      return reply.type('text/html').send(fs.createReadStream(path.join(dist, 'index.html')));
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url.startsWith('/api/')) return reply.code(404).send({ code: 'not_found', message: '接口不存在' });
      return reply.code(200).type('text/html').send(
        `<!doctype html><meta charset="utf-8"><title>Words Buddy</title>
         <div style="font:14px/1.7 system-ui;padding:40px;max-width:640px;margin:auto">
         <h2>后端已启动，前端尚未构建</h2>
         <p>请执行 <code>npm run build</code> 生成 <code>dist/web</code>，或使用 <code>npm run dev:web</code> 开发模式。</p>
         <p>接口健康检查：<a href="/api/health">/api/health</a></p></div>`);
    });
  }

  return app;
}
