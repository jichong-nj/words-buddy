import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  env: process.env.NODE_ENV || 'development',
  // 默认监听 0.0.0.0：本机 127.0.0.1 与手机/局域网都能访问；只想本机用可设 HOST=127.0.0.1
  host: process.env.HOST || '0.0.0.0',
  port: num(process.env.PORT, 5178),
  // 数据目录：单文件 SQLite + 上传的原始文件 + 备份
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  get dbFile() { return process.env.DB_FILE || path.join(this.dataDir, 'words.db'); },
  get uploadDir() { return path.join(this.dataDir, 'uploads'); },
  get backupDir() { return path.join(this.dataDir, 'backups'); },
  webDist: path.join(ROOT, 'dist', 'web'),

  seedDemo: process.env.SEED_DEMO !== '0',

  session: {
    cookieName: 'wb_session',
    ttlMs: 7 * 24 * 3600 * 1000,          // 默认 7 天
    rememberMs: 30 * 24 * 3600 * 1000,    // 记住我 30 天
  },
  password: {
    minLength: 4,                          // 本地学习工具，口径放宽
    maxFail: 5,
    lockMs: 5 * 60 * 1000,
  },
  upload: {
    maxBytes: 10 * 1024 * 1024,           // 10 MB
    maxRows: 20000,
    keepBatches: 20,
  },
  practice: {
    minLen: num(process.env.PRAC_MIN_LEN, 4),   // 答案长度下限，eye 这种太简单
    maxLen: num(process.env.PRAC_MAX_LEN, 12),  // 上限，environment 太难
    maxPerSession: 200,
  },
};

export function ensureDirs() {
  for (const d of [config.dataDir, config.uploadDir, config.backupDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
