/** 听写句库：CRUD、结构化导入（预览/落库）、统计 */
import { readTable } from '../lib/excel.js';
import { DICTATION_COLUMNS, suggestDictationMap } from '../lib/dictationexcel.js';
import { topicsForLevel, hasTaxonomy } from '../../shared/topic-taxonomy.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';

const MAX_ROWS = 20000;
const splitTags = t => String(t || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);

export function publicItem(row, { withTokens = true } = {}) {
  if (!row) return null;
  const item = {
    id: row.id,
    sentenceEn: row.sentence_en,
    sentenceCn: row.sentence_cn || '',
    level: row.level || '',
    topic: row.topic || '',
    tags: row.tags || '',
    source: row.source || '',
    grammarLabel: row.grammar_label || '',
    analysis: row.analysis || '',
    needsReview: !!row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withTokens) {
    try { item.tokens = JSON.parse(row.tokens_json || '[]'); } catch { item.tokens = []; }
  }
  return item;
}

export function listDictation(db, { q = '', level = '', topic = '', needs = null, page = 1, size = 20 } = {}) {
  const p = { size: Math.min(100, Math.max(1, Number(size) || 20)) };
  p.off = (Math.max(1, Number(page) || 1) - 1) * p.size;
  const where = ['1=1'];
  if (q) { p.q = `%${String(q).trim()}%`; where.push('(sentence_en LIKE @q OR sentence_cn LIKE @q)'); }
  if (level) { p.level = level; where.push('level=@level'); }
  if (topic) { p.topic = topic; where.push('topic=@topic'); }
  if (needs === 0 || needs === 1) { p.needs = needs; where.push('needs_review=@needs'); }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM dictation_item WHERE ${W}`).get(p).c;
  const items = db.prepare(`SELECT * FROM dictation_item WHERE ${W} ORDER BY id DESC LIMIT @size OFFSET @off`)
    .all(p).map(r => publicItem(r, { withTokens: false }));
  return { total, page: Number(page) || 1, size: p.size, items };
}

export function getDictation(db, id) {
  const row = db.prepare(`SELECT * FROM dictation_item WHERE id=?`).get(Number(id));
  if (!row) throw notFound('题目不存在');
  return publicItem(row);
}

function normalizeTokens(tokens) {
  if (!tokens) return null;
  const arr = Array.isArray(tokens) ? tokens : (() => { try { return JSON.parse(String(tokens)); } catch { return null; } })();
  if (!Array.isArray(arr)) return null;
  return arr.map(t => ({
    w: String(t.w ?? t.word ?? '').trim(),
    pos: String(t.pos ?? '').trim(),
    ipa: String(t.ipa ?? t.phonetic ?? '').trim(),
    cn: String(t.cn ?? t.meaning ?? '').trim(),
  })).filter(t => t.w);
}

function normalizeBody(body) {
  const sentenceEn = String(body.sentenceEn ?? body.sentence_en ?? '').trim().replace(/\s+/g, ' ');
  const sentenceCn = String(body.sentenceCn ?? body.sentence_cn ?? '').trim();
  if (!sentenceEn) throw badRequest('empty_sentence', '英文句子不能为空');
  if (!/[A-Za-z]/.test(sentenceEn)) throw badRequest('bad_sentence', '英文句子需要包含英文字母');
  if (!sentenceCn) throw badRequest('empty_cn', '中文意思不能为空');
  if (sentenceEn.length > 300) throw badRequest('sentence_too_long', '句子太长（上限 300 字符）');
  return {
    sentenceEn,
    sentenceCn,
    tokensJson: (() => { const t = normalizeTokens(body.tokens); return t ? JSON.stringify(t) : null; })(),
    grammarLabel: String(body.grammarLabel ?? body.grammar_label ?? '').trim() || null,
    analysis: String(body.analysis ?? '').trim() || null,
    level: String(body.level ?? '').trim().toUpperCase() || null,
    topic: String(body.topic ?? '').trim() || null,
    tags: splitTags(body.tags).join(','),
    source: String(body.source ?? '').trim() || null,
    needsReview: body.needsReview ? 1 : 0,
  };
}

export function createDictation(db, body) {
  const v = normalizeBody(body);
  const exist = db.prepare(`SELECT id FROM dictation_item WHERE lower(sentence_en)=lower(?)`).get(v.sentenceEn);
  if (exist) throw conflict('dup_item', '同一英文句子已存在');
  const info = db.prepare(`
    INSERT INTO dictation_item(sentence_en,sentence_cn,tokens_json,grammar_label,analysis,level,topic,tags,source,needs_review)
    VALUES(@sentenceEn,@sentenceCn,@tokensJson,@grammarLabel,@analysis,@level,@topic,@tags,@source,@needsReview)`)
    .run(v);
  return getDictation(db, info.lastInsertRowid);
}

export function updateDictation(db, id, body) {
  const cur = db.prepare(`SELECT * FROM dictation_item WHERE id=?`).get(Number(id));
  if (!cur) throw notFound('题目不存在');
  const v = normalizeBody({
    sentenceEn: body.sentenceEn ?? cur.sentence_en,
    sentenceCn: body.sentenceCn ?? cur.sentence_cn,
    tokens: body.tokens ?? (cur.tokens_json ? JSON.parse(cur.tokens_json) : null),
    grammarLabel: body.grammarLabel ?? cur.grammar_label,
    analysis: body.analysis ?? cur.analysis,
    level: body.level ?? cur.level,
    topic: body.topic ?? cur.topic,
    tags: body.tags ?? cur.tags,
    source: body.source ?? cur.source,
    needsReview: body.needsReview ?? !!cur.needs_review,
  });
  const dup = db.prepare(`SELECT id FROM dictation_item WHERE lower(sentence_en)=lower(?) AND id<>?`).get(v.sentenceEn, Number(id));
  if (dup) throw conflict('dup_item', '同一英文句子已存在');
  db.prepare(`
    UPDATE dictation_item SET sentence_en=@sentenceEn, sentence_cn=@sentenceCn, tokens_json=@tokensJson,
      grammar_label=@grammarLabel, analysis=@analysis, level=@level, topic=@topic, tags=@tags,
      source=@source, needs_review=@needsReview, updated_at=datetime('now','localtime') WHERE id=@id`)
    .run({ ...v, id: Number(id) });
  return getDictation(db, id);
}

export function deleteDictation(db, id) {
  const n = db.prepare(`DELETE FROM dictation_item WHERE id=?`).run(Number(id)).changes;
  if (!n) throw notFound('题目不存在');
  return { ok: true };
}

export function batchDeleteDictation(db, ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  const stmt = db.prepare(`DELETE FROM dictation_item WHERE id=?`);
  let deleted = 0;
  db.transaction(() => { for (const id of list) deleted += stmt.run(id).changes; })();
  return { deleted };
}

function validateRow(fields) {
  const errs = [];
  const warns = [];
  const sentenceEn = String(fields.sentenceEn ?? '').trim().replace(/\s+/g, ' ');
  const sentenceCn = String(fields.sentenceCn ?? '').trim();
  if (!sentenceEn) errs.push({ field: 'sentenceEn', code: 'empty_sentence', message: '英文句子为空' });
  else {
    if (!/[A-Za-z]/.test(sentenceEn)) errs.push({ field: 'sentenceEn', code: 'bad_sentence', message: '英文句子需要包含英文字母' });
    if (sentenceEn.length > 300) errs.push({ field: 'sentenceEn', code: 'too_long', message: '句子超过 300 字符' });
    const wc = sentenceEn.split(/\s+/).length;
    if (wc < 2) warns.push({ field: 'sentenceEn', code: 'short_sentence', message: '句子只有 1 个词，不太适合听写' });
    if (wc > 24) warns.push({ field: 'sentenceEn', code: 'long_sentence', message: '句子超过 24 词，听写偏长' });
  }
  if (!sentenceCn) errs.push({ field: 'sentenceCn', code: 'empty_cn', message: '中文意思为空' });
  const level = String(fields.level ?? '').trim().toUpperCase();
  const topic = String(fields.topic ?? '').trim();
  if (level && topic && hasTaxonomy(level) && !topicsForLevel(level).some(t => t.key === topic)) {
    warns.push({ field: 'topic', code: 'topic_not_in_taxonomy', message: `主题「${topic}」不在 ${level} 官方 Topic 表内` });
  }
  return {
    ok: errs.length === 0, errs, warns,
    value: {
      sentenceEn, sentenceCn,
      tokens: normalizeTokens(fields.tokens),
      grammarLabel: String(fields.grammarLabel ?? '').trim() || null,
      analysis: String(fields.analysis ?? '').trim() || null,
      level: level || null, topic: topic || null,
      tags: splitTags(fields.tags).join(','),
      source: String(fields.source ?? '').trim() || null,
    },
  };
}

export async function importDictation(db, {
  buffer, filename, sheet = null, headerRow = 1, columnMap = null, onDuplicate = 'skip', dryRun = false,
} = {}) {
  if (!buffer || !buffer.length) throw badRequest('no_file', '请选择要导入的文件');
  const table = await readTable(buffer, { filename, sheet, headerRow });
  const suggested = suggestDictationMap(table.headers);
  const map = { ...suggested, ...(columnMap || {}) };
  for (const k of Object.keys(map)) if (!DICTATION_COLUMNS.some(c => c.field === map[k])) delete map[k];
  if (!Object.values(map).includes('sentenceEn')) {
    throw badRequest('no_required_column', '没有识别到「句子」列，请检查表头或手动指定列映射', { headers: table.headers });
  }
  const dataRows = table.rows.slice(table.headerRow);
  if (dataRows.length > MAX_ROWS) throw badRequest('too_many_rows', `数据行数 ${dataRows.length} 超过上限 ${MAX_ROWS}`);

  const errors = [];
  const rows = [];
  const seen = new Set();
  dataRows.forEach((cells, idx) => {
    const rowNo = table.headerRow + idx + 1;
    if (!cells || cells.every(c => String(c ?? '').trim() === '')) return;
    const fields = {};
    table.headers.forEach((h, i) => {
      const f = map[h];
      if (!f) return;
      const v = String(cells[i] ?? '').trim();
      if (v) fields[f] = v;
    });
    if (/示例/.test(String(fields.sentenceEn || '')) && /忽略|可删除/.test(String(fields.sentenceEn || ''))) return;
    const r = validateRow(fields);
    for (const e of r.errs) errors.push({ rowNo, title: r.value.sentenceEn, severity: 'error', ...e });
    for (const w of r.warns) errors.push({ rowNo, title: r.value.sentenceEn, severity: 'warn', ...w });
    const key = r.value.sentenceEn.toLowerCase();
    if (seen.has(key)) {
      errors.push({ rowNo, title: r.value.sentenceEn, severity: 'warn', field: 'sentenceEn', code: 'dup_in_file', message: '文件内重复句子' });
      return;
    }
    seen.add(key);
    if (r.ok) rows.push({ rowNo, ...r.value });
  });

  const existing = new Set(db.prepare(`SELECT lower(sentence_en) AS k FROM dictation_item`).all().map(r => r.k));
  const stats = {
    totalRows: dataRows.filter(c => c && c.some(x => String(x ?? '').trim() !== '')).length,
    validRows: rows.length,
    errorRows: new Set(errors.filter(e => e.severity === 'error').map(e => e.rowNo)).size,
    warnRows: new Set(errors.filter(e => e.severity === 'warn').map(e => e.rowNo)).size,
    inserted: 0, updated: 0, skipped: 0,
  };
  const ins = db.prepare(`
    INSERT INTO dictation_item(sentence_en,sentence_cn,tokens_json,grammar_label,analysis,level,topic,tags,source)
    VALUES(@sentenceEn,@sentenceCn,@tokens_json,@grammarLabel,@analysis,@level,@topic,@tags,@source)`);
  const upd = db.prepare(`
    UPDATE dictation_item SET sentence_cn=@sentenceCn, tokens_json=@tokens_json, grammar_label=@grammarLabel,
      analysis=@analysis, level=@level, topic=@topic, tags=@tags, source=@source,
      updated_at=datetime('now','localtime') WHERE lower(sentence_en)=lower(@sentenceEn)`);
  if (!dryRun) {
    db.transaction(() => {
      for (const r of rows) {
        const params = { ...r, tokens_json: r.tokens ? JSON.stringify(r.tokens) : null };
        if (existing.has(r.sentenceEn.toLowerCase())) {
          if (onDuplicate === 'overwrite') { upd.run(params); stats.updated++; } else stats.skipped++;
        } else { ins.run(params); stats.inserted++; }
      }
    })();
  } else {
    stats.skipped = rows.filter(r => existing.has(r.sentenceEn.toLowerCase())).length;
  }
  return { stats, errors, rows, headers: table.headers, map, suggestedMap: suggested, sheet: table.sheet, headerRow: table.headerRow };
}
