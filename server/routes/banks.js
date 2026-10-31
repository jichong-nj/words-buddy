import { config } from '../config.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { buildTemplate, exportBank } from '../lib/excel.js';
import { parseSenses, normWord, splitTags, joinTags } from '../lib/parse.js';
import { topicsForLevel, hasTaxonomy } from '../../shared/topic-taxonomy.js';

const bankRow = b => ({
  id: b.id, name: b.name, level: b.level, description: b.description, status: b.status,
  wordCount: b.word_count, createdAt: b.created_at, updatedAt: b.updated_at,
});

function bankStats(db, bankId) {
  const g = db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS wordCount,
           COUNT(s.id) AS senseCount,
           SUM(CASE WHEN s.def_en IS NOT NULL AND trim(s.def_en)<>'' THEN 1 ELSE 0 END) AS defEnCount,
           SUM(CASE WHEN w.needs_review=1 THEN 1 ELSE 0 END) AS reviewCount
    FROM word w LEFT JOIN word_sense s ON s.word_id=w.id WHERE w.bank_id=?`).get(bankId);
  const practiceable = db.prepare(`
    SELECT COUNT(DISTINCT w.id) AS c FROM word w JOIN word_sense s ON s.word_id=w.id
    WHERE w.bank_id=? AND s.def_en IS NOT NULL AND length(trim(s.def_en))>=8
      AND w.word NOT LIKE '% %' AND w.word GLOB '[A-Za-z]*' AND w.word NOT GLOB '*[^A-Za-z]*'
      AND length(w.word) BETWEEN ? AND ?`).get(bankId, config.practice.minLen, config.practice.maxLen).c;
  return {
    wordCount: g.wordCount || 0, senseCount: g.senseCount || 0,
    defEnCount: g.defEnCount || 0, reviewCount: g.reviewCount || 0, practiceable,
  };
}

function refreshCount(db, bankId) {
  const c = db.prepare(`SELECT COUNT(*) AS c FROM word WHERE bank_id=?`).get(bankId).c;
  db.prepare(`UPDATE word_bank SET word_count=?, updated_at=datetime('now','localtime') WHERE id=?`).run(c, bankId);
  return c;
}

function insertSenses(db, wordId, senses, srcRow = null) {
  const ins = db.prepare(`
    INSERT INTO word_sense(word_id,pos,def_cn,def_en,def_en_source,example_en,example_cn,sort,src_row)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  senses.forEach((s, i) => ins.run(wordId, s.pos || null, s.def_cn || null, s.def_en || null,
    s.def_en ? 'manual' : null, s.example_en || null, s.example_cn || null, i + 1, srcRow));
}

export async function bankRoutes(app) {
  const db = app.db;

  app.get('/api/banks', async () => {
    const rows = db.prepare(`SELECT * FROM word_bank ORDER BY id`).all();
    return { items: rows.map(b => ({ ...bankRow(b), ...bankStats(db, b.id) })) };
  });

  app.post('/api/banks', { preHandler: app.requireRole('admin') }, async req => {
    const { name, level, description } = req.body || {};
    const n = String(name || '').trim();
    if (!n) throw badRequest('bad_name', '词库名称不能为空');
    if (n.length > 60) throw badRequest('bad_name', '词库名称不能超过 60 字');
    if (db.prepare(`SELECT id FROM word_bank WHERE name=?`).get(n)) throw conflict('name_taken', '同名词库已存在');
    const lv = ['KET', 'PET', 'KET+PET', 'OTHER'].includes(level) ? level : 'OTHER';
    const info = db.prepare(`INSERT INTO word_bank(name,level,description) VALUES(?,?,?)`)
      .run(n, lv, String(description || '').trim() || null);
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(info.lastInsertRowid);
    return { ...bankRow(b), ...bankStats(db, b.id) };
  });

  app.get('/api/banks/:id', async req => {
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(Number(req.params.id));
    if (!b) throw notFound('词库不存在');
    return { ...bankRow(b), ...bankStats(db, b.id) };
  });

  app.patch('/api/banks/:id', { preHandler: app.requireRole('admin') }, async req => {
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(Number(req.params.id));
    if (!b) throw notFound('词库不存在');
    const { name, level, description, status } = req.body || {};
    const nn = name !== undefined ? String(name).trim() : b.name;
    if (!nn) throw badRequest('bad_name', '词库名称不能为空');
    if (name !== undefined && nn !== b.name && db.prepare(`SELECT id FROM word_bank WHERE name=? AND id<>?`).get(nn, b.id)) {
      throw conflict('name_taken', '同名词库已存在');
    }
    const lv = ['KET', 'PET', 'KET+PET', 'OTHER'].includes(level) ? level : b.level;
    const st = ['active', 'archived'].includes(status) ? status : b.status;
    db.prepare(`UPDATE word_bank SET name=?, level=?, description=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(nn, lv, description !== undefined ? String(description).trim() || null : b.description, st, b.id);
    const after = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(b.id);
    return { ...bankRow(after), ...bankStats(db, b.id) };
  });

  app.delete('/api/banks/:id', { preHandler: app.requireRole('admin') }, async req => {
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(Number(req.params.id));
    if (!b) throw notFound('词库不存在');
    if (String(req.body?.confirmName || '').trim() !== b.name) {
      throw badRequest('confirm_mismatch', '请输入词库名称以确认删除');
    }
    const used = db.prepare(`SELECT COUNT(*) AS c FROM practice_item pi JOIN word w ON w.id=pi.word_id WHERE w.bank_id=?`).get(b.id).c;
    if (used > 0) throw conflict('bank_in_use', `该词库已有 ${used} 条练习记录，不能删除；可改为「归档」`);
    db.prepare(`DELETE FROM word_bank WHERE id=?`).run(b.id);
    return { ok: true };
  });

  app.post('/api/banks/:id/copy', { preHandler: app.requireRole('admin') }, async req => {
    const src = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(Number(req.params.id));
    if (!src) throw notFound('词库不存在');
    const name = String(req.body?.name || `${src.name} 副本`).trim();
    if (db.prepare(`SELECT id FROM word_bank WHERE name=?`).get(name)) throw conflict('name_taken', '同名词库已存在');
    const info = db.prepare(`INSERT INTO word_bank(name,level,description) VALUES(?,?,?)`).run(name, src.level, src.description);
    const newId = info.lastInsertRowid;
    db.transaction(() => {
      const words = db.prepare(`SELECT * FROM word WHERE bank_id=?`).all(src.id);
      const iw = db.prepare(`INSERT INTO word(bank_id,word,phonetic_uk,phonetic_us,topic,tags,level,notes,needs_review,src_row)
                             VALUES(?,?,?,?,?,?,?,?,?,?)`);
      const copySense = db.prepare(`INSERT INTO word_sense(word_id,pos,def_cn,def_en,def_en_source,example_en,example_cn,sort,src_row)
                                    VALUES(?,?,?,?,?,?,?,?,?)`);
      for (const w of words) {
        const wid = iw.run(newId, w.word, w.phonetic_uk, w.phonetic_us, w.topic, w.tags, w.level, w.notes, w.needs_review, w.src_row).lastInsertRowid;
        for (const s of db.prepare(`SELECT * FROM word_sense WHERE word_id=? ORDER BY sort`).all(w.id)) {
          copySense.run(wid, s.pos, s.def_cn, s.def_en, s.def_en_source, s.example_en, s.example_cn, s.sort, s.src_row);
        }
      }
      refreshCount(db, newId);
    })();
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(newId);
    return { ...bankRow(b), ...bankStats(db, b.id) };
  });

  /** 导入模板下载 */
  app.get('/api/import/template', async (req, reply) => {
    const level = ['KET', 'PET'].includes(String(req.query.level || '').toUpperCase())
      ? String(req.query.level).toUpperCase() : 'KET';
    const buf = await buildTemplate(level);
    return replyXlsx(reply, buf, `词库导入模板-${level}.xlsx`);
  });

  /** 整库导出（一行一个义项，可再次导入） */
  app.get('/api/banks/:id/export.xlsx', async (req, reply) => {
    const b = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(Number(req.params.id));
    if (!b) throw notFound('词库不存在');
    const rows = db.prepare(`
      SELECT w.word, w.phonetic_uk, w.phonetic_us, w.topic, w.tags, w.level, w.notes,
             s.pos, s.def_cn, s.def_en, s.example_en, s.example_cn
      FROM word w LEFT JOIN word_sense s ON s.word_id=w.id
      WHERE w.bank_id=? ORDER BY w.word, s.sort`).all(b.id);
    const buf = await exportBank(b, rows);
    return replyXlsx(reply, buf, `${b.name}.xlsx`);
  });
}

export function replyXlsx(reply, buf, filename) {
  reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  return reply.send(buf);
}

export async function wordRoutes(app) {
  const db = app.db;

  app.get('/api/banks/:id/words', async req => {
    const bankId = Number(req.params.id);
    if (!db.prepare(`SELECT id FROM word_bank WHERE id=?`).get(bankId)) throw notFound('词库不存在');
    const q = String(req.query.q || '').trim();
    const topic = String(req.query.topic || '').trim();
    const tag = String(req.query.tag || '').trim();
    const pos = String(req.query.pos || '').trim();
    const needs = req.query.needs === '1' || req.query.needs === '0' ? Number(req.query.needs) : null;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.max(1, Math.min(100, Number(req.query.size) || 20));
    const p = { bankId, size, off: (page - 1) * size };
    const where = ['w.bank_id=@bankId'];
    if (q) { p.q = `%${q}%`; where.push('(w.word LIKE @q OR s.def_cn LIKE @q OR s.def_en LIKE @q)'); }
    if (topic) { p.topic = topic; where.push('w.topic=@topic'); }
    if (tag) { p.tag = tag; where.push(`(','||w.tags||',') LIKE '%,' || @tag || ',%'`); }
    if (pos) { p.pos = pos; where.push('EXISTS (SELECT 1 FROM word_sense x WHERE x.word_id=w.id AND x.pos=@pos)'); }
    if (needs !== null) { p.needs = needs; where.push('w.needs_review=@needs'); }
    const W = where.join(' AND ');
    const total = db.prepare(`
      SELECT COUNT(DISTINCT w.id) AS c FROM word w LEFT JOIN word_sense s ON s.word_id=w.id WHERE ${W}`).get(p).c;
    const items = db.prepare(`
      SELECT w.id, w.word, w.phonetic_uk AS phoneticUk, w.topic, w.tags, w.level,
             w.needs_review AS needsReview, w.updated_at AS updatedAt,
             s.pos AS mainPos, s.def_cn AS mainDef, s.def_en AS mainDefEn,
             (SELECT GROUP_CONCAT(DISTINCT x.pos) FROM word_sense x WHERE x.word_id=w.id AND x.pos IS NOT NULL AND x.pos<>'') AS posList,
             (SELECT COUNT(*) FROM word_sense x WHERE x.word_id=w.id) AS senseCount
      FROM word w LEFT JOIN word_sense s ON s.word_id=w.id AND s.sort=1
      WHERE ${W} ORDER BY w.word LIMIT @size OFFSET @off`).all(p);
    return {
      total, page, size,
      items: items.map(i => ({ ...i, posList: i.posList ? i.posList.split(',') : [] })),
    };
  });

  app.post('/api/banks/:id/words', { preHandler: app.requireRole('admin') }, async req => {
    const bankId = Number(req.params.id);
    if (!db.prepare(`SELECT id FROM word_bank WHERE id=?`).get(bankId)) throw notFound('词库不存在');
    const body = req.body || {};
    const word = String(body.word || '').trim();
    if (!word) throw badRequest('empty_word', '单词不能为空');
    if (word.length > 64) throw badRequest('word_too_long', '单词过长');
    if (db.prepare(`SELECT id FROM word WHERE bank_id=? AND word_norm=?`).get(bankId, normWord(word))) {
      throw conflict('dup_word', '该词库中已存在此单词');
    }
    const senses = normalizeSenses(body);
    db.transaction(() => {
      const id = db.prepare(`INSERT INTO word(bank_id,word,phonetic_uk,phonetic_us,topic,tags,level,notes,needs_review)
                             VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(bankId, word, body.phoneticUk || null, body.phoneticUs || null, body.topic || null,
          joinTags(splitTags(body.tags || '')), body.level || null, body.notes || null,
          senses.some(s => s.def_cn || s.def_en) ? 0 : 1).lastInsertRowid;
      insertSenses(db, id, senses);
      refreshCount(db, bankId);
    })();
    return getWord(db, db.prepare(`SELECT id FROM word WHERE bank_id=? AND word_norm=?`).get(bankId, normWord(word)).id);
  });

  app.get('/api/words/:id', async req => {
    const id = Number(req.params.id);
    if (!db.prepare(`SELECT id FROM word WHERE id=?`).get(id)) throw notFound('单词不存在');
    return getWord(db, id);
  });

  app.put('/api/words/:id', { preHandler: app.requireRole('admin') }, async req => {
    const id = Number(req.params.id);
    const w = db.prepare(`SELECT * FROM word WHERE id=?`).get(id);
    if (!w) throw notFound('单词不存在');
    const body = req.body || {};
    const word = body.word !== undefined ? String(body.word).trim() : w.word;
    if (!word) throw badRequest('empty_word', '单词不能为空');
    const norm = normWord(word);
    if (norm !== w.word_norm) {
      const dup = db.prepare(`SELECT id FROM word WHERE bank_id=? AND word_norm=? AND id<>?`).get(w.bank_id, norm, id);
      if (dup) throw conflict('dup_word', '该词库中已存在此单词');
    }
    const senses = normalizeSenses(body, w.bank_id);
    db.transaction(() => {
      db.prepare(`UPDATE word SET word=?, phonetic_uk=?, phonetic_us=?, topic=?, tags=?, level=?, notes=?,
                    needs_review=?, updated_at=datetime('now','localtime') WHERE id=?`)
        .run(word, body.phoneticUk ?? w.phonetic_uk, body.phoneticUs ?? w.phonetic_us, body.topic ?? w.topic,
          body.tags !== undefined ? joinTags(splitTags(body.tags)) : w.tags, body.level ?? w.level,
          body.notes ?? w.notes, senses.some(s => s.def_cn || s.def_en) ? 0 : 1, id);
      db.prepare(`DELETE FROM word_sense WHERE word_id=?`).run(id);
      insertSenses(db, id, senses);
    })();
    return getWord(db, id);
  });

  app.delete('/api/words/:id', { preHandler: app.requireRole('admin') }, async req => {
    const id = Number(req.params.id);
    const w = db.prepare(`SELECT * FROM word WHERE id=?`).get(id);
    if (!w) throw notFound('单词不存在');
    const used = db.prepare(`SELECT COUNT(*) AS c FROM practice_item WHERE word_id=?`).get(id).c;
    if (used > 0) throw conflict('word_in_use', `该单词有 ${used} 条练习记录，不能删除`);
    db.prepare(`DELETE FROM word WHERE id=?`).run(id);
    refreshCount(db, w.bank_id);
    return { ok: true };
  });

  app.post('/api/banks/:id/words/batch-delete', { preHandler: app.requireRole('admin') }, async req => {
    const bankId = Number(req.params.id);
    const ids = (req.body?.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw badRequest('no_ids', '未选择单词');
    let deleted = 0, skipped = 0;
    db.transaction(() => {
      for (const id of ids) {
        const w = db.prepare(`SELECT bank_id FROM word WHERE id=? AND bank_id=?`).get(id, bankId);
        if (!w) continue;
        if (db.prepare(`SELECT COUNT(*) AS c FROM practice_item WHERE word_id=?`).get(id).c > 0) { skipped++; continue; }
        deleted += db.prepare(`DELETE FROM word WHERE id=?`).run(id).changes;
      }
      refreshCount(db, bankId);
    })();
    return { deleted, skipped };
  });

  app.post('/api/banks/:id/words/batch-tag', { preHandler: app.requireRole('admin') }, async req => {
    const bankId = Number(req.params.id);
    const ids = (req.body?.ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw badRequest('no_ids', '未选择单词');
    const add = splitTags(req.body?.add || '');
    const remove = new Set(splitTags(req.body?.remove || ''));
    let updated = 0;
    db.transaction(() => {
      const up = db.prepare(`UPDATE word SET tags=?, updated_at=datetime('now','localtime') WHERE id=?`);
      for (const id of ids) {
        const w = db.prepare(`SELECT tags FROM word WHERE id=? AND bank_id=?`).get(id, bankId);
        if (!w) continue;
        const next = joinTags([...splitTags(w.tags), ...add].filter(t => !remove.has(t)));
        updated += up.run(next, id).changes;
      }
    })();
    return { updated };
  });

  app.get('/api/meta/topics', async req => {
    const bank = req.query.bank ? db.prepare(`SELECT level FROM word_bank WHERE id=?`).get(Number(req.query.bank)) : null;
    const level = bank?.level || String(req.query.level || '').toUpperCase() || null;
    const items = topicsForLevel(level);
    return { items, taxonomy: hasTaxonomy(level) };
  });

  app.get('/api/meta/tags', async req => {
    const bankId = req.query.bank ? Number(req.query.bank) : null;
    const rows = bankId
      ? db.prepare(`SELECT tags FROM word WHERE bank_id=? AND tags IS NOT NULL AND tags<>''`).all(bankId)
      : db.prepare(`SELECT tags FROM word WHERE tags IS NOT NULL AND tags<>''`).all();
    const map = new Map();
    for (const r of rows) for (const t of splitTags(r.tags)) map.set(t, (map.get(t) || 0) + 1);
    return { items: [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) };
  });
}

/** 前端提交的义项数组归一化；没传 senses 时退化为单义项字段 */
function normalizeSenses(body) {
  let list = body.senses;
  if (!Array.isArray(list) || !list.length) {
    list = [{ pos: body.pos, def_cn: body.defCn ?? body.def_cn, def_en: body.defEn ?? body.def_en,
      example_en: body.exampleEn ?? body.example_en, example_cn: body.exampleCn ?? body.example_cn }];
  }
  const parsed = parseSenses({
    pos: list.map(s => s.pos || '').filter(Boolean).join('\n'),
    def_cn: list.map(s => s.defCn ?? s.def_cn ?? '').join('\n'),
    def_en: list.map(s => s.defEn ?? s.def_en ?? '').join('\n'),
    example_en: list.map(s => s.exampleEn ?? s.example_en ?? '').join('\n'),
    example_cn: list.map(s => s.exampleCn ?? s.example_cn ?? '').join('\n'),
  });
  // 前端逐义项编辑时按位置对齐，长度不一致则直接按前端顺序取
  if (parsed.length !== list.length) {
    return list.map(s => ({
      pos: String(s.pos || '').trim() || null,
      def_cn: String(s.defCn ?? s.def_cn ?? '').trim() || null,
      def_en: String(s.defEn ?? s.def_en ?? '').trim() || null,
      example_en: String(s.exampleEn ?? s.example_en ?? '').trim() || null,
      example_cn: String(s.exampleCn ?? s.example_cn ?? '').trim() || null,
    }));
  }
  return parsed;
}

export function getWord(db, id) {
  const w = db.prepare(`
    SELECT w.*, b.name AS bankName FROM word w JOIN word_bank b ON b.id=w.bank_id WHERE w.id=?`).get(id);
  const senses = db.prepare(`SELECT * FROM word_sense WHERE word_id=? ORDER BY sort`).all(id);
  return {
    id: w.id, bankId: w.bank_id, bankName: w.bankName, word: w.word,
    phoneticUk: w.phonetic_uk, phoneticUs: w.phonetic_us, topic: w.topic,
    tags: w.tags ? splitTags(w.tags).join(',') : '', level: w.level, notes: w.notes,
    needsReview: !!w.needs_review, createdAt: w.created_at, updatedAt: w.updated_at,
    senses: senses.map(s => ({
      id: s.id, pos: s.pos, defCn: s.def_cn, defEn: s.def_en, defEnSource: s.def_en_source,
      exampleEn: s.example_en, exampleCn: s.example_cn, sort: s.sort,
    })),
  };
}
