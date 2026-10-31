/**
 * 纯函数单元测试：不连数据库、不启服务。
 * 运行：npm test（等价于 node --test test/）
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { splitSegments, stripPosPrefix, parseSenses, normWord, splitTags, joinTags, lengthOk } from '../server/lib/parse.js';
import { inflections, buildStem, buildHint } from '../server/services/practice.js';
import { bandOf, BANDS } from '../server/services/mastery.js';
import { lookup, lookupSmart, stemCandidates, hasWord, POS_LABEL } from '../server/lib/wordnet.js';
import { topicsForLevel, hasTaxonomy, POS_SET } from '../shared/topic-taxonomy.js';

// ───────────────────────────── parse.js ─────────────────────────────

test('splitSegments 支持换行、全角分号、竖线，但不切半角分号', () => {
  assert.deepEqual(splitSegments('苹果\n苹果树'), ['苹果', '苹果树']);
  assert.deepEqual(splitSegments('苹果；苹果树'), ['苹果', '苹果树']);
  assert.deepEqual(splitSegments('a | b｜c'), ['a', 'b', 'c']);
  // 英文释义里的半角分号不能当分隔符
  assert.deepEqual(splitSegments('a fruit; it is red'), ['a fruit; it is red']);
  assert.deepEqual(splitSegments(''), []);
  assert.deepEqual(splitSegments(null), []);
});

test('stripPosPrefix 只认明确词性前缀，不猜', () => {
  assert.deepEqual(stripPosPrefix('v. 拉上'), { pos: 'v.', rest: '拉上' });
  assert.deepEqual(stripPosPrefix('n.纽扣'), { pos: 'n.', rest: '纽扣' });
  assert.deepEqual(stripPosPrefix('苹果'), { pos: null, rest: '苹果' });
});

test('parseSenses：一段中文对应一个义项，英文释义错位时挂到第一个', () => {
  const s = parseSenses({ pos: 'n.', def_cn: '苹果；苹果树', def_en: 'a round fruit' });
  assert.equal(s.length, 2);
  assert.deepEqual(s.map(x => x.def_cn), ['苹果', '苹果树']);
  assert.equal(s[0].def_en, 'a round fruit');
  assert.equal(s[1].def_en, null);      // 段数不一致时不硬对齐
});

test('parseSenses：中文/英文段数一致时按位对齐', () => {
  const s = parseSenses({
    pos: null,
    def_cn: 'n. 苹果；v. 拉上',
    def_en: 'a fruit；to close',
    example_en: 'I ate an apple.；Zip it up.',
  });
  assert.equal(s.length, 2);
  assert.equal(s[0].pos, 'n.');
  assert.equal(s[1].pos, 'v.');
  assert.equal(s[0].def_en, 'a fruit');
  assert.equal(s[1].example_en, 'Zip it up.');
});

test('parseSenses：没有释义时返回一个空义项，交给上层标记待补充', () => {
  const s = parseSenses({ pos: 'n.' });
  assert.equal(s.length, 1);
  assert.equal(s[0].def_cn, null);
});

test('标签与长度工具', () => {
  assert.equal(normWord('  Apple '), 'apple');
  assert.deepEqual(splitTags('水果,食物；考试'), ['水果', '食物', '考试']);
  assert.equal(joinTags(['a', 'a', 'b']), 'a,b');
  assert.equal(lengthOk('apple', 4, 12), true);
  assert.equal(lengthOk('elephant', 4, 6), false);
});

// ───────────────────────────── practice.js ─────────────────────────────

test('inflections 覆盖常见变形且不会产生 applees 这类错误', () => {
  const f = inflections('apple');
  assert.ok(f.includes('apple'));
  assert.ok(f.includes('apples'));
  assert.ok(!f.includes('applees'));
  assert.ok(inflections('box').includes('boxes'));
  assert.ok(inflections('study').includes('studies'));
  assert.ok(inflections('make').includes('making'));
  assert.deepEqual(inflections(''), []);
});

test('buildStem 把答案词及其变形打码，并报告是否打码', () => {
  const r = buildStem('paint', 'apply paint to; We painted the rooms yellow');
  assert.equal(r.masked, true);
  assert.ok(r.stem.includes('p_____'));
  assert.ok(r.stem.includes('p______'));
  assert.ok(!/paint/i.test(r.stem));

  const none = buildStem('apple', 'a round fruit with red skin');
  assert.equal(none.masked, false);
  assert.equal(none.stem, 'a round fruit with red skin');
});

test('buildHint 只露首字母', () => {
  assert.equal(buildHint('apple'), 'a____');
  assert.equal(buildHint('a'), 'a_');   // 单字母也会补一个下划线，练习池最短 4 字母用不到
});

// ───────────────────────────── mastery.js ─────────────────────────────

test('bandOf 档位边界', () => {
  assert.equal(bandOf(0, 0, 0), 'new');
  assert.equal(bandOf(20, 1, -1), 'weak');
  assert.equal(bandOf(40, 2, 1), 'fuzzy');
  assert.equal(bandOf(70, 3, 1), 'known');
  assert.equal(bandOf(85, 4, 3), 'mastered');
  assert.equal(bandOf(85, 4, 2), 'known');   // 连对不足 3 次不算精通
  assert.deepEqual(BANDS.map(b => b.band), ['new', 'weak', 'fuzzy', 'known', 'mastered']);
});

// ───────────────────────────── wordnet.js ─────────────────────────────

test('WordNet 能查到常用词的释义与词性', () => {
  const apple = lookup('apple');
  assert.ok(apple.length > 0);
  assert.equal(apple[0].posLabel, 'n.');
  assert.match(apple[0].def, /fruit/i);
  assert.equal(POS_LABEL.n, 'n.');
  assert.ok(hasWord('apple'));
  assert.equal(hasWord('xyzzy'), false);
});

test('WordNet 义项按常用度排序（index.* 顺序）', () => {
  assert.equal(lookup('jacket')[0].def, 'a short coat');
  assert.match(lookup('box')[0].def, /container/);
  assert.match(lookup('train')[0].def, /railway|railroad/);
  assert.equal(lookup('xyzzy').length, 0);
  assert.deepEqual(lookup(''), []);
});

test('stemCandidates / lookupSmart 能还原屈折形式', () => {
  assert.ok(stemCandidates('children').includes('child'));
  assert.ok(stemCandidates('boxes').includes('box'));
  assert.ok(stemCandidates('running').includes('run'));
  assert.ok(stemCandidates('studies').includes('study'));

  assert.equal(lookupSmart('children').matched, 'child');
  assert.equal(lookupSmart('apples').matched, 'apple');
  assert.equal(lookupSmart('boxes').matched, 'box');
  assert.equal(lookupSmart('xyzzy').sense, null);

  // 给了词性提示时优先同词性义项
  const stopped = lookupSmart('stopped', 'v.');
  assert.equal(stopped.sense.posLabel, 'v.');
  assert.equal(stopped.matched, 'stop');
});

// ───────────────────────────── 主题表 ─────────────────────────────

test('主题分类表：KET 24 个、PET 22 个，词性枚举包含常用项', () => {
  assert.equal(topicsForLevel('KET').length, 24);
  assert.equal(topicsForLevel('PET').length, 22);
  assert.equal(hasTaxonomy('KET+PET'), true);
  assert.equal(hasTaxonomy('大学英语'), false);
  const pet = topicsForLevel('PET').map(t => t.key);
  assert.ok(pet.includes('Environment'));
  assert.ok(!pet.includes('Appliances'));   // PET 没有 KET 的部分主题
  for (const p of ['n.', 'v.', 'adj.', 'adv.']) assert.ok(POS_SET.has(p));
});
