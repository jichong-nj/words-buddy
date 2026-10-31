/**
 * 校验 PET 词库对官方 B1 词表的覆盖率。
 * 用法：node scripts/check-pet-coverage.js [--file server/seed/pet-words.csv]
 * 输出：已覆盖/缺失词条，缺失清单可直接对照官方 PDF 补录。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argFile = (() => {
  const i = process.argv.indexOf('--file');
  return i > -1 ? process.argv[i + 1] : path.join(ROOT, 'server', 'seed', 'pet-words.csv');
})();
const OFFICIAL = path.join(ROOT, 'server', 'seed', 'b1-official-words.json');

const parseCsvLine = line => [...String(line).matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));

/** 英文/美式拼写与单复数归并，避免把 realise/organize 这类变体误判为缺失 */
export function variants(word) {
  const k = String(word).toLowerCase().replace(/’/g, "'");
  const out = new Set([k]);
  out.add(k.replace(/our\b/g, 'or'));
  out.add(k.replace(/isation\b/g, 'ization').replace(/ise\b/g, 'ize').replace(/yse\b/g, 'yze'));
  out.add(k.replace(/ogue\b/g, 'og').replace(/ll(ing|ed|er|ers)\b/g, 'l$1'));
  out.add(k.replace(/centre/g, 'center').replace(/theatre/g, 'theater').replace(/metre/g, 'meter').replace(/litre/g, 'liter'));
  out.add(k.replace(/grey/g, 'gray'));
  if (k.endsWith('s') && !k.endsWith('ss') && k.length > 4) out.add(k.slice(0, -1));
  if (k.endsWith('ce')) out.add(k.slice(0, -2) + 'se');
  out.add(k.normalize('NFD').replace(/[\u0300-\u036f]/g, ''));   // café → cafe
  return out;
}

const csvWords = new Set();
for (const line of fs.readFileSync(argFile, 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue;
  const cells = parseCsvLine(line);
  if (cells[0]) for (const v of variants(cells[0])) csvWords.add(v);
}

const official = JSON.parse(fs.readFileSync(OFFICIAL, 'utf8'));
const missing = official.filter(x => ![...variants(x.word)].some(v => csvWords.has(v)));

console.log(`词库：${path.relative(ROOT, argFile)}（${csvWords.size} 个可归一化词形）`);
console.log(`官方 B1 词表：${official.length} 个词条`);
console.log(`覆盖：${official.length - missing.length} / ${official.length}（${((official.length - missing.length) / official.length * 100).toFixed(1)}%）`);
if (missing.length) {
  console.log(`\n未覆盖 ${missing.length} 个：`);
  for (const m of missing) console.log(`  - ${m.word} (${m.pos.join(' & ')})`);
  process.exitCode = 1;
}
