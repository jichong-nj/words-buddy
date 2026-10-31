/**
 * 演示数据：两个演示账号 + 一个 KET 示例词库（60+ 词，含若干脏数据行用于演示校验报告）。
 * 既可被 server/index.js 首次启动时调用，也可单独执行：node scripts/seed-demo.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDb, migrate } from '../server/db/index.js';
import { config, ensureDirs } from '../server/config.js';
import { hashPassword } from '../server/lib/password.js';
import { previewImport, commitImport } from '../server/services/importer.js';
import { seedFormItems, importFormItems } from '../server/services/formbank.js';
import { seedReading, importReading } from '../server/services/readingbank.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEMO_CSV = path.join(__dirname, '..', 'server', 'seed', 'demo-words.csv');
export const FORM_CSV = path.join(__dirname, '..', 'server', 'seed', 'form-items.csv');
export const FORM_NEWS_CSV = path.join(__dirname, '..', 'server', 'seed', 'form-items-news.csv');
export const FORM_PET_CSV = path.join(__dirname, '..', 'server', 'seed', 'form-items-pet.csv');
export const READING_CSV = path.join(__dirname, '..', 'server', 'seed', 'reading-passages.csv');
export const READING_SQUAD_CSV = path.join(__dirname, '..', 'server', 'seed', 'reading-squad.csv');
export const DEMO_BANK_NAME = '示例词库 · KET 60 词';

export function seedDemoUsers(db) {
  const created = [];
  const ins = db.prepare(`INSERT INTO app_user(username,password_hash,display_name,role,must_change_pw) VALUES(?,?,?,?,0)`);
  const wanted = [
    { username: 'admin', password: 'admin123', displayName: '管理员', role: 'admin' },
    { username: 'student', password: 'student123', displayName: '示例学生', role: 'student' },
  ];
  for (const w of wanted) {
    if (db.prepare(`SELECT id FROM app_user WHERE username=?`).get(w.username)) continue;
    ins.run(w.username, hashPassword(w.password), w.displayName, w.role);
    created.push(w);
  }
  return created;
}

/** 导入示例词库（走真实的 Excel/CSV 导入管线，同时留下一条导入批次记录） */
export async function seedDemoData(db, name = DEMO_BANK_NAME) {
  if (db.prepare(`SELECT id FROM word_bank WHERE name=?`).get(name)) return { skipped: true };
  const info = db.prepare(`INSERT INTO word_bank(name,level,description) VALUES(?,?,?)`)
    .run(name, 'KET', '内置示例词库：KET 高频词 + 演示用脏数据，可直接体验导入校验与英文释义填空。');
  const bankId = info.lastInsertRowid;
  const buffer = fs.readFileSync(DEMO_CSV);
  const preview = await previewImport(db, {
    bankId, buffer, filename: 'demo-words.csv', headerRow: 1,
    dupInFile: 'merge_senses', dupInBank: 'overwrite', mergeSenses: true,
  });
  const result = await commitImport(db, preview.batchId);
  return { bankId, ...result, stats: preview.stats, errorRows: preview.errors.length };
}

/** 变形填空内置题库：内置题 + 时政新闻题 + 语料生成题（表为空才写，幂等） */
export async function seedFormData(db) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM transform_item`).get().c;
  if (count > 0) return { skipped: true, count };
  const result = { skipped: false, inserted: 0, updated: 0, skipped: 0, questions: 0, files: [] };
  for (const [file, name] of [[FORM_CSV, 'form-items.csv'], [FORM_NEWS_CSV, 'form-items-news.csv'], [FORM_PET_CSV, 'form-items-pet.csv']]) {
    if (!fs.existsSync(file)) continue;
    const r = await importFormItems(db, { buffer: fs.readFileSync(file), filename: name, onDuplicate: 'skip' });
    result.inserted += r.stats.inserted || 0;
    result.updated += r.stats.updated || 0;
    result.skipped += r.stats.skipped || 0;
    result.files.push({ file: name, inserted: r.stats.inserted || 0, errorRows: r.stats.errorRows });
  }
  return result;
}

/** 阅读理解内置题库：人工/百科短文 + SQuAD 自动生成（表为空才写，幂等） */
export async function seedReadingData(db) {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM reading_passage`).get().c;
  if (count > 0) return { skipped: true, passages: count };
  const result = { skipped: false, inserted: 0, updated: 0, skipped: 0, questions: 0, files: [] };
  for (const [file, name] of [[READING_CSV, 'reading-passages.csv'], [READING_SQUAD_CSV, 'reading-squad.csv']]) {
    if (!fs.existsSync(file)) continue;
    const r = await importReading(db, { buffer: fs.readFileSync(file), filename: name, onDuplicate: 'skip' });
    result.inserted += r.stats.inserted || 0;
    result.updated += r.stats.updated || 0;
    result.skipped += r.stats.skipped || 0;
    result.questions += r.stats.questions || 0;
    result.files.push({ file: name, inserted: r.stats.inserted, questions: r.stats.questions, errorRows: r.stats.errorRows });
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureDirs();
  const db = openDb(config.dbFile);
  migrate(db);
  const users = seedDemoUsers(db);
  const bank = await seedDemoData(db);
  const form = await seedFormData(db);
  const reading = await seedReadingData(db);
  console.log('演示账号：', users.length ? users.map(u => `${u.username}/${u.password}`).join('  ') : '（已存在，未重复创建）');
  console.log('示例词库：', bank.skipped ? '（已存在，未重复导入）' : JSON.stringify(bank));
  console.log('变形填空题库：', form.skipped ? `（已存在 ${form.count} 题，未重复导入）` : JSON.stringify(form));
  console.log('阅读理解题库：', reading.skipped ? `（已存在 ${reading.passages} 篇，未重复导入）` : JSON.stringify(reading));
  db.close();
}
