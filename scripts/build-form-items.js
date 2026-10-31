/**
 * 用真实语料批量生成「变形填空」题：从 Tatoeba 英文句子中挑出含 PET 词变形的句子，
 * 把变形词挖空、给出原型，答案就是原句里的变形。
 *
 * 用法：
 *   node scripts/build-form-items.js --sentences /tmp/eng_sentences.tsv.bz2 --limit 4000
 *   node scripts/build-form-items.js --sentences /tmp/eng_sentences.tsv --out server/seed/form-items-pet.csv
 *
 * 语料来源：Tatoeba（CC BY 2.0），生成的题目 notes 里保留句子 id，可追溯。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { IRREGULAR } from '../server/lib/wordnet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SENTENCES = opt('sentences', '/tmp/eng_sentences.tsv.bz2');
const ZH_LINKS = opt('zh-links', '');       // eng-cmn_links.tsv.bz2（英文句 id → 中文句 id）
const ZH_SENTENCES = opt('zh-sentences', ''); // cmn_sentences.tsv.bz2
const REQUIRE_ZH = argv.includes('--require-zh');
// 额外的英中句对语料（OPUS moses 格式，行对齐）：--opus en1:zh1,en2:zh2
const OPUS = (opt('opus', '') || '').split(',').filter(Boolean).map(x => {
  const [en, zh] = x.split(':');
  return { en, zh };
});
const OUT = opt('out', path.join(ROOT, 'server', 'seed', 'form-items-pet.csv'));
const LIMIT = Number(opt('limit', 4000)) || 4000;

const WORDS_CSV = path.join(ROOT, 'server', 'seed', 'pet-words.csv');

// ───────────── PET 词表：词 → {pos, topic} ─────────────
function parseCsvLine(line) {
  return [...String(line).matchAll(/"((?:[^"]|"")*)"/g)].map(m => m[1].replace(/""/g, '"'));
}

function loadKnownVocab(pet) {
  const known = new Set(['a','an','the','i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their',
    'is','are','was','were','be','been','being','am','do','does','did','have','has','had','will','would','can','could','shall','should',
    'may','might','must','not','no','yes','and','or','but','if','because','so','than','then','that','this','these','those','there','here',
    'in','on','at','to','for','from','with','without','by','about','of','off','up','down','out','over','under','after','before','between',
    'into','through','during','while','when','where','why','how','what','who','whom','whose','which','one','two','three','four','five','six',
    'seven','eight','nine','ten','first','second','third','last','next','many','much','more','most','some','any','all','both','each','every',
    'few','little','other','another','such','own','same','very','too','also','just','only','even','still','yet','again','once','twice','always',
    'usually','often','sometimes','never','now','today','tomorrow','yesterday','soon','later','early','late','good','bad','big','small','new',
    'old','young','long','short','high','low','hot','cold','warm','easy','hard','right','left','true','false','real','sure','able','because',
    'people','man','woman','boy','girl','child','children','friend','family','day','week','month','year','time','place','thing','way','work',
    'home','house','school','city','country','world','life','part','number','name','word','book','water','food','money','car','bus','train']);
  for (const w of pet.keys()) known.add(w);
  return known;
}

function loadPetWords() {
  const lines = fs.readFileSync(WORDS_CSV, 'utf8').split('\n').filter(l => l.trim());
  const map = new Map();
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    if (c.length < 4) continue;
    const word = c[0].trim().toLowerCase();
    const pos = (c[1] || '').trim();
    if (!/^[a-z]{3,14}$/.test(word)) continue;          // 只要能直接匹配单词的词条
    if (!/^(n\.|v\.|adj\.|adv\.)/.test(pos)) continue;  // 功能词/短语不参与
    if (!map.has(word)) map.set(word, { pos, topic: c[3] || '', cn: (c[2] || '').replace(/^[a-z]+\.\s*/i, '').trim() });
  }
  return map;
}

// ───────────── 变形规则：form → [{base, type}] ─────────────
const NO_DOUBLE = new Set(['w', 'x', 'y']);

function addForm(index, form, base, type) {
  if (!form || form === base || form.length < 3) return;
  if (!index.has(form)) index.set(form, []);
  const list = index.get(form);
  if (!list.some(x => x.base === base && x.type === type)) list.push({ base, type });
}

function buildFormIndex(pet) {
  const index = new Map();
  for (const [word, info] of pet) {
    const pos = info.pos;
    if (pos === 'n.') {
      // 名词复数
      if (/(s|x|z|ch|sh)$/.test(word)) addForm(index, word + 'es', word, 'plural');
      else if (/[^aeiou]y$/.test(word)) addForm(index, word.slice(0, -1) + 'ies', word, 'plural');
      else addForm(index, word + 's', word, 'plural');
    }
    if (pos === 'v.') {
      // 第三人称单数（主谓一致）
      if (/(s|x|z|ch|sh)$/.test(word)) addForm(index, word + 'es', word, 'third');
      else if (/[^aeiou]y$/.test(word)) addForm(index, word.slice(0, -1) + 'ies', word, 'third');
      else addForm(index, word + 's', word, 'third');
    }
    if (pos === 'v.') {
      // 规则过去式 / 过去分词
      if (/e$/.test(word)) addForm(index, word + 'd', word, 'tense');
      else if (/[^aeiou]y$/.test(word)) addForm(index, word.slice(0, -1) + 'ied', word, 'tense');
      else {
        addForm(index, word + 'ed', word, 'tense');
        const last = word[word.length - 1];
        if (/[bdfgklmnprst]/.test(last) && !NO_DOUBLE.has(last)) addForm(index, word + last + 'ed', word, 'tense');
      }
      // 现在分词
      if (/e$/.test(word)) addForm(index, word.slice(0, -1) + 'ing', word, 'tense');
      else {
        addForm(index, word + 'ing', word, 'tense');
        const last = word[word.length - 1];
        if (/[bdgklmnprst]/.test(last)) addForm(index, word + last + 'ing', word, 'tense');
      }
    }
    if (pos === 'adj.' || pos === 'adv.') {
      addForm(index, word + 'ly', word, 'adverb');
      if (/y$/.test(word)) addForm(index, word.slice(0, -1) + 'ily', word, 'adverb');
      if (/le$/.test(word)) addForm(index, word.slice(0, -1) + 'y', word, 'adverb');
    }
    if (pos === 'adj.') {
      if (/e$/.test(word)) addForm(index, word + 'r', word, 'comparative');
      else if (/[^aeiou]y$/.test(word)) addForm(index, word.slice(0, -1) + 'ier', word, 'comparative');
      else addForm(index, word + 'er', word, 'comparative');
      if (/e$/.test(word)) addForm(index, word + 'st', word, 'comparative');
      else if (/[^aeiou]y$/.test(word)) addForm(index, word.slice(0, -1) + 'iest', word, 'comparative');
      else addForm(index, word + 'est', word, 'comparative');
    }
  }
  // 不规则动词 / 不规则复数（只收 PET 词表里有的原型）
  for (const [form, base] of Object.entries(IRREGULAR)) {
    if (!pet.has(base) || form === base) continue;
    const pos = pet.get(base).pos;
    if (pos === 'v.') addForm(index, form, base, 'tense');
    else if (pos === 'n.') addForm(index, form, base, 'plural');
  }
  return index;
}

// ───────────── 句子筛选与挖空 ─────────────
const BAD_CHARS = /[^\x00-\x7F]|[0-9"“”()[\]{}<>#*_/\\|@$%^&~`+=]/;
const COMMON_OK = /^[A-Z][A-Za-z ,.'!?;:’'-]*$/;

function sentenceOk(s, known) {
  if (s.length < 18 || s.length > 180) return false;
  if (BAD_CHARS.test(s)) return false;
  if (!COMMON_OK.test(s)) return false;
  if (!/[.!?]$/.test(s)) return false;
  if (/[,:;]$/.test(s)) return false;
  const words = s.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length < 4) return false;
  // 词汇难度：超纲词不超过 1 个，避免 Tatoeba 里生僻/古旧句子
  let unknown = 0;
  for (const w of words) {
    const lw = w.toLowerCase();
    if (w.length > 14) return false;
    if (!known.has(lw)) unknown += 1;
  }
  if (unknown > 2) return false;
  if (/--/.test(s)) return false;
  // 跳过含专有名词的句子（除句首与 I）
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (w === 'I') continue;
    if (/^[A-Z]/.test(w) && !/^[A-Z]{2,}$/.test(w)) return false;
  }
  return true;
}

const HINT = {
  plural: '根据句中的数量或主语，这里需要用复数形式。',
  tense: '根据句中的时间/助动词判断时态，用相应的动词形式。',
  comparative: '句中有 than / the…in 等比较语境，用比较级或最高级。',
  adverb: '这里修饰动词或形容词，需要用副词形式。',
};

function explainFor(base, answer, type, sentence) {
  const s = sentence.toLowerCase();
  if (type === 'tense') {
    if (/\b(yesterday|last|ago|then|in (19|20)\d\d)\b/.test(s)) return `句中有过去时间标志，用一般过去时：${answer}。`;
    if (/\b(have|has|had)\b/.test(s)) return `与 have/has/had 连用，用过去分词：${answer}。`;
    if (/\b(is|are|am|was|were)\b/.test(s) && /ing$/.test(answer)) return `与 be 动词连用，用现在分词：${answer}。`;
    return `根据句子时态，${base} 应变为 ${answer}。`;
  }
  if (type === 'plural') return `这里是复数语境，${base} 的复数形式是 ${answer}。`;
  if (type === 'third') return `主语是第三人称单数且为一般现在时，${base} 应变为 ${answer}。`;
  if (type === 'comparative') return `比较语境中，${base} 应变为 ${answer}。`;
  if (type === 'adverb') return `修饰动词/形容词时用副词，${base} 变为 ${answer}。`;
  return `${base} → ${answer}`;
}

const FORBIDDEN_PREV = new Set(['to','am','is','are','was','were','be','been','being','can','could','may','might','must','should','would',
  'will','shall','not','never','always','often','usually','sometimes','don\'t','doesn\'t','didn\'t','very','so','too','more','most']);

function blankToken(sentence, surface, occurrence = 0) {
  let count = 0;
  return sentence.replace(new RegExp(`\\b${surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), m => {
    if (count++ === occurrence) return '____';
    return m;
  });
}

async function loadZhMap() {
  if (!ZH_LINKS || !ZH_SENTENCES) return new Map();
  const fsMod = fs;
  const cmn = new Map();
  await processBz2Lines(ZH_SENTENCES, line => {
    const [id, lang, text] = line.split('\t');
    if ((lang === 'cmn' || lang === 'zh') && text) cmn.set(id, text.trim());
  });
  const links = new Map();
  await processBz2Lines(ZH_LINKS, line => {
    const [e, c] = line.split('\t');
    if (!e || !c) return;
    const zh = cmn.get(c);
    if (zh && !links.has(e)) links.set(e, zh);
  });
  return links;
}

async function processBz2Lines(file, onLine) {
  if (!fs.existsSync(file)) throw new Error(`找不到文件：${file}`);
  const child = spawn('bzip2', ['-dc', file]);
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

async function processSentences(file, onLine) {
  let stream;
  if (/\.bz2$/.test(file)) {
    const child = spawn('bzip2', ['-dc', file]);
    stream = child.stdout;
  } else {
    stream = fs.createReadStream(file);
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.startsWith('#')) continue;
    const [id, lang, text] = line.split('\t');
    if (lang !== 'eng' || !text) continue;
    onLine(Number(id), text.trim());
  }
}

async function main() {
  if (!fs.existsSync(SENTENCES)) {
    console.error(`找不到语料文件：${SENTENCES}\n请先下载 Tatoeba 英文句子：\n  curl -L -o /tmp/eng_sentences.tsv.bz2 https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2`);
    process.exit(1);
  }
  const pet = loadPetWords();
  const known = loadKnownVocab(pet);
  const zhById = await loadZhMap();
  if (zhById.size) console.log(`中文翻译句对：${zhById.size} 条`);
  const formIndex = buildFormIndex(pet);
  console.log(`PET 词条 ${pet.size} 个，可识别的变形形式 ${formIndex.size} 个`);

  const items = [];
  const usedPrompts = new Set();
  const perBase = new Map();
  const perBaseType = new Map();
  const usedSentences = new Set();
  const MAX_PER_BASE = 60;
  const MAX_PER_BASE_TYPE = 20;
  // 各考点预算，避免全是名词复数
  const BUDGET = { plural: 3000, tense: 4000, third: 2000, adverb: 1500, comparative: 1200 };
  const counts = { plural: 0, tense: 0, third: 0, adverb: 0, comparative: 0 };
  const typeKeyOf = t => (t === 'adverb' ? 'adverb' : t === 'comparative' ? 'comparative' : t);

  function handleSentence(id, text, sCn) {
    if (items.length >= LIMIT) return;
    if (REQUIRE_ZH && !sCn) return;
    if (!sentenceOk(text, known)) return;

    if (usedSentences.has(text)) return;
    let perSentence = 0;
    const tokens = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    const lower = tokens.map(t => t.toLowerCase());
    // 「more/most + 多音节形容词」作为比较级短语题
    for (let i = 0; i < lower.length - 1 && perSentence < 4; i++) {
      if (lower[i] !== 'more' && lower[i] !== 'most') continue;
      const adj = lower[i + 1];
      const info = pet.get(adj);
      if (!info || info.pos !== 'adj.' || adj.length < 6) continue;
      const bucket = 'comparative';
      if ((counts[bucket] || 0) >= (BUDGET[bucket] || 0)) break;
      const baseCount = perBase.get(adj) || 0;
      if (baseCount >= MAX_PER_BASE) continue;
      if (lower.includes(adj) && lower.indexOf(adj) !== i + 1) continue;
      const phrase = `${tokens[i]} ${tokens[i + 1]}`;
      const prompt = text.replace(new RegExp(`\\b${tokens[i]}\\s+${tokens[i + 1]}\\b`), '____');
      if (!prompt.includes('____')) continue;
      if (usedPrompts.has(prompt)) continue;
      usedPrompts.add(prompt);
      items.push({
        prompt, base: adj, answer: phrase, accepted: phrase, point: '比较级', level: 'PET',
        topic: info.topic || '', tags: '自动生成,comparative',
        explain: `比较语境中，${adj} 用 ${phrase}。`, notes: `Tatoeba #${id}（CC BY 2.0）`,
        sentenceCn: sCn, wordCn: info.cn || '',
      });
      counts[bucket] = (counts[bucket] || 0) + 1;
      perBase.set(adj, baseCount + 1);
      perSentence += 1;
      break;
    }
    // 句子级：同一个词只取一次，避免一句话出多题
    for (const tok of lower) {
      const cands = formIndex.get(tok);
      if (!cands) continue;
      for (const cand of cands) {
        const { base, type } = cand;
        const bucket = typeKeyOf(type);
        if ((counts[bucket] || 0) >= (BUDGET[bucket] || 0)) continue;
        const baseCount = perBase.get(base) || 0;
        if (baseCount >= MAX_PER_BASE) continue;
        const typeKey = `${base}|${type}`;
        if ((perBaseType.get(typeKey) || 0) >= MAX_PER_BASE_TYPE) continue;
        // 原型本身也出现在句子里就跳过（会泄答案）
        if (lower.includes(base)) continue;
        const pos = lower.indexOf(tok);
        // 上下文守卫：避免把 "to do" / "am quits" 这类误判成变形题
        const prev = pos > 0 ? lower[pos - 1] : '';
        if (FORBIDDEN_PREV.has(prev)) continue;
        if (type === 'third' && pos > 0 && prev.length <= 3 && !/^(the|a|an|my|his|her|its|our|their|this|that|every|each|some|any|no)$/.test(prev)) continue;
        const surface = tokens[pos];
        const prompt = blankToken(text, surface);
        if (!prompt.includes('____')) continue;
        if (usedPrompts.has(prompt)) continue;
        usedPrompts.add(prompt);
        usedSentences.add(text);
        const answer = surface;
        const point = type === 'plural' ? '复数'
          : type === 'third' ? '主谓一致'
            : type === 'tense' ? '时态'
              : type === 'comparative' ? '比较级' : '词性';
        items.push({
          prompt,
          base,
          answer,
          accepted: answer,
          point,
          level: 'PET',
          topic: pet.get(base).topic || '',
          tags: `自动生成,${type}`,
          explain: explainFor(base, answer, type, text),
          notes: `Tatoeba #${id}（CC BY 2.0）`,
          sentenceCn: sCn, wordCn: pet.get(base).cn || '',
        });
        counts[bucket] = (counts[bucket] || 0) + 1;
        perBase.set(base, baseCount + 1);
        perBaseType.set(typeKey, (perBaseType.get(typeKey) || 0) + 1);
        perSentence += 1;
        break; // 同一 token 只出一个空
      }
      if (perSentence >= 4) break;   // 一句话最多出三题
    }
  if (perSentence) usedSentences.add(text);
}

  // 1) Tatoeba（可带中文翻译）
  await processSentences(SENTENCES, (id, text) => handleSentence(String(id), text, zhById.get(String(id)) || ''));

  // 2) 额外的英中句对语料（OPUS）
  for (const pair of OPUS) {
    if (!fs.existsSync(pair.en) || !fs.existsSync(pair.zh)) {
      console.warn(`跳过缺失的语料：${pair.en} / ${pair.zh}`);
      continue;
    }
    const ens = fs.readFileSync(pair.en, 'utf8').split('\n');
    const zhs = fs.readFileSync(pair.zh, 'utf8').split('\n');
    const name = path.basename(pair.en).replace(/\.en$/, '');
    const n = Math.min(ens.length, zhs.length);
    for (let i = 0; i < n && items.length < LIMIT; i++) {
      const en = ens[i].trim();
      const zh = zhs[i].trim();
      if (!en || !zh) continue;
      handleSentence(`opus:${name}:${i + 1}`, en, zh);
    }
    console.log(`已处理 OPUS 语料 ${name}: ${n} 行，当前 ${items.length} 题`);
  }

  const head = '"句子","原型","答案","可接受答案","考点","等级","主题","标签","句子翻译","词义","解析","备注"';
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = items.map(i => [i.prompt, i.base, i.answer, i.accepted, i.point, i.level, i.topic, i.tags,
    i.sentenceCn || '', i.wordCn || '', i.explain, i.notes].map(cell).join(','));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, [head, ...lines].join('\n') + '\n', 'utf8');

  const byPoint = {};
  for (const i of items) byPoint[i.point] = (byPoint[i.point] || 0) + 1;
  console.log(`生成 ${items.length} 题 → ${path.relative(ROOT, OUT)}`);
  console.log('考点分布：', byPoint);
  console.log(`覆盖原型 ${perBase.size} 个`);
  if (items.length < LIMIT) console.log(`提示：语料只够生成 ${items.length} 题（目标 ${LIMIT}）`);
}

main().catch(err => { console.error(err); process.exit(1); });
