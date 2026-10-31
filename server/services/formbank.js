/**
 * 变形填空题库：CRUD、结构化导入（预览 / 落库）、导出、统计。
 *
 * 题目模型：prompt（带 ____ 的句子）+ base（括号里的原型）+ answer（正确变形）
 * + accepted（可判对的其他写法）+ point（考点）+ 可选主题/标签/等级/解析。
 */
import { readTable } from '../lib/excel.js';
import { FORM_COLUMNS, suggestFormMap, buildFormTemplate, exportFormItems } from '../lib/formexcel.js';
import { topicsForLevel, hasTaxonomy } from '../../shared/topic-taxonomy.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';

export { FORM_COLUMNS, buildFormTemplate, exportFormItems, suggestFormMap };

const BLANK = '____';
const BLANK_RE = /_{2,}|＿{2,}|\{\s*(?:blank|answer|word|空|答案)?\s*\}|\[\s*\]|（\s*）|\(\s*\)/gi;
const MAX_ROWS = 5000;

/** 统一答案写法：去首尾空白、合并空格、统一引号、去句末标点、转小写 */
export function normalizeAnswer(text) {
  return String(text ?? '')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s*([,.!?;:]+)\s*$/, '')
    .trim();
}

/** 句子里的空位统一成 ____；去掉括号里重复给出的原型提示 */
export function normalizePrompt(prompt, base = '') {
  let s = String(prompt ?? '').replace(BLANK_RE, BLANK).replace(/\s+/g, ' ').trim();
  // 没有 base 时，也把紧跟在空位后面的括号原型提示去掉（常见写法：I ____(arrive) school）
  s = s.replace(/____\s*[（(]\s*([A-Za-z][A-Za-z' -]{0,19})\s*[)）]/g, BLANK).replace(/\s+/g, ' ').trim();
  if (base) {
    const b = String(base).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\s*[（(]\\s*${b}\\s*[)）]`, 'gi'), '').replace(/\s+/g, ' ').trim();
  }
  return s;
}

/** answer / accepted 列拆成去重后的答案数组（|、/、；分隔） */
export function splitAlternatives(...texts) {
  const out = [];
  for (const t of texts) {
    for (const part of String(t ?? '').split(/[|｜/；;、]/)) {
      const n = normalizeAnswer(part);
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const splitTags = t => String(t || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);

function publicItem(row, { withAnswer = true } = {}) {
  if (!row) return null;
  const accepted = JSON.parse(row.accepted_json || '[]');
  const item = {
    id: row.id,
    prompt: row.prompt,
    base: row.base,
    point: row.point || '',
    level: row.level || '',
    topic: row.topic || '',
    tags: row.tags || '',
    explain: row.explain || '',
    sentenceCn: row.sentence_cn || '',
    wordCn: row.word_cn || '',
    notes: row.notes || '',
    needsReview: !!row.needs_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (withAnswer) {
    item.answer = row.answer;
    item.accepted = accepted;
  }
  return item;
}

/** 列表（管理端用，含答案） */
export function listItems(db, { q = '', point = '', topic = '', level = '', tag = '', needs = null, page = 1, size = 20 } = {}) {
  const p = { size: Math.min(100, Math.max(1, Number(size) || 20)) };
  p.off = (Math.max(1, Number(page) || 1) - 1) * p.size;
  const where = ['1=1'];
  if (q) {
    p.q = `%${String(q).trim()}%`;
    where.push('(prompt LIKE @q OR base LIKE @q OR answer LIKE @q OR explain LIKE @q)');
  }
  if (point) { p.point = point; where.push('point=@point'); }
  if (topic) { p.topic = topic; where.push('topic=@topic'); }
  if (level) { p.level = level; where.push('level=@level'); }
  if (tag) { p.tag = tag; where.push(`(','||tags||',') LIKE '%,' || @tag || ',%'`); }
  if (needs === 0 || needs === 1) { p.needs = needs; where.push('needs_review=@needs'); }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transform_item WHERE ${W}`).get(p).c;
  const items = db.prepare(`SELECT * FROM transform_item WHERE ${W} ORDER BY id DESC LIMIT @size OFFSET @off`).all(p).map(r => publicItem(r));
  return { total, page: Number(page) || 1, size: p.size, items };
}

export function getItem(db, id) {
  const row = db.prepare(`SELECT * FROM transform_item WHERE id=?`).get(Number(id));
  if (!row) throw notFound('题目不存在');
  return publicItem(row);
}

function normalizeBody(body) {
  const prompt = normalizePrompt(body.prompt, body.base);
  const base = String(body.base ?? '').trim();
  const answer = String(body.answer ?? '').trim();
  if (!prompt) throw badRequest('empty_prompt', '句子不能为空');
  if (!prompt.includes(BLANK)) throw badRequest('no_blank', '句子里需要有 ____ 表示空位');
  if (!base) throw badRequest('empty_base', '请填写原型');
  if (!answer) throw badRequest('empty_answer', '请填写答案');
  const accepted = splitAlternatives(answer, ...(Array.isArray(body.accepted) ? body.accepted : [body.accepted]));
  if (!accepted.length) throw badRequest('bad_answer', '答案无法解析');
  return {
    prompt,
    base,
    answer: accepted[0],
    accepted,
    point: String(body.point ?? '').trim() || null,
    level: String(body.level ?? '').trim().toUpperCase() || null,
    topic: String(body.topic ?? '').trim() || null,
    tags: splitTags(body.tags).join(','),
    explain: String(body.explain ?? '').trim() || null,
    sentenceCn: String(body.sentenceCn ?? body.sentence_cn ?? '').trim() || null,
    wordCn: String(body.wordCn ?? body.word_cn ?? '').trim() || null,
    notes: String(body.notes ?? '').trim() || null,
    needsReview: body.needsReview ? 1 : 0,
  };
}

const upsert = db => db.prepare(`
  INSERT INTO transform_item(prompt,base,answer,accepted_json,point,level,topic,tags,explain,sentence_cn,word_cn,notes,needs_review)
  VALUES(@prompt,@base,@answer,@accepted,@point,@level,@topic,@tags,@explain,@sentenceCn,@wordCn,@notes,@needsReview)
  ON CONFLICT(prompt, base_norm) DO UPDATE SET
    answer=excluded.answer, accepted_json=excluded.accepted_json, point=excluded.point,
    level=excluded.level, topic=excluded.topic, tags=excluded.tags, explain=excluded.explain,
    sentence_cn=excluded.sentence_cn, word_cn=excluded.word_cn,
    notes=excluded.notes, needs_review=excluded.needs_review,
    updated_at=datetime('now','localtime')`);

export function createItem(db, body) {
  const v = normalizeBody(body);
  const exist = db.prepare(`SELECT id FROM transform_item WHERE prompt=? AND base_norm=lower(trim(?))`).get(v.prompt, v.base);
  if (exist) throw conflict('dup_item', '同一句子 + 原型已存在');
  const info = db.prepare(`
    INSERT INTO transform_item(prompt,base,answer,accepted_json,point,level,topic,tags,explain,sentence_cn,word_cn,notes,needs_review)
    VALUES(@prompt,@base,@answer,@accepted,@point,@level,@topic,@tags,@explain,@sentenceCn,@wordCn,@notes,@needsReview)`)
    .run({ ...v, accepted: JSON.stringify(v.accepted) });
  return getItem(db, info.lastInsertRowid);
}

export function updateItem(db, id, body) {
  const cur = db.prepare(`SELECT * FROM transform_item WHERE id=?`).get(Number(id));
  if (!cur) throw notFound('题目不存在');
  const v = normalizeBody({
    prompt: body.prompt ?? cur.prompt,
    base: body.base ?? cur.base,
    answer: body.answer ?? cur.answer,
    accepted: body.accepted ?? JSON.parse(cur.accepted_json || '[]'),
    point: body.point ?? cur.point,
    level: body.level ?? cur.level,
    topic: body.topic ?? cur.topic,
    tags: body.tags ?? cur.tags,
    explain: body.explain ?? cur.explain,
    sentenceCn: body.sentenceCn ?? cur.sentence_cn,
    wordCn: body.wordCn ?? cur.word_cn,
    notes: body.notes ?? cur.notes,
    needsReview: body.needsReview ?? !!cur.needs_review,
  });
  const dup = db.prepare(`SELECT id FROM transform_item WHERE prompt=? AND base_norm=lower(trim(?)) AND id<>?`)
    .get(v.prompt, v.base, Number(id));
  if (dup) throw conflict('dup_item', '同一句子 + 原型已存在');
  db.prepare(`
    UPDATE transform_item SET prompt=@prompt, base=@base, answer=@answer, accepted_json=@accepted,
      point=@point, level=@level, topic=@topic, tags=@tags, explain=@explain,
      sentence_cn=@sentenceCn, word_cn=@wordCn, notes=@notes,
      needs_review=@needsReview, updated_at=datetime('now','localtime')
    WHERE id=@id`).run({ ...v, accepted: JSON.stringify(v.accepted), id: Number(id) });
  return getItem(db, id);
}

export function deleteItem(db, id) {
  const n = db.prepare(`DELETE FROM transform_item WHERE id=?`).run(Number(id)).changes;
  if (!n) throw notFound('题目不存在');
  return { ok: true };
}

export function batchDelete(db, ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return { deleted: 0 };
  const stmt = db.prepare(`DELETE FROM transform_item WHERE id=?`);
  let deleted = 0;
  db.transaction(() => { for (const id of list) deleted += stmt.run(id).changes; })();
  return { deleted };
}

/** 题库统计：总量 + 按考点/主题/等级分组，供练习页筛选展示 */
export function formStats(db) {
  const total = db.prepare(`SELECT COUNT(*) AS c FROM transform_item`).get().c;
  const byPoint = db.prepare(`SELECT COALESCE(NULLIF(point,''),'（未标注）') AS point, COUNT(*) AS count
                              FROM transform_item GROUP BY point ORDER BY count DESC, point`).all();
  const byTopic = db.prepare(`SELECT COALESCE(NULLIF(topic,''),'（未分类）') AS topic, COUNT(*) AS count
                              FROM transform_item GROUP BY topic ORDER BY count DESC, topic`).all();
  const byLevel = db.prepare(`SELECT COALESCE(NULLIF(level,''),'（未分级）') AS level, COUNT(*) AS count
                              FROM transform_item GROUP BY level ORDER BY count DESC, level`).all();
  return { total, byPoint, byTopic, byLevel };
}

// ───────────────────────────── 结构化导入 ─────────────────────────────

function validateRow(fields, { level, topic }) {
  const errs = [];
  const warns = [];
  const base = String(fields.base ?? '').trim();
  const prompt = normalizePrompt(fields.prompt, base);
  const answerRaw = String(fields.answer ?? '').trim();

  if (!String(fields.prompt ?? '').trim()) errs.push({ field: 'prompt', code: 'empty_prompt', message: '句子为空' });
  else if (!prompt.includes(BLANK)) errs.push({ field: 'prompt', code: 'no_blank', message: '句子里没有空位（请用 ____ 表示）' });
  else if (prompt.length > 300) errs.push({ field: 'prompt', code: 'prompt_too_long', message: '句子超过 300 字符' });

  if (!base) errs.push({ field: 'base', code: 'empty_base', message: '原型为空' });
  else if (base.length > 40) errs.push({ field: 'base', code: 'base_too_long', message: '原型超过 40 字符' });
  else if (!/[A-Za-z]/.test(base)) errs.push({ field: 'base', code: 'base_not_english', message: '原型需要包含英文字母' });

  if (!answerRaw) errs.push({ field: 'answer', code: 'empty_answer', message: '答案为空' });
  else if (answerRaw.length > 80) errs.push({ field: 'answer', code: 'answer_too_long', message: '答案超过 80 字符' });

  const accepted = splitAlternatives(answerRaw, fields.accepted);
  if (answerRaw && !accepted.length) errs.push({ field: 'answer', code: 'bad_answer', message: '答案无法解析' });
  const pointText = String(fields.point ?? '').trim();
  const particleFill = ['介词', '固定搭配', '词性', '连词'].some(p => pointText.includes(p));
  if (!particleFill && accepted.length && accepted.length === 1 && accepted[0] === normalizeAnswer(base)) {
    warns.push({ field: 'answer', code: 'same_as_base', message: '答案与原型相同，确认是否漏了变形' });
  }

  const lv = String(fields.level ?? level ?? '').trim().toUpperCase();
  const tp = String(fields.topic ?? topic ?? '').trim();
  if (lv && tp && hasTaxonomy(lv) && !topicsForLevel(lv).some(t => t.key === tp)) {
    warns.push({ field: 'topic', code: 'topic_not_in_taxonomy', message: `主题「${tp}」不在 ${lv} 官方 Topic 表内` });
  }
  return {
    ok: errs.length === 0,
    errs,
    warns,
    value: {
      prompt,
      base,
      answer: accepted[0],
      accepted,
      point: String(fields.point ?? '').trim() || null,
      level: lv || null,
      topic: tp || null,
      tags: splitTags(fields.tags).join(','),
      explain: String(fields.explain ?? '').trim() || null,
      sentenceCn: String(fields.sentenceCn ?? '').trim() || null,
      wordCn: String(fields.wordCn ?? '').trim() || null,
      notes: String(fields.notes ?? '').trim() || null,
    },
  };
}

/**
 * 解析并（可选）导入变形题。
 * @returns {{stats:{totalRows,validRows,errorRows,warnRows,inserted,updated,skipped}, errors:Array, rows:Array, headers:Array, map:Object, sheet:string, headerRow:number}}
 */
export async function importFormItems(db, {
  buffer, filename, sheet = null, headerRow = 1, columnMap = null, onDuplicate = 'skip', dryRun = false,
} = {}) {
  if (!buffer || !buffer.length) throw badRequest('no_file', '请选择要导入的文件');
  const table = await readTable(buffer, { filename, sheet, headerRow });
  const suggested = suggestFormMap(table.headers);
  const map = { ...suggested, ...(columnMap || {}) };
  for (const k of Object.keys(map)) if (!FORM_COLUMNS.some(c => c.field === map[k])) delete map[k];
  if (!Object.values(map).includes('prompt') || !Object.values(map).includes('base')) {
    throw badRequest('no_required_column', '没有识别到「句子」或「原型」列，请检查表头或手动指定列映射', { headers: table.headers });
  }

  const dataRows = table.rows.slice(table.headerRow);
  if (dataRows.length > MAX_ROWS) throw badRequest('too_many_rows', `数据行数 ${dataRows.length} 超过上限 ${MAX_ROWS}`);

  const errors = [];
  const rows = [];
  const seen = new Map();
  dataRows.forEach((cells, idx) => {
    const rowNo = table.headerRow + idx + 1;
    if (!cells || cells.every(c => String(c ?? '').trim() === '')) return;
    const fields = {};
    table.headers.forEach((h, i) => {
      const f = map[h];
      if (!f) return;
      const v = String(cells[i] ?? '').trim();
      if (!v) return;
      // 同一字段多列时，非答案字段取第一个，答案类字段拼接
      if (!fields[f]) fields[f] = v;
      else if (['answer', 'accepted'].includes(f)) fields[f] += `|${v}`;
    });
    // 示例行跳过
    if (/示例/.test(String(fields.prompt || '')) && /忽略|可删除/.test(String(fields.prompt || ''))) return;

    const r = validateRow(fields, { level: null, topic: null });
    const key = `${r.value.prompt}\u0000${r.value.base.toLowerCase()}`;
    for (const e of r.errs) errors.push({ rowNo, base: r.value.base, severity: 'error', ...e });
    for (const w of r.warns) errors.push({ rowNo, base: r.value.base, severity: 'warn', ...w });
    if (seen.has(key)) {
      errors.push({ rowNo, base: r.value.base, severity: 'warn', field: 'prompt', code: 'dup_in_file', message: '文件内重复题目' });
      return;
    }
    seen.set(key, rowNo);
    if (r.ok) rows.push({ rowNo, ...r.value });
  });

  const existing = new Set(db.prepare(`SELECT prompt || char(0) || base_norm AS k FROM transform_item`).all().map(r => r.k));
  const stats = { totalRows: dataRows.filter(c => c && c.some(x => String(x ?? '').trim() !== '')).length, validRows: rows.length, errorRows: 0, warnRows: 0, inserted: 0, updated: 0, skipped: 0 };
  stats.errorRows = new Set(errors.filter(e => e.severity === 'error').map(e => e.rowNo)).size;
  stats.warnRows = new Set(errors.filter(e => e.severity === 'warn').map(e => e.rowNo)).size;

  const insertStmt = db.prepare(`
    INSERT INTO transform_item(prompt,base,answer,accepted_json,point,level,topic,tags,explain,sentence_cn,word_cn,notes)
    VALUES(@prompt,@base,@answer,@accepted,@point,@level,@topic,@tags,@explain,@sentenceCn,@wordCn,@notes)`);
  const updateStmt = db.prepare(`
    UPDATE transform_item SET answer=@answer, accepted_json=@accepted, point=@point, level=@level,
      topic=@topic, tags=@tags, explain=@explain, sentence_cn=@sentenceCn, word_cn=@wordCn,
      notes=@notes, updated_at=datetime('now','localtime')
    WHERE prompt=@prompt AND base_norm=lower(trim(@base))`);

  if (!dryRun) {
    db.transaction(() => {
      for (const r of rows) {
        const key = `${r.prompt}\u0000${r.base.toLowerCase()}`;
        const params = { ...r, accepted: JSON.stringify(r.accepted) };
        if (existing.has(key)) {
          if (onDuplicate === 'overwrite') { updateStmt.run(params); stats.updated++; }
          else stats.skipped++;
        } else {
          insertStmt.run(params); stats.inserted++;
        }
      }
    })();
  } else if (onDuplicate) {
    stats.skipped = rows.filter(r => existing.has(`${r.prompt}\u0000${r.base.toLowerCase()}`)).length;
  }

  return {
    stats, errors, rows, headers: table.headers, map, suggestedMap: suggested,
    sheet: table.sheet, headerRow: table.headerRow,
  };
}

/** 启动/初始化时写入内置题库（表为空才写，幂等） */
export async function seedFormItems(db, csvBuffer, filename = 'form-items.csv') {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM transform_item`).get().c;
  if (count > 0) return { skipped: true, count };
  const out = await importFormItems(db, { buffer: csvBuffer, filename, onDuplicate: 'skip' });
  return { skipped: false, ...out.stats };
}

export { publicItem };
