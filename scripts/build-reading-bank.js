/**
 * 从 SQuAD 1.1 数据集批量生成「阅读理解」题库（文章 + 四选一）。
 *
 * SQuAD 的每篇文章（Wikipedia 段落）本身带有人工标注的问题与答案跨度；
 * 本脚本把「问题 + 正确跨度」转成四选一：正确答案取标注跨度，三个干扰项从
 * 同一篇文章/全库的其它答案里按长度与类型（是否数字）相似地抽样。
 *
 * 用法：
 *   node scripts/build-reading-bank.js --squad /tmp/squad-dev.json --limit 1200
 *   node scripts/build-reading-bank.js --squad dev-v2.0.json --limit 1500 --min-coverage 0.8
 *
 * 数据来源：SQuAD 1.1（CC BY-SA 4.0，基于英文 Wikipedia）。生成题目标注「自动生成」。
 */
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, loadPetWords, loadKnownVocab, unknownRatio } from './lib/known-vocab.js';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const SRC = opt('squad', '/tmp/squad-dev.json');
const OUT = opt('out', path.join(ROOT, 'server', 'seed', 'reading-squad.csv'));
const LIMIT = Number(opt('limit', 1200)) || 1200;
const MIN_COVERAGE = Number(opt('min-coverage', 0.82));   // 文章里非专有名词的词汇至少 82% 在 PET+常用词表内

// ───────────── 主题映射（把 Wikipedia 标题粗分到 PET Topic） ─────────────
const TOPIC_RULES = [
  [/football|soccer|basketball|baseball|tennis|sport|olympic|athlet|golf|rugby|cricket|hockey|boxing|swim|race|championship/i, 'Sport'],
  [/environment|climate|pollution|recycl|energy|solar|wind power|conservation|forest|wildlife|species|extinct|ecolog/i, 'Environment'],
  [/computer|internet|software|technolog|phone|apple inc|microsoft|google|engineer|robot|electronic|radio|television|film|movie|music|album|band|song|artist|actor|actress|game|video/i, 'Communications and Technology'],
  [/school|university|college|education|student|teacher|library|book|literature|novel|poet|writer|academy|degree/i, 'Education'],
  [/health|medic|disease|hospital|doctor|nurse|surgery|drug|vaccine|virus|exercise|sleep|diet|food|nutrition/i, 'Health, Medicine and Exercise'],
  [/food|drink|restaurant|cook|chef|cuisine|wine|beer|coffee|tea|bread|cheese|meat|fruit|vegetable|chocolate/i, 'Food and Drink'],
  [/travel|transport|railway|railroad|train|airport|airline|aircraft|flight|ship|boat|car|automobile|bus|metro|subway|bridge|tunnel|port/i, 'Travel and Transport'],
  [/city|town|village|street|building|architecture|church|cathedral|castle|museum|park|london|paris|new york|tokyo|capital|urban/i, 'Places: Town and City'],
  [/war|army|navy|battle|military|soldier|weapon|empire|king|queen|president|election|government|politic|law|court|history/i, 'Places: Town and City'],
  [/animal|bird|fish|insect|mammal|reptile|dinosaur|plant|tree|flower|ocean|sea|river|mountain|desert|island|earth|planet|space|star|moon/i, 'The Natural World'],
  [/weather|climate|rain|snow|storm|hurricane|temperature|wind/i, 'Weather'],
  [/company|business|econom|industry|worker|job|bank|market|money|trade|factory|manufactur|product|sell|shop|store/i, 'Work and Jobs'],
  [/time|century|decade|calendar|clock|history|ancient|medieval|modern/i, 'Time'],
];
function topicOf(title, text) {
  const s = `${title} ${text}`.slice(0, 400);
  for (const [re, topic] of TOPIC_RULES) if (re.test(s)) return topic;
  return '';
}

// ───────────── 句子/答案工具 ─────────────
const wordCount = s => (String(s).match(/[A-Za-z]+/g) || []).length;

function sentenceWith(context, answer) {
  const idx = context.indexOf(answer);
  if (idx < 0) return '';
  const before = context.slice(0, idx);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('? '), before.lastIndexOf('! ')) + 2;
  const rest = context.slice(idx);
  const m = /[.!?]/.exec(rest);
  const end = m ? idx + m.index + 1 : context.length;
  return context.slice(start, end).trim();
}

function articleEntities(context) {
  const out = new Set();
  // 数字/日期
  for (const m of context.matchAll(/\b(\d{1,4}(?:[.,]\d+)?(?:\.\d+)?(?:%| ?(?:km|kg|m|cm|mm|°C|°F|mi|ft|years?|people|million|billion))?)\b/g)) out.add(String(m[1]).trim());
  // 连续大写词（人名/地名/组织）
  for (const m of context.matchAll(/\b([A-Z][a-zA-Z'-]+(?: [A-Z][a-zA-Z'-]+){1,3})\b/g)) out.add(String(m[1]).trim());
  for (const m of context.matchAll(/\b([A-Z][a-zA-Z'-]{3,})\b/g)) out.add(String(m[1]).trim());
  return [...out];
}

function answerShape(a) {
  if (/^[\d.,%$€£-]+$/.test(a)) return 'number';
  if (/^(January|February|March|April|May|June|July|August|September|October|November|December|\d{4})$/.test(a)) return 'date';
  return 'text';
}

// ───────────── 主流程 ─────────────
function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`找不到 SQuAD 数据：${SRC}\n下载：curl -L -o /tmp/squad-dev.json https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v1.1.json`);
    process.exit(1);
  }
  const squad = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const pet = loadPetWords();
  const known = loadKnownVocab(pet);
  const rand = mulberry32(20261031);

  // 全库答案池，用于抽样干扰项
  const answerPool = [];
  for (const article of squad.data) {
    for (const para of article.paragraphs) {
      for (const qa of para.qas) {
        for (const ans of qa.answers) {
          const a = ans.text.trim();
          if (a && a.length <= 40 && wordCount(a) <= 5) answerPool.push(a);
        }
      }
    }
  }

  const rows = [];
  const passages = [];
  let scanned = 0;
  let skippedCoverage = 0;

  for (const article of squad.data) {
    const title = String(article.title || '').replace(/_/g, ' ');
    article.paragraphs.forEach((para, pi) => {
      if (passages.length >= LIMIT) return;
      scanned += 1;
      const context = String(para.context || '').replace(/\s+/g, ' ').trim();
      if (context.length < 320 || context.length > 1400) return;
      const sentences = context.split(/(?<=[.!?])\s+/).length;
      if (sentences < 3 || sentences > 14) return;
      if (unknownRatio(context, known) > (1 - MIN_COVERAGE)) { skippedCoverage += 1; return; }

      const localPool = [];
      for (const qa of para.qas) for (const ans of qa.answers) {
        const a = ans.text.trim();
        if (a && a.length <= 40 && wordCount(a) <= 5) localPool.push(a);
      }
      const entities = articleEntities(context);

      const qs = [];
      const usedStems = new Set();
      for (const qa of para.qas) {
        if (qs.length >= 4) break;
        const question = String(qa.question || '').trim();
        if (!question || !/[?]$/.test(question)) continue;
        if (usedStems.has(question)) continue;
        const answer = String(qa.answers[0]?.text || '').trim();
        if (!answer || answer.length > 40 || wordCount(answer) > 5) continue;
        if (!context.includes(answer)) continue;

        const shape = answerShape(answer);
        const shapeOk = c => {
          if (c === answer) return false;
          if (c.length < 3) return false;
          if (answer.includes(c) || c.includes(answer)) return false;
          if (answerShape(c) !== shape) return false;
          const ratio = c.length / Math.max(1, answer.length);
          return ratio >= 0.5 && ratio <= 2.2;
        };
        const shuffle = arr => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
          return a;
        };
        // 干扰项：先同段标注答案，再同段实体/数字，最后全库同形状答案
        const picked = [];
        for (const pool of [shuffle(localPool), shuffle(entities), shuffle(answerPool)]) {
          for (const c of shuffle(pool)) {
            if (picked.length >= 3) break;
            if (!shapeOk(c) || picked.includes(c)) continue;
            picked.push(c);
          }
          if (picked.length >= 3) break;
        }
        if (picked.length < 3) continue;
        if (!picked.some(c => localPool.includes(c) || entities.includes(c))) continue;   // 至少一个同段干扰项
        const options = [answer, ...picked];
        // 随机打乱选项（Fisher-Yates）
        for (let i = options.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [options[i], options[j]] = [options[j], options[i]];
        }
        const answerIndex = options.indexOf(answer);
        const src = sentenceWith(context, answer);
        qs.push({
          stem: question,
          options,
          answerIndex,
          explain: src ? `原文出处：${src}` : '答案见原文。',
        });
        usedStems.add(question);
      }
      if (!qs.length) return;

      const passageTitle = `${title} (${pi + 1})`.slice(0, 80);
      passages.push({ title: passageTitle, context, topic: topicOf(title, context), questions: qs });
      qs.forEach((q, i) => {
        rows.push([passageTitle, i === 0 ? context : '', 'PET', topicOf(title, context), '自动生成;SQuAD', `SQuAD 1.1（Wikipedia，CC BY-SA 4.0）· ${title}`, i + 1,
          q.stem, q.options[0], q.options[1], q.options[2], q.options[3], 'ABCD'[q.answerIndex] || 'A', q.explain, '']);
      });
    });
    if (passages.length >= LIMIT) break;
  }

  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['标题', '正文', '等级', '主题', '标签', '来源', '题号', '题干', '选项A', '选项B', '选项C', '选项D', '正确答案', '解析', '备注'];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, [head.map(cell).join(','), ...rows.map(r => r.map(cell).join(','))].join('\n') + '\n', 'utf8');

  const qTotal = passages.reduce((n, p) => n + p.questions.length, 0);
  const byTopic = {};
  for (const p of passages) byTopic[p.topic || '（未分类）'] = (byTopic[p.topic || '（未分类）'] || 0) + 1;
  console.log(`扫描段落 ${scanned}，词汇过滤掉 ${skippedCoverage}，生成 ${passages.length} 篇 / ${qTotal} 题`);
  console.log(`输出：${path.relative(ROOT, OUT)}`);
  console.log('主题分布：', byTopic);
  if (passages.length < LIMIT) console.log(`提示：只生成了 ${passages.length} 篇（目标 ${LIMIT}），可放宽 --min-coverage 0.75 或换更大的 SQuAD 训练集`);
}

// 固定种子的伪随机数，保证每次生成结果稳定
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main();
