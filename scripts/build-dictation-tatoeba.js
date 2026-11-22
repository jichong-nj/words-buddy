/**
 * 用 Tatoeba / OPUS 英中句对扩充听写句库：
 * 优先找「包含 PET 词」且带人工中文译文的句子，作为听写题（中文提示 + 英文原句 + 音频）。
 *
 * 用法：
 *   node scripts/build-dictation-tatoeba.js \
 *     --sentences /tmp/eng_sentences.tsv.bz2 \
 *     --zh-links /tmp/eng_cmn_links.tsv.bz2 \
 *     --zh-sentences /tmp/cmn_sentences.tsv.bz2 \
 *     --opus /tmp/ted2020/TED2020.en-zh.en:/tmp/ted2020/TED2020.en-zh.zh \
 *     --limit 5000
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openDb } from '../server/db/index.js';
import { config } from '../server/config.js';
import { loadPetWords, loadKnownVocab, unknownRatio } from './lib/known-vocab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const eq = argv.find(a => a.startsWith(`--${n}=`));
  if (eq) return eq.slice(n.length + 3);
  const i = argv.indexOf(`--${n}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const SENTENCES = opt('sentences', '/tmp/eng_sentences.tsv.bz2');
const ZH_LINKS = opt('zh-links', '/tmp/eng_cmn_links.tsv.bz2');
const ZH_SENTENCES = opt('zh-sentences', '/tmp/cmn_sentences.tsv.bz2');
const OUT = opt('out', path.join(ROOT, 'server', 'seed', 'dictation-tatoeba.csv'));
const LIMIT = Number(opt('limit', 5000)) || 5000;
const MIN_COVERAGE = Number(opt('min-coverage', 0.72));
const MAX_PER_WORD = Number(opt('max-per-word', 2)) || 2;
const OPUS = (opt('opus', '') || '').split(',').filter(Boolean).map(x => {
  const [en, zh] = x.split(':');
  return { en, zh };
});

const SENSITIVE = /\b(suicide|murder|rape|porn|sex|drugs?|cocaine|heroin|terrorist|terrorism|bomb|gun|naked|drunk|die|died|death|dead|kill|killed|killing|god|jesus|christ|allah|fuck|shit)\b/i;

function bz2Lines(file, onLine) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(file)) return reject(new Error(`找不到文件：${file}`));
    const child = spawn('bzip2', ['-dc', file]);
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', onLine);
    rl.on('close', resolve);
    child.on('error', reject);
  });
}

function cleanSentence(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function sentenceOk(s, known) {
  if (s.length < 18 || s.length > 150) return false;
  if (!/^[A-Z]/.test(s)) return false;
  if (!/[.!?]$/.test(s)) return false;
  if (/[^\x20-\x7E]/.test(s)) return false;
  if (/["“”()\[\]{}<>#*_|\\]/.test(s)) return false;
  if (/\d/.test(s)) return false;
  if (SENSITIVE.test(s)) return false;
  if (unknownRatio(s, known) > (1 - MIN_COVERAGE)) return false;
  const wc = s.split(/\s+/).length;
  return wc >= 4 && wc <= 16;
}

async function main() {
  const pet = loadPetWords();
  const known = loadKnownVocab(pet);
  const petWords = [...pet.keys()].filter(w => /^[a-z]{3,}$/.test(w));

  // 现有句库覆盖情况（避免重复、优先补未覆盖的词）
  const db = openDb(config.dbFile);
  const existingRows = db.prepare(`SELECT sentence_en FROM dictation_item`).all();
  db.close();
  const existing = new Set(existingRows.map(r => cleanSentence(r.sentence_en).toLowerCase()));
  const covered = new Map(); // pet word -> count
  for (const row of existingRows) {
    const toks = new Set(cleanSentence(row.sentence_en).toLowerCase().match(/[a-z']+/g) || []);
    for (const w of toks) if (pet.has(w)) covered.set(w, (covered.get(w) || 0) + 1);
  }
  console.log(`现有句库 ${existing.size} 句，已覆盖 PET 词 ${covered.size} 个`);

  // 中文译文
  const cmn = new Map();
  await bz2Lines(ZH_SENTENCES, line => {
    const [id, lang, text] = line.split('\t');
    if ((lang === 'cmn' || lang === 'zh') && text) cmn.set(id, text.trim());
  });
  const links = new Map();
  await bz2Lines(ZH_LINKS, line => {
    const [e, c] = line.split('\t');
    if (!e || !c) return;
    const zh = cmn.get(c);
    if (zh && !links.has(e)) links.set(e, zh);
  });
  console.log(`英中句对 ${links.size} 条`);

  const items = [];
  const seen = new Set();
  const perWord = new Map(covered);

  function tryAdd(en, cn, source, id) {
    if (items.length >= LIMIT) return;
    const s = cleanSentence(en);
    const zh = cleanSentence(cn);
    if (!zh || !sentenceOk(s, known)) return;
    const key = s.toLowerCase();
    if (existing.has(key) || seen.has(key)) return;
    const toks = s.toLowerCase().match(/[a-z']+/g) || [];
    const hits = [...new Set(toks)].filter(w => pet.has(w));
    if (!hits.length) return;
    // 选一个「覆盖最少」的 PET 词作为主题
    hits.sort((a, b) => (perWord.get(a) || 0) - (perWord.get(b) || 0));
    const word = hits.find(w => (perWord.get(w) || 0) < MAX_PER_WORD);
    if (!word) return;
    perWord.set(word, (perWord.get(word) || 0) + 1);
    seen.add(key);
    items.push({
      en: s, cn: zh,
      level: 'PET',
      topic: pet.get(word)?.topic || '',
      tags: '语料例句',
      source: `${source} · ${word}`,
    });
  }

  const n = { total: 0, withZh: 0 };
  await bz2Lines(SENTENCES, line => {
    if (items.length >= LIMIT) return;
    const [id, lang, text] = line.split('\t');
    if (lang !== 'eng' || !text) return;
    n.total += 1;
    const zh = links.get(id);
    if (!zh) return;
    n.withZh += 1;
    tryAdd(text, zh, 'Tatoeba', id);
  });
  console.log(`扫描英文句 ${n.total}，有中文 ${n.withZh}，生成 ${items.length} 题`);

  for (const pair of OPUS) {
    if (items.length >= LIMIT) break;
    if (!fs.existsSync(pair.en) || !fs.existsSync(pair.zh)) { console.warn('跳过缺失语料', pair); continue; }
    const ens = fs.readFileSync(pair.en, 'utf8').split('\n');
    const zhs = fs.readFileSync(pair.zh, 'utf8').split('\n');
    const name = path.basename(pair.en).replace(/\.en$/, '');
    const len = Math.min(ens.length, zhs.length);
    for (let i = 0; i < len && items.length < LIMIT; i++) {
      tryAdd(ens[i], zhs[i], name, i + 1);
    }
    console.log(`OPUS ${name} 处理完，累计 ${items.length} 题`);
  }

  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['句子', '中文', '等级', '主题', '标签', '来源', '语法', '解析'];
  fs.writeFileSync(OUT, [head.map(cell).join(','), ...items.map(i => [i.en, i.cn, i.level, i.topic, i.tags, i.source, '', ''].map(cell).join(','))].join('\n') + '\n', 'utf8');

  const uncovered = petWords.filter(w => !(perWord.get(w) > 0));
  console.log(`输出 ${items.length} 句 → ${path.relative(ROOT, OUT)}`);
  console.log(`PET 词覆盖：${petWords.length - uncovered.length}/${petWords.length}，仍缺 ${uncovered.length} 个`);
}

main().catch(err => { console.error(err); process.exit(1); });
