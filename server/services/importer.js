import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { readTable, suggestMap } from '../lib/excel.js';
import { parseSenses, normWord, splitTags, joinTags } from '../lib/parse.js';
import { topicsForLevel, POS_SET } from '../../shared/topic-taxonomy.js';

const SENSE_FIELDS = ['pos', 'def_cn', 'def_en', 'example_en', 'example_cn'];
const WORD_FIELDS = ['word', 'phonetic_uk', 'phonetic_us', 'topic', 'tags', 'level', 'notes'];
const ALL_FIELDS = [...WORD_FIELDS, ...SENSE_FIELDS];

const isExampleRow = w => /示例/.test(w) && /(忽略|可删除)/.test(w);

/** 把一行原始单元格按列映射折叠成字段对象；同字段多列时义项类用换行拼接 */
function rowToFields(cells, headers, map) {
  const o = {};
  headers.forEach((h, i) => {
    const f = map[h];
    if (!f) return;
    const v = String(cells[i] ?? '').trim();
    if (!v) return;
    if (!o[f]) o[f] = v;
    else if (SENSE_FIELDS.includes(f)) o[f] += `\n${v}`;
  });
  return o;
}

function validateRecord(rec, bankLevel, seen) {
  const errs = [];
  const warns = [];
  const w = rec.word;
  if (!w) {
    errs.push({ field: 'word', code: 'empty_word', message: '单词为空' });
    return { errs, warns };
  }
  if (w.length > 64) errs.push({ field: 'word', code: 'word_too_long', message: `单词过长（${w.length} 字符，上限 64）` });
  if (/[\r\n]/.test(w)) errs.push({ field: 'word', code: 'word_has_newline', message: '单词列不允许换行' });
  if (!/^[A-Za-z]/.test(w)) warns.push({ field: 'word', code: 'non_alpha_word', message: '单词不是以英文字母开头' });
  if (seen.has(rec.wordNorm)) warns.push({ field: 'word', code: 'dup_in_file', message: '文件内重复单词' });

  const ph = rec.phonetic_uk || rec.phonetic_us;
  if (ph && !/^\/.+\/$/.test(ph.trim())) warns.push({ field: 'phonetic_uk', code: 'bad_phonetic', message: '音标建议写成 /…/ 形式' });

  const topics = topicsForLevel(bankLevel);
  if (topics.length && rec.topic && !topics.some(t => t.key === rec.topic)) {
    warns.push({ field: 'topic', code: 'topic_not_in_taxonomy', message: `主题「${rec.topic}」不在 ${bankLevel} 官方 Topic 表内` });
  }

  if (!rec.senses.length) {
    warns.push({ field: 'def_cn', code: 'no_valid_sense', message: '该词条没有有效义项，已标记待补充' });
    rec.needsReview = 1;
  }
  if (rec.senses.length > 10) warns.push({ field: 'def_cn', code: 'too_many_senses', message: `义项数 ${rec.senses.length} 超过 10 个` });
  for (const s of rec.senses) {
    if (s.pos && !POS_SET.has(s.pos)) warns.push({ field: 'pos', code: 'bad_pos', message: `词性「${s.pos}」不在枚举内` });
    if (!s.def_cn && !s.def_en) warns.push({ field: 'def_cn', code: 'empty_sense_def', message: '义项缺少释义' });
  }
  return { errs, warns };
}

/** 解析 + 校验，不落库；preview 与 commit 共用 */
function analyze({ table, map, bankLevel, mergeSenses, existingNorms, maxRows }) {
  const { rows, headerRow } = table;
  const dataRows = rows.slice(headerRow);
  if (dataRows.length > maxRows) {
    throw badRequest('too_many_rows', `数据行数 ${dataRows.length} 超过上限 ${maxRows}`);
  }

  const errors = [];       // {rowNo, word, field, severity, code, message}
  const records = [];
  const seen = new Map();  // norm -> index in records
  let skippedExample = 0;

  dataRows.forEach((cells, idx) => {
    const rowNo = headerRow + idx + 1;
    if (!cells || cells.every(c => String(c ?? '').trim() === '')) return;
    const f = rowToFields(cells, table.headers, map);
    const word = String(f.word ?? '').trim();
    if (isExampleRow(word)) { skippedExample++; return; }

    const senses = parseSenses(f);
    const rec = {
      rowNo, word, wordNorm: normWord(word),
      phonetic_uk: f.phonetic_uk || null, phonetic_us: f.phonetic_us || null,
      topic: f.topic || null, tags: joinTags(splitTags(f.tags)), level: f.level || null,
      notes: f.notes || null, needsReview: 0,
      senses: senses.map((s, i) => ({ ...s, sort: i + 1, srcRow: rowNo })),
    };
    const { errs, warns } = validateRecord(rec, bankLevel, seen);
    for (const e of errs) errors.push({ rowNo, word, severity: 'error', ...e });
    for (const w of warns) errors.push({ rowNo, word, severity: 'warn', ...w });
    if (errs.length) return;

    // 文件内同词合并义项
    if (mergeSenses && seen.has(rec.wordNorm)) {
      const prev = records[seen.get(rec.wordNorm)];
      const before = prev.senses.length;
      for (const s of rec.senses) {
        const dup = prev.senses.find(p => p.pos === s.pos && p.def_cn === s.def_cn && p.def_en === s.def_en);
        if (dup) continue;
        prev.senses.push({ ...s, sort: before + prev.senses.filter(x => x.sort > before).length + 1 });
      }
      prev.senses.forEach((s, i) => { s.sort = i + 1; });
      for (const k of ['phonetic_uk', 'phonetic_us', 'topic', 'level', 'notes']) {
        if (!prev[k] && rec[k]) prev[k] = rec[k];
      }
      if (rec.tags) prev.tags = joinTags([...splitTags(prev.tags), ...splitTags(rec.tags)]);
      prev.mergedRows = (prev.mergedRows || 1) + 1;
      return;
    }
    seen.set(rec.wordNorm, records.length);
    records.push(rec);
  });

  // 与库内已有单词比对
  for (const rec of records) {
    if (existingNorms.has(rec.wordNorm)) {
      errors.push({ rowNo: rec.rowNo, word: rec.word, severity: 'warn', field: 'word', code: 'dup_in_bank', message: '词库中已存在该单词' });
    }
  }
  records.forEach((r, i) => { r.seq = i + 1; });
  return { records, errors, skippedExample, totalRows: dataRows.length };
}

function loadExistingNorms(db, bankId, records) {
  if (!records.length) return new Set();
  const all = new Set();
  // 分片，避免超出 SQLite 变量上限
  for (let i = 0; i < records.length; i += 500) {
    const chunk = records.slice(i, i + 500);
    const stmt = db.prepare(`SELECT word_norm FROM word WHERE bank_id=? AND word_norm IN (` + chunk.map(() => '?').join(',') + `)`);
    for (const r of stmt.all(bankId, ...chunk.map(x => x.wordNorm))) all.add(r.word_norm);
  }
  return all;
}

function saveUpload(db, batchId, buffer, filename) {
  const ext = path.extname(filename) || '.xlsx';
  const stored = path.join(config.uploadDir, `${batchId}${ext}`);
  fs.writeFileSync(stored, buffer);
  return stored;
}

function pruneUploads(db) {
  try {
    const old = db.prepare(`SELECT id, stored_path FROM import_batch
                            WHERE status IN ('committed','rolled_back')
                            ORDER BY created_at DESC LIMIT -1 OFFSET ?`).all(config.upload.keepBatches);
    for (const o of old) {
      if (o.stored_path && fs.existsSync(o.stored_path)) fs.unlinkSync(o.stored_path);
      db.prepare(`UPDATE import_batch SET stored_path=NULL WHERE id=?`).run(o.id);
    }
  } catch { /* 清理失败不影响主流程 */ }
}

/** 第一步：上传 + 解析 + 校验，产出预览批次 */
export async function previewImport(db, { bankId, buffer, filename, sheet, headerRow = 1, columnMap, dupInFile = 'merge_senses', dupInBank = 'overwrite', mergeSenses }) {
  const bank = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(bankId);
  if (!bank) throw notFound('词库不存在');
  if (buffer.length > config.upload.maxBytes) throw badRequest('too_large', `文件超过 ${config.upload.maxBytes / 1024 / 1024} MB 上限`);

  const merge = mergeSenses === undefined ? dupInFile === 'merge_senses' : !!mergeSenses;
  const table = await readTable(buffer, { filename, sheet, headerRow });
  const suggested = suggestMap(table.headers);
  const map = { ...(columnMap || suggested) };
  for (const k of Object.keys(map)) if (!ALL_FIELDS.includes(map[k])) delete map[k];
  if (!Object.values(map).includes('word')) {
    throw badRequest('no_word_column', '没有识别到「单词」列，请在列映射中指定', { headers: table.headers });
  }

  const draft = analyze({ table, map, bankLevel: bank.level, mergeSenses: merge, existingNorms: new Set(), maxRows: config.upload.maxRows });
  const existing = loadExistingNorms(db, bankId, draft.records);
  for (const rec of draft.records) {
    if (existing.has(rec.wordNorm)) {
      draft.errors.push({ rowNo: rec.rowNo, word: rec.word, severity: 'warn', field: 'word', code: 'dup_in_bank', message: '词库中已存在该单词' });
    }
  }

  const info = db.prepare(`INSERT INTO import_batch
      (bank_id,filename,stored_path,sheet_name,header_row,column_map,dup_in_file,dup_in_bank,merge_senses,total_rows,status)
      VALUES(?,?,?,?,?,?,?,?,?,?, 'preview')`)
    .run(bankId, filename, null, table.sheet, headerRow, JSON.stringify(map), dupInFile, dupInBank, merge ? 1 : 0, draft.totalRows);
  const batchId = info.lastInsertRowid;
  const stored = saveUpload(db, batchId, buffer, filename);
  db.prepare(`UPDATE import_batch SET stored_path=? WHERE id=?`).run(stored, batchId);

  const insErr = db.prepare(`INSERT INTO import_error(batch_id,row_no,word,field,severity,code,message) VALUES(?,?,?,?,?,?,?)`);
  db.transaction(() => {
    db.prepare(`DELETE FROM import_error WHERE batch_id=?`).run(batchId);
    for (const e of draft.errors) insErr.run(batchId, e.rowNo, e.word || null, e.field || null, e.severity, e.code, e.message);
  })();

  const errorRows = new Set(draft.errors.filter(e => e.severity === 'error').map(e => e.rowNo));
  const warnRows = new Set(draft.errors.filter(e => e.severity === 'warn').map(e => e.rowNo));
  return {
    batchId,
    sheets: table.sheets, sheet: table.sheet, headerRow,
    headers: table.headers,
    suggestedMap: suggested, map,
    rows: draft.records.slice(0, 50).map(r => ({
      rowNo: r.rowNo, word: r.word, senses: r.senses.map(s => ({ pos: s.pos, def_cn: s.def_cn, def_en: s.def_en })),
    })),
    errors: draft.errors.slice(0, 500),
    stats: {
      totalRows: draft.totalRows,
      validRows: draft.records.length,
      errorRows: errorRows.size,
      warnRows: warnRows.size,
      newWords: draft.records.filter(r => !existing.has(r.wordNorm)).length,
      existingWords: draft.records.filter(r => existing.has(r.wordNorm)).length,
    },
    preview: draft.records.slice(0, 50),
  };
}

/** 第二步：改了映射/策略后基于已存文件重新解析，无需重传 */
export async function repreviewImport(db, batchId, patch = {}) {
  const b = db.prepare(`SELECT * FROM import_batch WHERE id=?`).get(batchId);
  if (!b) throw notFound('导入批次不存在');
  if (!b.stored_path || !fs.existsSync(b.stored_path)) throw badRequest('file_gone', '原始文件已清理，请重新上传');
  const buffer = fs.readFileSync(b.stored_path);
  return previewImport(db, {
    bankId: b.bank_id, buffer, filename: b.filename,
    sheet: patch.sheet ?? b.sheet_name,
    headerRow: patch.headerRow ?? b.header_row,
    columnMap: patch.columnMap ?? JSON.parse(b.column_map || '{}'),
    dupInFile: patch.dupInFile ?? b.dup_in_file,
    dupInBank: patch.dupInBank ?? b.dup_in_bank,
    mergeSenses: patch.mergeSenses ?? !!b.merge_senses,
  });
}

function insertWord(db, bankId, rec) {
  const info = db.prepare(`INSERT INTO word
      (bank_id,word,phonetic_uk,phonetic_us,topic,tags,level,notes,needs_review,src_row)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(bankId, rec.word, rec.phonetic_uk, rec.phonetic_us, rec.topic, rec.tags, rec.level, rec.notes, rec.needsReview, rec.rowNo);
  const id = info.lastInsertRowid;
  const ins = db.prepare(`INSERT INTO word_sense
      (word_id,pos,def_cn,def_en,def_en_source,example_en,example_cn,sort,src_row)
      VALUES(?,?,?,?,?,?,?,?,?)`);
  for (const s of rec.senses) ins.run(id, s.pos, s.def_cn, s.def_en, s.def_en ? 'manual' : null, s.example_en, s.example_cn, s.sort, rec.rowNo);
  return id;
}

function snapshotWord(db, wordId) {
  const w = db.prepare(`SELECT * FROM word WHERE id=?`).get(wordId);
  const senses = db.prepare(`SELECT * FROM word_sense WHERE word_id=? ORDER BY sort`).all(wordId);
  return { word: w, senses };
}

function restoreWord(db, snap) {
  const { word, senses } = snap;
  const cols = ['bank_id','word','phonetic_uk','phonetic_us','topic','tags','level','notes','needs_review','src_row'];
  db.prepare(`UPDATE word SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`)
    .run(...cols.map(c => word[c]), word.id);
  db.prepare(`DELETE FROM word_sense WHERE word_id=?`).run(word.id);
  const ins = db.prepare(`INSERT INTO word_sense
      (id,word_id,pos,def_cn,def_en,def_en_source,example_en,example_cn,sort,src_row) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  for (const s of senses) ins.run(s.id, word.id, s.pos, s.def_cn, s.def_en, s.def_en_source, s.example_en, s.example_cn, s.sort, s.src_row);
}

/** 第三步：单事务提交 */
export async function commitImport(db, batchId) {
  const b = db.prepare(`SELECT * FROM import_batch WHERE id=?`).get(batchId);
  if (!b) throw notFound('导入批次不存在');
  if (b.status === 'committed') throw conflict('already_committed', '该批次已提交');
  if (!b.stored_path || !fs.existsSync(b.stored_path)) throw badRequest('file_gone', '原始文件已清理，请重新上传');

  const bank = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(b.bank_id);
  const buffer = fs.readFileSync(b.stored_path);
  const table = await readTable(buffer, { filename: b.filename, sheet: b.sheet_name, headerRow: b.header_row });
  const map = JSON.parse(b.column_map || '{}');
  const { records, errors } = analyze({
    table, map, bankLevel: bank.level, mergeSenses: !!b.merge_senses,
    existingNorms: new Set(), maxRows: config.upload.maxRows,
  });
  const errorRows = new Set(errors.filter(e => e.severity === 'error').map(e => e.rowNo));

  const stat = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
  const affected = { created: [], overwritten: [] };
  const abortMsg = { msg: null };

  db.transaction(() => {
    const findWord = db.prepare(`SELECT id FROM word WHERE bank_id=? AND word_norm=?`);
    for (const rec of records) {
      if (errorRows.has(rec.rowNo)) { stat.failed++; continue; }
      const exist = findWord.get(b.bank_id, rec.wordNorm);
      if (!exist) {
        affected.created.push(insertWord(db, b.bank_id, rec));
        stat.inserted++;
        continue;
      }
      if (b.dup_in_bank === 'skip') { stat.skipped++; continue; }
      if (b.dup_in_bank === 'abort') { abortMsg.msg = `第 ${rec.rowNo} 行「${rec.word}」在词库中已存在，策略为整批中止`; throw badRequest('dup_abort', abortMsg.msg); }
      affected.overwritten.push({ id: exist.id, snapshot: snapshotWord(db, exist.id) });
      db.prepare(`UPDATE word SET phonetic_uk=?,phonetic_us=?,topic=?,tags=?,level=?,notes=?,needs_review=?,src_row=?,
                    updated_at=datetime('now','localtime') WHERE id=?`)
        .run(rec.phonetic_uk, rec.phonetic_us, rec.topic, rec.tags, rec.level, rec.notes, rec.needsReview, rec.rowNo, exist.id);
      db.prepare(`DELETE FROM word_sense WHERE word_id=?`).run(exist.id);
      const ins = db.prepare(`INSERT INTO word_sense (word_id,pos,def_cn,def_en,def_en_source,example_en,example_cn,sort,src_row) VALUES(?,?,?,?,?,?,?,?,?)`);
      for (const s of rec.senses) ins.run(exist.id, s.pos, s.def_cn, s.def_en, s.def_en ? 'manual' : null, s.example_en, s.example_cn, s.sort, rec.rowNo);
      stat.updated++;
    }
    const count = db.prepare(`SELECT COUNT(*) AS c FROM word WHERE bank_id=?`).get(b.bank_id).c;
    db.prepare(`UPDATE word_bank SET word_count=?, updated_at=datetime('now','localtime') WHERE id=?`).run(count, b.bank_id);
    db.prepare(`UPDATE import_batch SET status='committed', inserted=?, updated=?, skipped=?, failed=?,
                  affected_json=?, committed_at=? WHERE id=?`)
      .run(stat.inserted, stat.updated, stat.skipped, stat.failed, JSON.stringify(affected), nowStr(), batchId);
  })();

  pruneUploads(db);
  return { ...stat, batchId };
}

/** 第四步：回滚 —— 删除本批新建的词，还原本批覆盖过的词 */
export function rollbackImport(db, batchId) {
  const b = db.prepare(`SELECT * FROM import_batch WHERE id=?`).get(batchId);
  if (!b) throw notFound('导入批次不存在');
  if (b.status !== 'committed') throw conflict('not_committed', '该批次尚未提交，无需回滚');
  const affected = JSON.parse(b.affected_json || '{}');
  let removed = 0, restored = 0;
  db.transaction(() => {
    const del = db.prepare(`DELETE FROM word WHERE id=?`);
    for (const id of affected.created || []) removed += del.run(id).changes;
    for (const o of affected.overwritten || []) {
      const still = db.prepare(`SELECT id FROM word WHERE id=?`).get(o.id);
      if (still) { restoreWord(db, o.snapshot); restored++; }
    }
    const bank = db.prepare(`SELECT id FROM word_bank WHERE id=?`).get(b.bank_id);
    if (bank) {
      const count = db.prepare(`SELECT COUNT(*) AS c FROM word WHERE bank_id=?`).get(b.bank_id).c;
      db.prepare(`UPDATE word_bank SET word_count=?, updated_at=datetime('now','localtime') WHERE id=?`).run(count, b.bank_id);
    }
    db.prepare(`UPDATE import_batch SET status='rolled_back' WHERE id=?`).run(batchId);
  })();
  return { removed, restored };
}

export function listBatches(db, bankId) {
  const rows = bankId
    ? db.prepare(`SELECT * FROM import_batch WHERE bank_id=? ORDER BY id DESC LIMIT 100`).all(bankId)
    : db.prepare(`SELECT * FROM import_batch ORDER BY id DESC LIMIT 100`).all();
  return rows.map(b => ({
    id: b.id, bankId: b.bank_id, filename: b.filename, sheet: b.sheet_name,
    totalRows: b.total_rows, inserted: b.inserted, updated: b.updated, skipped: b.skipped,
    failed: b.failed, status: b.status, createdAt: b.created_at, committedAt: b.committed_at,
    hasFile: !!b.stored_path,
  }));
}

export function getBatchErrors(db, batchId) {
  return db.prepare(`SELECT row_no AS rowNo, word, field, severity, code, message FROM import_error WHERE batch_id=? ORDER BY row_no`)
    .all(batchId);
}
