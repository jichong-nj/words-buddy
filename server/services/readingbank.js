/**
 * 阅读理解题库：文章 + 单选题的 CRUD、结构化导入（预览/落库）、导出、统计。
 * 导入按「标题」合并：同一标题多行 = 一篇文章的多道题（正文填在首行即可）。
 */
import { readTable } from '../lib/excel.js';
import { READING_COLUMNS, suggestReadingMap, buildReadingTemplate, exportReading } from '../lib/readingexcel.js';
import { topicsForLevel, hasTaxonomy } from '../../shared/topic-taxonomy.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';

export { READING_COLUMNS, buildReadingTemplate, exportReading, suggestReadingMap };

const MAX_ROWS = 20000;

const splitTags = t => String(t || '').split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
const cleanText = t => String(t ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** 选项答案：A/B/C/D、1/2/3/4 或选项原文 */
export function parseAnswerIndex(raw, options = []) {
  if (raw === null || raw === undefined || raw === '') return -1;
  const v = String(raw).trim();
  const letter = v.toUpperCase();
  if (/^[A-D]$/.test(letter)) return letter.charCodeAt(0) - 65;
  if (/^[1-4]$/.test(v)) return Number(v) - 1;
  const idx = options.findIndex(o => String(o).trim() === v);
  return idx;
}

export function publicPassage(row, { withQuestions = true } = {}) {
  if (!row) return null;
  const p = {
    id: row.id, title: row.title, text: row.text, level: row.level || '', topic: row.topic || '',
    tags: row.tags || '', source: row.source || '', wordCount: row.word_count || 0,
    needsReview: !!row.needs_review, createdAt: row.created_at, updatedAt: row.updated_at,
    questionCount: row.question_count ?? undefined,
  };
  if (withQuestions) {
    const qs = row.questions || [];
    p.questions = qs.map(q => ({
      id: q.id, seq: q.seq, stem: q.stem,
      options: JSON.parse(q.options_json || '[]'),
      answerIndex: q.answer_index,
      explain: q.explain || '',
    }));
  }
  return p;
}

function questionsOf(db, passageId) {
  return db.prepare(`SELECT * FROM reading_question WHERE passage_id=? ORDER BY seq`).all(passageId);
}

export function listPassages(db, { q = '', topic = '', level = '', tag = '', needs = null, page = 1, size = 20 } = {}) {
  const p = { size: Math.min(100, Math.max(1, Number(size) || 20)) };
  p.off = (Math.max(1, Number(page) || 1) - 1) * p.size;
  const where = ['1=1'];
  if (q) { p.q = `%${String(q).trim()}%`; where.push('(title LIKE @q OR text LIKE @q)'); }
  if (topic) { p.topic = topic; where.push('topic=@topic'); }
  if (level) { p.level = level; where.push('level=@level'); }
  if (tag) { p.tag = tag; where.push(`(','||tags||',') LIKE '%,' || @tag || ',%'`); }
  if (needs === 0 || needs === 1) { p.needs = needs; where.push('needs_review=@needs'); }
  const W = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS c FROM reading_passage WHERE ${W}`).get(p).c;
  const rows = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM reading_question q WHERE q.passage_id=p.id) AS question_count
    FROM reading_passage p WHERE ${W} ORDER BY p.id DESC LIMIT @size OFFSET @off`).all(p);
  return { total, page: Number(page) || 1, size: p.size, items: rows.map(r => publicPassage(r, { withQuestions: false })) };
}

export function getPassage(db, id, { includeAnswer = true } = {}) {
  const row = db.prepare(`SELECT * FROM reading_passage WHERE id=?`).get(Number(id));
  if (!row) throw notFound('文章不存在');
  row.questions = questionsOf(db, row.id);
  const out = publicPassage(row);
  if (!includeAnswer) for (const q of out.questions) delete q.answerIndex;
  return out;
}

function normalizeQuestions(list) {
  if (!Array.isArray(list) || !list.length) throw badRequest('no_questions', '至少需要一道题');
  return list.map((q, i) => {
    const stem = String(q.stem ?? '').trim();
    const options = (q.options || []).map(o => String(o ?? '').trim());
    if (!stem) throw badRequest('empty_stem', `第 ${i + 1} 题题干为空`);
    if (options.length !== 4 || options.some(o => !o)) throw badRequest('bad_options', `第 ${i + 1} 题需要 4 个非空选项`);
    const answerIndex = Number(q.answerIndex);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      throw badRequest('bad_answer', `第 ${i + 1} 题正确答案需为 A/B/C/D`);
    }
    return { seq: Number(q.seq) || i + 1, stem, options, answerIndex, explain: String(q.explain ?? '').trim() || null };
  });
}

function normalizePassage(body) {
  const title = String(body.title ?? '').trim();
  const text = cleanText(body.text);
  if (!title) throw badRequest('empty_title', '标题不能为空');
  if (!text) throw badRequest('empty_text', '正文不能为空');
  return {
    title,
    text,
    level: String(body.level ?? '').trim().toUpperCase() || null,
    topic: String(body.topic ?? '').trim() || null,
    tags: splitTags(body.tags).join(','),
    source: String(body.source ?? '').trim() || null,
    needsReview: body.needsReview ? 1 : 0,
    wordCount: (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length,
  };
}

const insertQuestion = db => db.prepare(`
  INSERT INTO reading_question(passage_id,seq,stem,options_json,answer_index,explain)
  VALUES(?,?,?,?,?,?)`);

export function createPassage(db, body) {
  const p = normalizePassage(body);
  if (db.prepare(`SELECT id FROM reading_passage WHERE title=?`).get(p.title)) {
    throw conflict('dup_title', '同标题的文章已存在');
  }
  const qs = normalizeQuestions(body.questions);
  let id;
  db.transaction(() => {
    id = db.prepare(`
      INSERT INTO reading_passage(title,text,level,topic,tags,source,word_count,needs_review)
      VALUES(@title,@text,@level,@topic,@tags,@source,@wordCount,@needsReview)`).run(p).lastInsertRowid;
    const ins = insertQuestion(db);
    for (const q of qs) ins.run(id, q.seq, q.stem, JSON.stringify(q.options), q.answerIndex, q.explain);
  })();
  return getPassage(db, id);
}

export function updatePassage(db, id, body) {
  const cur = db.prepare(`SELECT * FROM reading_passage WHERE id=?`).get(Number(id));
  if (!cur) throw notFound('文章不存在');
  const merged = {
    title: body.title ?? cur.title,
    text: body.text ?? cur.text,
    level: body.level ?? cur.level,
    topic: body.topic ?? cur.topic,
    tags: body.tags ?? cur.tags,
    source: body.source ?? cur.source,
    needsReview: body.needsReview ?? !!cur.needs_review,
  };
  const p = normalizePassage(merged);
  const dup = db.prepare(`SELECT id FROM reading_passage WHERE title=? AND id<>?`).get(p.title, Number(id));
  if (dup) throw conflict('dup_title', '同标题的文章已存在');
  const qs = body.questions ? normalizeQuestions(body.questions) : null;
  db.transaction(() => {
    db.prepare(`
      UPDATE reading_passage SET title=@title,text=@text,level=@level,topic=@topic,tags=@tags,
        source=@source,word_count=@wordCount,needs_review=@needsReview,updated_at=datetime('now','localtime')
      WHERE id=@id`).run({ ...p, id: Number(id) });
    if (qs) {
      db.prepare(`DELETE FROM reading_question WHERE passage_id=?`).run(Number(id));
      const ins = insertQuestion(db);
      for (const q of qs) ins.run(Number(id), q.seq, q.stem, JSON.stringify(q.options), q.answerIndex, q.explain);
    }
  })();
  return getPassage(db, id);
}

export function deletePassage(db, id) {
  const n = db.prepare(`DELETE FROM reading_passage WHERE id=?`).run(Number(id)).changes;
  if (!n) throw notFound('文章不存在');
  return { ok: true };
}

export function batchDelete(db, ids) {
  const list = (ids || []).map(Number).filter(Boolean);
  if (!list.length) return { deleted: 0 };
  const stmt = db.prepare(`DELETE FROM reading_passage WHERE id=?`);
  let deleted = 0;
  db.transaction(() => { for (const id of list) deleted += stmt.run(id).changes; })();
  return { deleted };
}

export function readingPools(db) {
  const passages = db.prepare(`SELECT COUNT(*) AS c FROM reading_passage`).get().c;
  const questions = db.prepare(`SELECT COUNT(*) AS c FROM reading_question`).get().c;
  return {
    passages,
    questions,
    byTopic: db.prepare(`SELECT COALESCE(NULLIF(topic,''),'（未分类）') AS topic, COUNT(*) AS count
                         FROM reading_passage GROUP BY topic ORDER BY count DESC, topic`).all(),
    byLevel: db.prepare(`SELECT COALESCE(NULLIF(level,''),'（未分级）') AS level, COUNT(*) AS count
                        FROM reading_passage GROUP BY level ORDER BY count DESC, level`).all(),
    byTag: db.prepare(`SELECT tag, COUNT(*) AS count FROM (
                         SELECT TRIM(value) AS tag FROM reading_passage, json_each('["' || REPLACE(tags, ',', '","') || '"]')
                         WHERE tags <> '') GROUP BY tag ORDER BY count DESC LIMIT 20`).all(),
  };
}

// ───────────────────────────── 导入 ─────────────────────────────

function validateRow(fields) {
  const errs = [];
  const warns = [];
  const title = String(fields.title ?? '').trim();
  const text = cleanText(fields.text);
  if (!title) errs.push({ field: 'title', code: 'empty_title', message: '标题为空' });
  if (text && text.length < 80) warns.push({ field: 'text', code: 'short_text', message: '正文偏短（少于 80 字符）' });

  const stem = String(fields.stem ?? '').trim();
  const options = [fields.optionA, fields.optionB, fields.optionC, fields.optionD].map(o => String(o ?? '').trim());
  const answerRaw = String(fields.answer ?? '').trim();
  if (!stem) errs.push({ field: 'stem', code: 'empty_stem', message: '题干为空' });
  if (options.some(o => !o)) errs.push({ field: 'options', code: 'missing_option', message: '四个选项都要填写' });
  const answerIndex = parseAnswerIndex(answerRaw, options);
  if (answerIndex < 0) errs.push({ field: 'answer', code: 'bad_answer', message: '正确答案需为 A/B/C/D' });

  const level = String(fields.level ?? '').trim().toUpperCase();
  const topic = String(fields.topic ?? '').trim();
  if (level && topic && hasTaxonomy(level) && !topicsForLevel(level).some(t => t.key === topic)) {
    warns.push({ field: 'topic', code: 'topic_not_in_taxonomy', message: `主题「${topic}」不在 ${level} 官方 Topic 表内` });
  }
  return {
    ok: errs.length === 0, errs, warns,
    value: {
      title, text, level, topic,
      tags: splitTags(fields.tags).join(','),
      source: String(fields.source ?? '').trim(),
      seq: Number(fields.seq) || 0,
      stem, options, answerIndex,
      explain: String(fields.explain ?? '').trim(),
    },
  };
}

/**
 * 解析并（可选）导入阅读理解。dryRun=true 只校验；onDuplicate=skip|overwrite 控制同标题文章。
 */
export async function importReading(db, {
  buffer, filename, sheet = null, headerRow = 1, columnMap = null, onDuplicate = 'skip', dryRun = false,
} = {}) {
  if (!buffer || !buffer.length) throw badRequest('no_file', '请选择要导入的文件');
  const table = await readTable(buffer, { filename, sheet, headerRow });
  const suggested = suggestReadingMap(table.headers);
  const map = { ...suggested, ...(columnMap || {}) };
  for (const k of Object.keys(map)) if (!READING_COLUMNS.some(c => c.field === map[k])) delete map[k];
  if (!Object.values(map).includes('title') || !Object.values(map).includes('stem')) {
    throw badRequest('no_required_column', '没有识别到「标题」或「题干」列，请检查表头或手动指定列映射', { headers: table.headers });
  }

  const dataRows = table.rows.slice(table.headerRow);
  if (dataRows.length > MAX_ROWS) throw badRequest('too_many_rows', `数据行数 ${dataRows.length} 超过上限 ${MAX_ROWS}`);

  const errors = [];
  const rows = [];
  dataRows.forEach((cells, idx) => {
    const rowNo = table.headerRow + idx + 1;
    if (!cells || cells.every(c => String(c ?? '').trim() === '')) return;
    const fields = {};
    table.headers.forEach((h, i) => {
      const f = map[h];
      if (!f) return;
      const v = String(cells[i] ?? '').trim();
      if (!v) return;
      if (!fields[f]) fields[f] = v;
      else if (f === 'text') fields[f] += '\n' + v;
    });
    if (/示例/.test(String(fields.title || '')) && /忽略|可删除/.test(String(fields.title || ''))) return;
    const r = validateRow(fields);
    for (const e of r.errs) errors.push({ rowNo, title: r.value.title, severity: 'error', ...e });
    for (const w of r.warns) errors.push({ rowNo, title: r.value.title, severity: 'warn', ...w });
    if (r.ok) rows.push({ rowNo, ...r.value });
  });

  // 按标题聚合成文章
  const passages = new Map();
  for (const r of rows) {
    let p = passages.get(r.title);
    if (!p) {
      p = { title: r.title, text: r.text, level: r.level, topic: r.topic, tags: r.tags, source: r.source, questions: [] };
      passages.set(r.title, p);
    } else {
      if (!p.text && r.text) p.text = r.text;
      for (const k of ['level', 'topic', 'tags', 'source']) if (!p[k] && r[k]) p[k] = r[k];
    }
    if (r.seq) {
      if (p.questions.some(q => q.seq === r.seq)) {
        errors.push({ rowNo: r.rowNo, title: r.title, severity: 'error', field: 'seq', code: 'dup_seq', message: `题号 ${r.seq} 在同一篇内重复` });
        continue;
      }
    }
    p.questions.push({ seq: r.seq || p.questions.length + 1, stem: r.stem, options: r.options, answerIndex: r.answerIndex, explain: r.explain });
  }
  const passagesOut = [...passages.values()].filter(p => p.questions.length);
  for (const p of passagesOut) {
    if (!p.text) errors.push({ rowNo: 0, title: p.title, severity: 'error', field: 'text', code: 'empty_text', message: '该文章缺少正文（请在第一行填写正文）' });
    p.questions.sort((a, b) => a.seq - b.seq);
  }
  const badTitles = new Set(passagesOut.filter(p => !p.text).map(p => p.title));

  const existing = new Set(db.prepare(`SELECT title FROM reading_passage`).all().map(r => r.title));
  const stats = {
    totalRows: rows.length + new Set(errors.map(e => e.rowNo)).size,
    validRows: rows.length - badTitles.size,
    errorRows: new Set(errors.filter(e => e.severity === 'error').map(e => e.rowNo)).size,
    warnRows: new Set(errors.filter(e => e.severity === 'warn').map(e => e.rowNo)).size,
    inserted: 0, updated: 0, skipped: 0, questions: 0,
  };

  if (!dryRun) {
    const insP = db.prepare(`
      INSERT INTO reading_passage(title,text,level,topic,tags,source,word_count,needs_review)
      VALUES(@title,@text,@level,@topic,@tags,@source,@wordCount,@needsReview)`);
    const updP = db.prepare(`
      UPDATE reading_passage SET text=@text, level=@level, topic=@topic, tags=@tags, source=@source,
        word_count=@wordCount, updated_at=datetime('now','localtime') WHERE title=@title`);
    const insQ = insertQuestion(db);
    db.transaction(() => {
      for (const p of passagesOut) {
        if (badTitles.has(p.title)) continue;
        const wordCount = (p.text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length;
        const params = {
          title: p.title, text: p.text, level: p.level || null, topic: p.topic || null,
          tags: p.tags || '', source: p.source || null, wordCount, needsReview: 0,
        };
        let passageId;
        if (existing.has(p.title)) {
          if (onDuplicate !== 'overwrite') { stats.skipped++; continue; }
          updP.run(params);
          passageId = db.prepare(`SELECT id FROM reading_passage WHERE title=?`).get(p.title).id;
          db.prepare(`DELETE FROM reading_question WHERE passage_id=?`).run(passageId);
          stats.updated++;
        } else {
          passageId = insP.run(params).lastInsertRowid;
          stats.inserted++;
        }
        for (const q of p.questions) {
          insQ.run(passageId, q.seq, q.stem, JSON.stringify(q.options), q.answerIndex, q.explain || null);
          stats.questions++;
        }
      }
    })();
  } else {
    stats.skipped = passagesOut.filter(p => existing.has(p.title)).length;
  }

  return {
    stats, errors,
    rows: passagesOut.map(p => ({
      title: p.title, level: p.level, topic: p.topic, tags: p.tags, source: p.source,
      wordCount: (p.text.match(/[A-Za-z][A-Za-z'-]*/g) || []).length, questions: p.questions,
    })),
    headers: table.headers, map, suggestedMap: suggested, sheet: table.sheet, headerRow: table.headerRow,
  };
}

/** 启动时写入内置阅读题库（表为空才写） */
export async function seedReading(db, csvBuffer, filename = 'reading-passages.csv') {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM reading_passage`).get().c;
  if (count > 0) return { skipped: true, passages: count };
  const out = await importReading(db, { buffer: csvBuffer, filename, onDuplicate: 'skip' });
  return { skipped: false, ...out.stats };
}
