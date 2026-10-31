/**
 * 轻量 WordNet 3.1 查询：直接解析 wordnet-db 里的 dict/data.* 文本，
 * 提供「单词 → 词性 + 英文释义 + 例句」。无需编译、无需联网。
 *
 * 说明：WordNet 的释义是英英词典释义，措辞比词典简洁，作为「看释义写单词」的题干很合适。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DICT_DIR = path.join(path.dirname(require.resolve('wordnet-db')), 'dict');

// offset 在每个 data.* 文件内独立编号，跨词性会重复，所以索引键必须带词性分组
const DATA_FILES = [['data.noun', 'n'], ['data.verb', 'v'], ['data.adj', 'a'], ['data.adv', 'r']];
const INDEX_FILES = [['index.noun', 'n'], ['index.verb', 'v'], ['index.adj', 'a'], ['index.adv', 'r']];
export const POS_LABEL = { n: 'n.', v: 'v.', a: 'adj.', s: 'adj.', r: 'adv.' };
/** 中文义项里常用的词性缩写 → WordNet 词性 */
export const POS_HINT = {
  'n.': 'n', n: 'n', noun: 'n', 名词: 'n',
  'v.': 'v', v: 'v', verb: 'v', 动词: 'v',
  'adj.': 'a', a: 'a', adj: 'a', adjective: 'a', 形容词: 'a',
  'adv.': 'r', adv: 'r', adverb: 'r', 副词: 'r',
};

const MAX_SENSES = 8;
const MAX_PER_POS = 3;   // 每个词性各留几条，避免名词义项把动词义项挤掉
let index = null;

function clean(t) {
  return String(t || '')
    .replace(/\$[^$]*\$/g, m => m.slice(1, -1))   // 上位词标记
    .replace(/[+]/g, ' ')                          // 派生词标记
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseData() {
  const senses = new Map();        // offset -> {pos, def, example}
  const lemmaOffsets = new Map();  // word -> [offset…]（文件内出现顺序）
  for (const [file, defaultPos] of DATA_FILES) {
    const text = fs.readFileSync(path.join(DICT_DIR, file), 'latin1');
    for (const line of text.split('\n')) {
      if (!line || line[0] === ' ') continue;
      const sp = line.trim().split(/\s+/);
      if (sp.length < 8) continue;
      const pos = sp[2] === 's' ? 's' : sp[2] === 'a' ? 'a' : defaultPos;
      const wc = parseInt(sp[3], 16);   // data.* 里 word_count 是十六进制（≥10 时写作 0a/0b…）
      if (!wc) continue;
      const pipe = sp.indexOf('|');                    // 义项正文从第一个独立的 | 开始
      if (pipe < 0 || pipe < 4 + wc * 2) continue;
      const gloss = sp.slice(pipe).join(' ').replace(/^\|\s*/, '').trim();
      if (!gloss) continue;
      const bar = gloss.indexOf('|');
      const def = clean(bar > -1 ? gloss.slice(0, bar) : gloss);
      const example = bar > -1 ? clean(gloss.slice(bar + 1)) : '';
      if (def.length < 4) continue;
      const key = `${defaultPos}:${Number(sp[0])}`;
      if (!senses.has(key)) senses.set(key, { pos, def, example });
      for (let i = 0; i < wc; i++) {
        // 形容词常有 ashamed(p) / howling(a) 这类标记，去掉括号后缀再入索引
        const w = String(sp[4 + i * 2] || '')
          .replace(/_[aprs]$/i, '')
          .replace(/_/g, ' ')
          .replace(/\([a-z]*\)$/i, '')
          .toLowerCase();
        // 单词与 2–3 词的常用短语（air conditioning、bus stop）都收，短语超出 3 词丢弃
        if (!w || w.split(' ').length > 3 || !/^[a-z][a-z '\-]*$/.test(w)) continue;
        let list = lemmaOffsets.get(w);
        if (!list) { list = []; lemmaOffsets.set(w, list); }
        list.push(key);
      }
    }
  }
  return { senses, lemmaOffsets };
}

/**
 * index.* 里每个词的义项编号按常用度排序，用它把 data.* 的义项重排，
 * 这样「看释义写单词」拿到的一般是最常用的那个意思（例如 box 优先「盒子」而不是「一拳」）。
 */
function parseIndexOrder() {
  const order = new Map();  // word -> [offset…]
  for (const [file, group] of INDEX_FILES) {
    const text = fs.readFileSync(path.join(DICT_DIR, file), 'latin1');
    for (const line of text.split('\n')) {
      if (!line || line[0] === ' ') continue;
      const sp = line.trim().split(/\s+/);   // 行尾有空格，先 trim 再切
      if (sp.length < 6) continue;
      const lemma = sp[0].replace(/_/g, ' ').toLowerCase();
      if (!lemma || lemma.includes(' ')) continue;
      const cnt = Number(sp[2]);
      if (!cnt) continue;
      const offs = sp.slice(-cnt)
        .map(Number)
        .filter(n => Number.isFinite(n) && n > 0)
        .map(n => `${group}:${n}`);
      if (!offs.length) continue;
      const prev = order.get(lemma);
      order.set(lemma, prev ? prev.concat(offs) : offs);
    }
  }
  return order;
}

function build() {
  if (index) return index;
  const { senses, lemmaOffsets } = parseData();
  const freqOrder = parseIndexOrder();
  const map = new Map();
  for (const [word, docOffsets] of lemmaOffsets) {
    const ordered = [];
    const seen = new Set();
    for (const off of freqOrder.get(word) || []) {
      const s = senses.get(off);
      if (s) { ordered.push(s); seen.add(off); }
    }
    for (const off of docOffsets) {
      if (seen.has(off)) continue;
      const s = senses.get(off);
      if (s) { ordered.push(s); seen.add(off); }
    }
    const list = [];
    const perPos = {};
    const defs = new Set();
    for (const s of ordered) {
      if (list.length >= MAX_SENSES) break;
      if (defs.has(s.def)) continue;
      if ((perPos[s.pos] || 0) >= MAX_PER_POS) continue;
      defs.add(s.def);
      perPos[s.pos] = (perPos[s.pos] || 0) + 1;
      list.push(s);
    }
    if (list.length) map.set(word, list);
  }
  index = map;
  return map;
}

/** 单词的所有 WordNet 义项：[{pos,posLabel,def,example}] */
export function lookup(word) {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return [];
  const list = build().get(key) || [];
  return list.map(s => ({ ...s, posLabel: POS_LABEL[s.pos] || '' }));
}

/**
 * 取最合适的一条释义：给了词性提示（如「n.」「v.」）就优先同词性的第一条。
 * @returns {{pos:string,posLabel:string,def:string,example:string}|null}
 */
export function bestDefinition(word, posHint) {
  const all = lookup(word);
  if (!all.length) return null;
  const want = POS_HINT[String(posHint || '').trim().toLowerCase()];
  if (want) {
    const hit = all.find(s => (want === 'a' ? (s.pos === 'a' || s.pos === 's') : s.pos === want));
    if (hit) return hit;
  }
  return all[0];
}

export function hasWord(word) {
  return build().has(String(word || '').trim().toLowerCase());
}

/** WordNet 只收原形，这里补一层屈折变化还原（不规则复数单独列）。 */
export const IRREGULAR = {
  children: 'child', teeth: 'tooth', feet: 'foot', geese: 'goose', mice: 'mouse',
  men: 'man', women: 'woman', people: 'person', oxen: 'ox',
  knives: 'knife', leaves: 'leaf', shelves: 'shelf', wolves: 'wolf', wives: 'wife',
  lives: 'life', halves: 'half', loaves: 'loaf', thieves: 'thief',
  scarves: 'scarf', hooves: 'hoof', calves: 'calf',
  data: 'datum', media: 'medium', criteria: 'criterion', phenomena: 'phenomenon',
  analyses: 'analysis', crises: 'crisis', theses: 'thesis',
  better: 'good', best: 'good', worse: 'bad', worst: 'bad',
  went: 'go', gone: 'go', did: 'do', done: 'do', was: 'be', were: 'be', been: 'be',
  had: 'have', has: 'have', took: 'take', taken: 'take', made: 'make',
  wrote: 'write', written: 'write', spoke: 'speak', spoken: 'speak',
  bought: 'buy', brought: 'bring', thought: 'think', taught: 'teach',
  caught: 'catch', fought: 'fight', found: 'find', left: 'leave', kept: 'keep',
  slept: 'sleep', felt: 'feel', met: 'meet', paid: 'pay', said: 'say',
  sold: 'sell', told: 'tell', stood: 'stand', understood: 'understand',
  won: 'win', lost: 'lose', built: 'build', sent: 'send', spent: 'spend',
  became: 'become', began: 'begin', begun: 'begin', broke: 'break', broken: 'break',
  chose: 'choose', chosen: 'choose', drove: 'drive', driven: 'drive',
  ate: 'eat', eaten: 'eat', fell: 'fall', fallen: 'fall', flew: 'fly', flown: 'fly',
  forgot: 'forget', forgotten: 'forget', got: 'get', gotten: 'get',
  grew: 'grow', grown: 'grow', heard: 'hear', hid: 'hide', hidden: 'hide',
  held: 'hold', led: 'lead', meant: 'mean', rode: 'ride', ridden: 'ride',
  rang: 'ring', rung: 'ring', rose: 'rise', risen: 'rise', ran: 'run',
  saw: 'see', seen: 'see', sang: 'sing', sung: 'sing', sat: 'sit', stole: 'steal',
  stolen: 'steal', swam: 'swim', swum: 'swim', threw: 'throw', thrown: 'throw',
  woke: 'wake', woken: 'wake', wore: 'wear', worn: 'wear',
};

/** 由屈折形式反推原形的候选列表（按可靠度排序） */
export function stemCandidates(word) {
  const w = String(word || '').trim().toLowerCase();
  if (!w || w.length < 3) return [];
  const out = [];
  const add = s => {
    if (s && s.length >= 2 && s !== w && !out.includes(s)) out.push(s);
  };
  if (IRREGULAR[w]) add(IRREGULAR[w]);
  const dbl = w.match(/(.)\1(ed|ing|er|est)$/);
  if (dbl) add(w.slice(0, -(dbl[2].length + 1)));
  if (/([^aeiou])ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/(s|x|z|ch|sh)es$/.test(w)) add(w.slice(0, -2));
  if (/[^su]s$/.test(w)) add(w.slice(0, -1));
  if (/ing$/.test(w)) {
    add(w.slice(0, -3));
    add(w.slice(0, -3) + 'e');
  }
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ier$/.test(w)) {
    add(w.slice(0, -3) + 'y');
    add(w.slice(0, -2));
  }
  if (/iest$/.test(w)) {
    add(w.slice(0, -4) + 'y');
    add(w.slice(0, -3));
  }
  if (/ed$/.test(w)) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  }
  if (/er$/.test(w)) {
    add(w.slice(0, -2));
    add(w.slice(0, -1));
  }
  if (/est$/.test(w)) {
    add(w.slice(0, -3));
    add(w.slice(0, -2));
  }
  if (/ily$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ly$/.test(w)) add(w.slice(0, -2));
  if (/'s$/.test(w)) add(w.slice(0, -2));
  return out;
}

/**
 * 先直接查，查不到再按屈折变化还原查；返回 {word, matched, senses}。
 * matched 为命中的原形（等于 word 时说明是直接命中）。
 */
/** 连字符/空格写法与英式拼写的等价形式（WordNet 以美式拼写收录） */
export function spellingVariants(word) {
  const w = String(word || '').trim().toLowerCase();
  const out = new Set();
  if (w.includes('-')) {
    out.add(w.replace(/-/g, ''));      // 先试连写（secondhand、tablecloth）
    out.add(w.replace(/-/g, ' '));
  }
  if (w.includes(' ')) {
    out.add(w.replace(/ /g, '-'));
    out.add(w.replace(/ /g, ''));
  }
  out.add(w.replace(/our\b/g, 'or'));
  out.add(w.replace(/isation\b/g, 'ization'));
  out.add(w.replace(/ise\b/g, 'ize'));
  out.add(w.replace(/yse\b/g, 'yze'));
  out.add(w.replace(/ogue\b/g, 'og'));
  out.add(w.replace(/ll(ing|ed|er|ers)\b/g, 'l$1'));
  if (w.includes('centre')) out.add(w.replace(/centre/g, 'center'));
  if (w.includes('theatre')) out.add(w.replace(/theatre/g, 'theater'));
  if (w.includes('metre')) out.add(w.replace(/metre/g, 'meter'));
  if (w.includes('litre')) out.add(w.replace(/litre/g, 'liter'));
  out.delete(w);
  return [...out];
}

function senseOf(s) {
  return { ...s, posLabel: POS_LABEL[s.pos] || '' };
}

function matchHint(sense, want) {
  if (!want) return true;
  return want === 'a' ? (sense.pos === 'a' || sense.pos === 's') : sense.pos === want;
}

/**
 * 先直接查，查不到再按屈折变化还原查；返回 {word, matched, sense, senses}。
 * matched 为命中的原形（等于 word 时说明是直接命中）。
 */
export function lookupSmart(word, posHint) {
  const key = String(word || '').trim().toLowerCase();
  const want = POS_HINT[String(posHint || '').trim().toLowerCase()];
  if (!key) return { word: key, matched: null, sense: null, senses: [] };
  const direct = build().get(key) || [];
  if (direct.length) {
    const hit = direct.find(s => matchHint(s, want));
    if (hit) return { word: key, matched: key, sense: senseOf(hit), senses: lookup(key) };
  }
  for (const alt of spellingVariants(key)) {
    const list = build().get(alt);
    if (list && list.length) {
      const s = list.find(x => matchHint(x, want)) || list[0];
      return { word: key, matched: alt, sense: senseOf(s), senses: lookup(alt) };
    }
  }
  for (const cand of stemCandidates(key)) {
    const list = build().get(cand);
    if (!list || !list.length) continue;
    const s = list.find(x => matchHint(x, want)) || list[0];
    return { word: key, matched: cand, sense: senseOf(s), senses: lookup(cand) };
  }
  if (direct.length) {
    return { word: key, matched: key, sense: senseOf(direct[0]), senses: lookup(key) };
  }
  return { word: key, matched: null, sense: null, senses: [] };
}
