import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config, ensureDirs } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.join(__dirname, 'migrations');

let db = null;

export function openDb(file = config.dbFile) {
  ensureDirs();
  const d = new Database(file);
  d.pragma('journal_mode = WAL');
  d.pragma('foreign_keys = ON');
  d.pragma('busy_timeout = 5000');
  return d;
}

export function getDb() {
  if (!db) db = openDb();
  return db;
}

export function setDb(next) { db = next; }

export function closeDb() {
  if (db) { db.close(); db = null; }
}

/** 按文件名顺序执行未跑过的 .sql 迁移，每个迁移一个事务 */
export function migrate(d = getDb()) {
  d.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const cur = Number(d.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).get()?.value ?? 0);
  const files = fs.readdirSync(MIGRATION_DIR).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files) {
    const ver = Number(f.split('_')[0]);
    if (ver <= cur) continue;
    const sql = fs.readFileSync(path.join(MIGRATION_DIR, f), 'utf8');
    d.transaction(() => {
      d.exec(sql);
      d.prepare(`INSERT INTO app_meta(key,value) VALUES('schema_version',?)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(ver));
    })();
    applied.push(f);
  }
  return applied;
}

/** 读 app_meta */
export function metaGet(d, key, fallback = null) {
  return d.prepare(`SELECT value FROM app_meta WHERE key=?`).get(key)?.value ?? fallback;
}

export function metaSet(d, key, value) {
  d.prepare(`INSERT INTO app_meta(key,value) VALUES(?,?)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
}

/** 统一的 now 字符串，与库内 datetime('now','localtime') 同格式 */
export function nowStr(offsetMs = 0) {
  const t = new Date(Date.now() + offsetMs);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}
