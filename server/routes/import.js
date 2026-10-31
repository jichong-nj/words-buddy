import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { buildErrorReport } from '../lib/excel.js';
import { previewImport, repreviewImport, commitImport, rollbackImport, listBatches, getBatchErrors } from '../services/importer.js';
import { replyXlsx } from './banks.js';

/** 读取 multipart 请求：返回 { buffer, filename, fields } */
export async function readUpload(req) {
  const parts = req.parts();   // @fastify/multipart v10：req.multipart() 已移除
  const fields = {};
  let buffer = null;
  let filename = null;
  for await (const part of parts) {
    if (part.file) {
      if (part.fieldname !== 'file') { part.file.resume(); continue; }
      filename = part.filename;
      const chunks = [];
      let size = 0;
      for await (const c of part.file) {
        size += c.length;
        if (size > config.upload.maxBytes) {
          part.file.resume();
          throw badRequest('file_too_large', `文件超过 ${Math.round(config.upload.maxBytes / 1024 / 1024)}MB 上限`);
        }
        chunks.push(c);
      }
      buffer = Buffer.concat(chunks);
    } else if (part.fieldname) {
      fields[part.fieldname] = String(part.value ?? '');
    }
  }
  if (!buffer || !buffer.length) throw badRequest('no_file', '请选择要导入的文件');
  return { buffer, filename, fields };
}

export function parseJsonField(v, fallback = undefined) {
  if (v === undefined || v === null || v === '') return fallback;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

export async function importRoutes(app) {
  const db = app.db;
  const admin = { preHandler: app.requireRole('admin') };

  app.post('/api/import/preview', admin, async req => {
    const { buffer, filename, fields } = await readUpload(req);
    const bankId = Number(fields.bankId);
    if (!bankId) throw badRequest('no_bank', '请先选择要导入的词库');
    return previewImport(db, {
      bankId, buffer, filename,
      sheet: fields.sheet || undefined,
      headerRow: Number(fields.headerRow) || 1,
      columnMap: parseJsonField(fields.columnMap, undefined),
      dupInFile: fields.dupInFile || 'merge_senses',
      dupInBank: fields.dupInBank || 'overwrite',
      mergeSenses: fields.mergeSenses === undefined ? true : fields.mergeSenses === '1' || fields.mergeSenses === 'true',
    });
  });

  /** 改了列映射/去重策略后重新预览：直接复用已上传的文件，无需重新上传 */
  app.patch('/api/import/:batchId', admin, async req => {
    const body = req.body || {};
    return repreviewImport(db, Number(req.params.batchId), {
      sheet: body.sheet,
      headerRow: body.headerRow,
      columnMap: body.columnMap,
      dupInFile: body.dupInFile,
      dupInBank: body.dupInBank,
      mergeSenses: body.mergeSenses,
    });
  });

  app.post('/api/import/:batchId/commit', admin, async req => commitImport(db, Number(req.params.batchId)));

  app.post('/api/import/:batchId/rollback', admin, async req => rollbackImport(db, Number(req.params.batchId)));

  app.get('/api/import/:batchId/errors.xlsx', admin, async (req, reply) => {
    const batchId = Number(req.params.batchId);
    const batch = db.prepare(`SELECT * FROM import_batch WHERE id=?`).get(batchId);
    if (!batch) throw notFound('导入批次不存在');
    const errors = getBatchErrors(db, batchId);
    if (!errors.length) throw badRequest('no_errors', '该批次没有校验问题记录');
    const buf = await buildErrorReport(errors);
    return replyXlsx(reply, buf, `导入校验报告-${batchId}.xlsx`);
  });

  app.get('/api/batches', admin, async req => {
    const bankId = req.query.bank ? Number(req.query.bank) : null;
    return { items: listBatches(db, bankId) };
  });
}
