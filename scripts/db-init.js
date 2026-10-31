/** 初始化数据库：建表 + 迁移到最新版本。node scripts/db-init.js [--file path] */
import { openDb, migrate, closeDb } from '../server/db/index.js';
import { config, ensureDirs } from '../server/config.js';

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  return i > -1 ? process.argv[i + 1] : undefined;
})();

ensureDirs();
const file = argFile || config.dbFile;
const db = openDb(file);
const applied = migrate(db);
const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
const version = db.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).get()?.value;
console.log(`数据库：${file}`);
console.log(`schema_version = ${version}`);
console.log(`本次应用迁移：${applied.length ? applied.join(', ') : '（无待应用迁移）'}`);
console.log(`表：${tables.map(t => t.name).join(', ')}`);
closeDb(db);
