/**
 * 生成 PET 词库：读取人工整理的 server/seed/pet-words.csv（单词/词性/中文释义/主题/标签），
 * 用 WordNet 自动补「英文释义 + 例句」，输出成导入模板格式的 CSV；
 * 加 --import 可一步写入数据库（新建 level=PET 的词库并导入）。
 *
 * 用法：
 *   node scripts/build-pet-bank.js                # 只生成 server/seed/pet-bank-import.csv
 *   node scripts/build-pet-bank.js --import       # 生成并导入数据库
 *   node scripts/build-pet-bank.js --limit 50     # 只取前 50 行（调试）
 *   node scripts/build-pet-bank.js --out /tmp/x.csv
 *
 * 英文释义优先级：server/seed/pet-defs-override.json 人工释义 > WordNet（含屈折还原）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookupSmart } from '../server/lib/wordnet.js';
import { COLUMNS } from '../server/lib/excel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const SEED_CSV = path.join(ROOT, 'server', 'seed', 'pet-words.csv');
export const OVERRIDE_JSON = path.join(ROOT, 'server', 'seed', 'pet-defs-override.json');
export const OUT_CSV = path.join(ROOT, 'server', 'seed', 'pet-bank-import.csv');
export const BANK_NAME = 'PET 完整词库 · B1';

// ───────────────────────────── 参数 ─────────────────────────────

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, def) => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const DO_IMPORT = flag('import');
const LIMIT = Number(opt('limit', 0)) || 0;
const OUT = opt('out', OUT_CSV);

// ───────────────────────────── CSV ─────────────────────────────

/** 解析一行 CSV（字段允许用双引号包裹，内部 "" 表示一个引号） */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** 读取人工词表：[{word,pos,defCn,topic,tags}] */
export function readSeed(file = SEED_CSV) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (!cells[0]) continue;
    rows.push({ word: cells[0], pos: cells[1] || '', defCn: cells[2] || '', topic: cells[3] || '', tags: cells[4] || '' });
  }
  return LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

// ─────────────────────── 英文释义：override + WordNet ───────────────────────

export function readOverrides(file = OVERRIDE_JSON) {
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_') || !v || typeof v !== 'object') continue;
    out[k.toLowerCase()] = { def: String(v.def || '').trim(), example: String(v.example || '').trim() };
  }
  return out;
}

/**
 * 给一行补英文释义。
 * @returns {{def:string, example:string, source:'manual'|'wordnet'|'', matched:string|null}}
 */
export function resolveDef(row, overrides) {
  const key = row.word.toLowerCase();
  const ov = overrides[key];
  if (ov && ov.def) {
    return { def: ov.def, example: ov.example || '', source: 'manual', matched: key };
  }
  const hit = lookupSmart(row.word, row.pos);
  if (hit.sense) {
    let def = hit.sense.def;
    // WordNet 释义里带分号时，第一段通常最贴近常用义
    if (def.length > 120 && def.includes('; ')) def = def.split('; ')[0];
    return { def, example: hit.sense.example || '', source: 'wordnet', matched: hit.matched };
  }
  return { def: '', example: '', source: '', matched: null };
}

// ───────────────────────────── 主流程 ─────────────────────────────

export function buildRows({ seed = SEED_CSV, overridesFile = OVERRIDE_JSON } = {}) {
  const rows = readSeed(seed);
  const overrides = readOverrides(overridesFile);
  const filled = [];
  const missing = [];
  const stemmed = [];
  const byTopic = new Map();

  for (const row of rows) {
    const r = resolveDef(row, overrides);
    if (!r.def) { missing.push(row); continue; }
    if (r.source === 'wordnet' && r.matched && r.matched !== row.word.toLowerCase()) {
      stemmed.push(`${row.word} → ${r.matched}`);
    }
    const notes = r.source === 'manual' ? '人工释义' : '';
    filled.push({
      word: row.word,
      phonetic_uk: '',
      phonetic_us: '',
      pos: row.pos,
      def_cn: row.defCn,
      def_en: r.def,
      example_en: r.example,
      example_cn: '',
      topic: row.topic,
      tags: row.tags,
      level: 'PET',
      notes,
    });
    byTopic.set(row.topic, (byTopic.get(row.topic) || 0) + 1);
  }
  return { filled, missing, stemmed, byTopic, total: rows.length };
}

/** 生成导入模板格式的 CSV 文本（表头用 COLUMNS 的中文标签，列顺序一致） */
export function toImportCsv(filled) {
  const head = COLUMNS.map(c => csvCell(c.label)).join(',');
  const lines = filled.map(r => COLUMNS.map(c => csvCell(r[c.field])).join(','));
  return [head, ...lines].join('\n') + '\n';
}

async function doImport(filled) {
  const { openDb, migrate } = await import('../server/db/index.js');
  const { previewImport, commitImport } = await import('../server/services/importer.js');
  const { config } = await import('../server/config.js');

  const db = openDb(config.dbFile);
  migrate(db);
  try {
    let bank = db.prepare(`SELECT * FROM word_bank WHERE name=?`).get(BANK_NAME);
    if (!bank) {
      const info = db.prepare(`INSERT INTO word_bank(name,level,description,source) VALUES(?,?,?,?)`)
        .run(BANK_NAME, 'PET', '覆盖剑桥 B1 Preliminary 官方词表（2025-08 版，2740 个词条，含短语与语法词）；英文释义与例句由 WordNet 生成并人工校订', 'Cambridge B1 Preliminary Vocabulary List + WordNet 3.1');
      bank = db.prepare(`SELECT * FROM word_bank WHERE id=?`).get(info.lastInsertRowid);
      console.log(`已新建词库 #${bank.id}「${bank.name}」`);
    } else {
      console.log(`复用已有词库 #${bank.id}「${bank.name}」，重复词将覆盖更新`);
    }

    const buffer = Buffer.from(toImportCsv(filled), 'utf8');
    const preview = await previewImport(db, {
      bankId: bank.id,
      buffer,
      filename: 'pet-bank-import.csv',
      dupInFile: 'merge_senses',
      dupInBank: 'overwrite',
      mergeSenses: true,
    });
    console.log(`解析结果：共 ${preview.stats.totalRows} 行，有效 ${preview.stats.validRows} 行，` +
      `错误 ${preview.stats.errorRows} 行，警告 ${preview.stats.warnRows} 行，新词 ${preview.stats.newWords}`);
    if (preview.stats.errorRows) {
      const bad = preview.errors.filter(e => e.severity === 'error').slice(0, 10);
      for (const e of bad) console.log(`  ✗ 第 ${e.rowNo} 行「${e.word || ''}」${e.field || ''}：${e.message}`);
      console.log(`  错误共 ${preview.stats.errorRows} 行，已跳过（可修正词表后重跑）`);
    }
    const stat = await commitImport(db, preview.batchId);
    const count = db.prepare(`SELECT COUNT(*) AS c FROM word WHERE bank_id=?`).get(bank.id).c;
    const withDef = db.prepare(`SELECT COUNT(*) AS c FROM word w WHERE w.bank_id=? AND EXISTS(
        SELECT 1 FROM word_sense s WHERE s.word_id=w.id AND length(coalesce(s.def_en,''))>=8)`).get(bank.id).c;
    console.log(`已导入：新增 ${stat.inserted}、更新 ${stat.updated}、跳过 ${stat.skipped}、失败 ${stat.failed}`);
    console.log(`词库合计 ${count} 词，其中 ${withDef} 词可用于「看释义写单词」练习（释义≥8 字符）`);
  } finally {
    db.close();
  }
}

async function main() {
  const t0 = Date.now();
  const { filled, missing, stemmed, byTopic, total } = buildRows();
  const coverage = total ? ((filled.length / total) * 100).toFixed(1) : '0.0';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, toImportCsv(filled), 'utf8');

  console.log(`读入词表 ${total} 行，覆盖 ${filled.length} 行（${coverage}%），用时 ${Date.now() - t0} ms`);
  console.log(`输出：${path.relative(ROOT, OUT)}`);
  console.log('\n各主题词数：');
  for (const [topic, n] of [...byTopic.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${topic}`);
  }
  if (stemmed.length) {
    console.log(`\n通过词形还原匹配到原形 ${stemmed.length} 个：${stemmed.join('、')}`);
  }
  if (missing.length) {
    console.log(`\n仍缺英文释义 ${missing.length} 个（请在 pet-defs-override.json 里补）：`);
    for (const m of missing) console.log(`  - ${m.word} (${m.pos})`);
  }
  if (DO_IMPORT) {
    console.log('');
    await doImport(filled);
  } else {
    console.log('\n提示：加 --import 可直接建库导入（词库名「' + BANK_NAME + '」，level=PET）');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1); });
}
