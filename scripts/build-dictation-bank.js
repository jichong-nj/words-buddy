/**
 * 从词库例句生成听写句库 CSV：取 word_sense 的 example_en + example_cn，
 * 过滤长度/去重，按「词库等级 + 单词主题」打标。
 *
 * 用法：node scripts/build-dictation-bank.js [--db data/words.db] [--out server/seed/dictation-items.csv] [--limit 3000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db/index.js';
import { config } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };
const DB = opt('db', config.dbFile);
const OUT = opt('out', path.join(ROOT, 'server', 'seed', 'dictation-items.csv'));
const LIMIT = Number(opt('limit', 3000)) || 3000;

const db = openDb(DB);
const rows = db.prepare(`
  SELECT w.word, w.topic, w.bank_id, b.level, s.example_en AS en, s.example_cn AS cn
  FROM word_sense s
  JOIN word w ON w.id = s.word_id
  JOIN word_bank b ON b.id = w.bank_id
  WHERE s.example_en IS NOT NULL AND length(trim(s.example_en)) > 8
    AND s.example_cn IS NOT NULL AND length(trim(s.example_cn)) > 2
  ORDER BY w.bank_id, w.word`).all();
// 变形填空题本身就是「完整句子 + 中文」：把空格用答案填回去，即可作为听写句
const formRows = db.prepare(`
  SELECT prompt, answer, sentence_cn AS cn, point, level, topic, tags
  FROM transform_item
  WHERE trim(coalesce(sentence_cn,'')) <> '' AND prompt LIKE '%____%'`).all();
db.close();

const candidates = [];
for (const r of rows) {
  candidates.push({ en: r.en, cn: r.cn, level: r.level, topic: r.topic, tags: '词库例句', source: `词库例句 · ${r.word}` });
}
for (const r of formRows) {
  const prompt = String(r.prompt).trim();
  let answer = String(r.answer || '');
  if (/^_{2,}/.test(prompt)) answer = answer.charAt(0).toUpperCase() + answer.slice(1);   // 只在句首大写
  const en = prompt.replace(/_{2,}/, answer);
  candidates.push({ en, cn: r.cn, level: r.level || '', topic: r.topic || '', tags: '变形题句子', source: `变形填空 · ${r.point || ''}` });
}

const BLOCK = /\b(suicide|murder|rape|porn|sex|drugs?|cocaine|heroin|terrorist|terrorism|bomb|gun|naked|drunk|die|died|death|dead|kill|killed|killing)\b/i;
const seen = new Set();
const out = [];
for (const r of candidates) {
  const en = String(r.en).replace(/\s+/g, ' ').trim();
  const cn = String(r.cn).replace(/\s+/g, ' ').trim();
  if (!/^[A-Z]/.test(en) || !/[.!?]$/.test(en)) continue;
  if (/[<>#*_|\\]/.test(en)) continue;
  if (BLOCK.test(en)) continue;                          // 过滤不适合学习场景的句子
  if (/[^\x00-\x7F]/.test(en)) continue;   // 只留纯 ASCII 句子
  if (/\b(etc|e\.g|i\.e)\./i.test(en)) continue;
  const wc = en.split(' ').length;
  if (wc < 3 || wc > 18) continue;
  const key = en.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  out.push({ en, cn, level: r.level || '', topic: r.topic || '', tags: r.tags || '', source: r.source || '' });
  if (out.length >= LIMIT) break;
}

const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const head = ['句子', '中文', '等级', '主题', '标签', '来源', '语法', '解析'];
fs.writeFileSync(OUT, [head.map(cell).join(','), ...out.map(o => [o.en, o.cn, o.level, o.topic, o.tags, o.source, '', ''].map(cell).join(','))].join('\n') + '\n', 'utf8');
console.log(`生成 ${out.length} 句 → ${path.relative(ROOT, OUT)}`);
