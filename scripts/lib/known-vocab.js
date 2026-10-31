/**
 * 共用词表白名单：PET 词表 + 常用功能词，用于判断语料句子/文章是否「PET 难度」。
 * 供 scripts/build-form-items.js 与 scripts/build-reading-bank.js 复用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(__dirname, '..', '..');
export const WORDS_CSV = path.join(ROOT, 'server', 'seed', 'pet-words.csv');

export function parseCsvLine(line) {
  return [...String(line).matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
}

/** PET 词表：小写单词 → {pos, topic, level} */
export function loadPetWords() {
  const lines = fs.readFileSync(WORDS_CSV, 'utf8').split('\n').filter(l => l.trim());
  const map = new Map();
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    if (c.length < 4) continue;
    const word = c[0].trim().toLowerCase();
    const pos = (c[1] || '').trim();
    if (!/^[a-z]{2,14}$/.test(word)) continue;
    if (!map.has(word)) map.set(word, { pos, topic: c[3] || '', level: c[4] || '' });
  }
  return map;
}

const COMMON = ['a','an','the','i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their',
  'is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would','can','could','shall','should',
  'may','might','must','not','no','yes','and','or','but','if','because','so','than','then','that','this','these','those','there','here',
  'in','on','at','to','for','from','with','without','by','about','of','off','up','down','out','over','under','after','before','between',
  'into','through','during','while','when','where','why','how','what','who','whom','whose','which','one','two','three','four','five',
  'six','seven','eight','nine','ten','first','second','third','last','next','many','much','more','most','some','any','all','both',
  'each','every','few','little','other','another','such','own','same','very','too','also','just','only','even','still','yet','again',
  'once','twice','always','usually','often','sometimes','never','now','today','tomorrow','yesterday','soon','later','early','late',
  'good','bad','big','small','new','old','young','long','short','high','low','hot','cold','warm','easy','hard','right','left','true',
  'false','real','sure','able','people','man','woman','boy','girl','child','children','friend','family','day','week','month','year',
  'time','place','thing','way','work','home','house','school','city','country','world','life','part','number','name','word','book',
  'water','food','money','car','bus','train','government','company','group','team','game','film','music','art','history','science',
  'english','language','health','sport','weather','animal','plant','river','sea','mountain','road','street','weekend','holiday'];

/** 词汇白名单（含 PET 词表） */
export function loadKnownVocab(pet = loadPetWords()) {
  const known = new Set(COMMON);
  for (const w of pet.keys()) known.add(w);
  return known;
}

/** 文本中「超纲词」占比（用于难度判断），忽略专有名词与数字 */
export function unknownRatio(text, known, { ignoreCapitalized = true } = {}) {
  const words = String(text).match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (!words.length) return 1;
  let unknown = 0;
  for (const w of words) {
    if (ignoreCapitalized && /^[A-Z]/.test(w) && w !== 'I') continue;   // 人名地名不算超纲
    if (!known.has(w.toLowerCase())) unknown += 1;
  }
  return unknown / words.length;
}
