/**
 * 预生成听写题库的全部参考音频（espeak-ng → WAV，按句缓存到 data/audio/shadow/）。
 * 生成后首次播放/判分不再需要现场合成。
 *
 * 用法：
 *   node scripts/prewarm-dictation-audio.js                 # 全部听写句
 *   node scripts/prewarm-dictation-audio.js --concurrency 4
 *   node scripts/prewarm-dictation-audio.js --limit 100     # 只生成前 100 条（试跑）
 */
import fs from 'node:fs';
import { openDb } from '../server/db/index.js';
import { config } from '../server/config.js';
import { synthesizeRef, refPathFor } from '../server/services/tts.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const eq = argv.find(a => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const CONCURRENCY = Math.max(1, Math.min(8, Number(opt('concurrency', 4)) || 4));
const LIMIT = Number(opt('limit', 0)) || 0;

const db = openDb(config.dbFile);
let rows = db.prepare(`SELECT sentence_en FROM dictation_item ORDER BY id`).all();
db.close();
if (LIMIT) rows = rows.slice(0, LIMIT);
console.log(`待处理 ${rows.length} 句，并发 ${CONCURRENCY}，缓存目录 ${config.audioDir}/shadow`);

let done = 0, made = 0, hit = 0, failed = 0, bytes = 0;
const errors = [];
const t0 = Date.now();

async function worker(queue) {
  while (queue.length) {
    const row = queue.shift();
    if (!row) break;
    const text = row.sentence_en;
    try {
      const cached = fs.existsSync(refPathFor(text)) && fs.statSync(refPathFor(text)).size > 1024;
      const out = await synthesizeRef(text);
      const size = fs.statSync(out.file).size;
      bytes += size;
      cached ? hit++ : made++;
    } catch (e) {
      failed += 1;
      if (errors.length < 20) errors.push(`${text.slice(0, 60)} :: ${e.message}`);
    }
    done += 1;
    if (done % 200 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[${done}/${rows.length}] 新增 ${made}，命中 ${hit}，失败 ${failed}，` +
        `${(bytes / 1024 / 1024).toFixed(0)}MB，${el.toFixed(0)}s（${(done / el).toFixed(1)} 句/秒）`);
    }
  }
}

const queue = [...rows];
const t = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
const elapsed = (Date.now() - t) / 1000;
console.log(`完成：新增 ${made}，命中 ${hit}，失败 ${failed}，用时 ${elapsed.toFixed(1)}s，` +
  `音频总量约 ${(bytes / 1024 / 1024).toFixed(0)}MB`);
if (errors.length) console.log('失败样例：\n' + errors.join('\n'));
