/**
 * 听写练习：逐词判分单测 + 接口流程（临时库，不联网）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildApp } from '../server/app.js';
import { words, diffWords } from '../server/services/dictation.js';

// ── 纯函数 ──
test('words：小写、去标点、合并空白，保留词内撇号', () => {
  assert.deepEqual(words('  She has a NICE camera.  '), ['she', 'has', 'a', 'nice', 'camera']);
  assert.deepEqual(words("I can't swim!"), ['i', "can't", 'swim']);
  assert.deepEqual(words(''), []);
});

test('diffWords：全对 / 大小写标点无关', () => {
  const r = diffWords('She has a nice camera.', 'she has a nice camera');
  assert.equal(r.correct, true);
  assert.equal(r.ops.length, 5);
  assert.ok(r.ops.every(o => o.status === 'correct'));
});

test('diffWords：漏词 / 错词 / 多词', () => {
  const missing = diffWords('She has a nice camera.', 'she has a camera');
  assert.equal(missing.correct, false);
  assert.ok(missing.ops.some(o => o.status === 'missing' && o.expected === 'nice'));

  const wrong = diffWords('He drives a car.', 'he drive a car');
  assert.ok(wrong.ops.some(o => o.status === 'wrong'));
  const w = wrong.ops.find(o => o.status === 'wrong');
  assert.equal(w.expected, 'drives');
  assert.equal(w.got, 'drive');

  const extra = diffWords('He drives a car.', 'he drives a red car');
  assert.ok(extra.ops.some(o => o.status === 'extra' && o.got === 'red'));
  assert.equal(extra.correct, false);
});

test('diffWords：空输入全部漏词', () => {
  const r = diffWords('I can swim.', '');
  assert.equal(r.correct, false);
  assert.equal(r.ops.filter(o => o.status === 'missing').length, 3);
});

// ── 接口 ──
test('接口：听写句库 → 抽题 → 首次判分 → 重试 → 记录', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dict-'));
  const app = await buildApp({ logger: false, dbFile: path.join(dir, 'd.db') });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const call = async (method, url, { payload, cookie, headers = {} } = {}) => {
    const opts = { method, url, headers: { ...headers } };
    if (cookie) opts.headers.cookie = cookie;
    if (payload !== undefined) {
      if (Buffer.isBuffer(payload)) opts.payload = payload;
      else { opts.payload = JSON.stringify(payload); opts.headers['content-type'] ||= 'application/json'; }
    }
    return app.inject(opts);
  };
  const json = res => JSON.parse(res.body);
  const cookieOf = res => {
    const c = (res.cookies || []).find(x => x.name === 'wb_session');
    return c ? `wb_session=${c.value}` : null;
  };

  let res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!' } });
  const admin = cookieOf(res);

  // 建句库
  const items = [
    { sentenceEn: 'She has a nice camera.', sentenceCn: '她有一台好看的相机。', level: 'PET', topic: 'Hobbies and Leisure',
      tokens: [{ w: 'She', pos: '代词', ipa: '/ʃi/', cn: '她' }, { w: 'has', pos: '动词', ipa: '/hæz/', cn: '有' }] },
    { sentenceEn: 'I can swim.', sentenceCn: '我会游泳。', level: 'KET', topic: 'Sport', tokens: [] },
  ];
  for (const it of items) {
    res = await call('POST', '/api/dictation/items', { cookie: admin, payload: it });
    assert.equal(res.statusCode, 200, res.body);
  }
  // 重复句子 409
  res = await call('POST', '/api/dictation/items', { cookie: admin, payload: items[0] });
  assert.equal(res.statusCode, 409);

  // 列表 / 模板 / 导出
  res = await call('GET', '/api/dictation/items?size=10', { cookie: admin });
  assert.equal(json(res).total, 2);
  res = await call('GET', '/api/dictation/template', { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.ok(res.rawPayload.length > 3000);
  res = await call('GET', '/api/dictation/export.xlsx', { cookie: admin });
  assert.equal(res.statusCode, 200);

  // 池 & 抽题（只抽 KET）
  res = await call('GET', '/api/dictation/pools', { cookie: admin });
  assert.equal(json(res).total, 2);
  assert.equal(json(res).mode, 'dictation');
  res = await call('POST', '/api/dictation/sessions', { cookie: admin, payload: { count: 1, levels: ['KET'] } });
  assert.equal(res.statusCode, 200, res.body);
  const sess = json(res);
  assert.equal(sess.total, 1);
  assert.equal(sess.questions[0].prompt, '我会游泳。');
  assert.equal(sess.questions[0].answer, undefined, '抽题不能带英文答案');
  assert.ok(sess.questions[0].audio.includes('/api/dictation/audio/'));

  // 首次答错（漏词）
  res = await call('POST', `/api/dictation/sessions/${sess.sessionId}/submit`, { cookie: admin, payload: { seq: 1, given: 'I can' } });
  assert.equal(res.statusCode, 200, res.body);
  const r1 = json(res);
  assert.equal(r1.correct, false);
  assert.equal(r1.attempts, 1);
  assert.equal(r1.firstCorrect, false);
  assert.equal(r1.reveal, null, '答错且未到 3 次时不泄露答案');
  assert.ok(r1.diff.some(o => o.status === 'missing'));

  // 第二次：错词
  res = await call('POST', `/api/dictation/sessions/${sess.sessionId}/submit`, { cookie: admin, payload: { seq: 1, given: 'I can zzz' } });
  const r2 = json(res);
  assert.equal(r2.correct, false);
  assert.equal(r2.attempts, 2);
  assert.ok(r2.diff.some(o => o.status === 'wrong' && o.got === 'zzz'));
  assert.ok(r2.diff.find(o => o.status === 'wrong').expected === 'swim');

  // 第三次：正确，解锁 reveal；但首次已错 → 统计仍算错
  res = await call('POST', `/api/dictation/sessions/${sess.sessionId}/submit`, { cookie: admin, payload: { seq: 1, given: 'I can swim.' } });
  const r3 = json(res);
  assert.equal(r3.correct, true);
  assert.equal(r3.attempts, 3);
  assert.equal(r3.firstCorrect, false);
  assert.ok(r3.reveal && r3.reveal.sentence === 'I can swim.');

  // 交卷：correct 按首次判分
  res = await call('POST', `/api/dictation/sessions/${sess.sessionId}/finish`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).correct, 0);
  assert.equal(json(res).total, 1);

  // 记录详情
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: admin });
  const detail = json(res);
  assert.equal(detail.session.mode, 'dictation');
  assert.equal(detail.items[0].sentence, 'I can swim.');
  assert.equal(detail.items[0].attempts, 3);
  assert.equal(detail.items[0].firstCorrect, 0);
  assert.ok(Array.isArray(detail.items[0].diff));

  // 分题型统计含 dictation
  res = await call('GET', '/api/stats/by-type', { cookie: admin });
  const dict = json(res).items.find(x => x.type === 'dictation');
  assert.ok(dict, 'by-type 应包含听写');
  assert.equal(dict.label, '听写');
  assert.equal(dict.items, 1);
  assert.equal(dict.accuracy, 0);

  // 权限
  res = await call('POST', '/api/users', { cookie: admin, payload: { username: 'stu', password: 'Student123!', role: 'student' } });
  res = await call('POST', '/api/auth/login', { payload: { username: 'stu', password: 'Student123!' } });
  const stu = cookieOf(res);
  res = await call('GET', '/api/dictation/items', { cookie: stu });
  assert.equal(res.statusCode, 403);
  res = await call('GET', '/api/dictation/pools', { cookie: stu });
  assert.equal(res.statusCode, 200);
  res = await call('POST', '/api/dictation/sessions', { cookie: stu, payload: { count: 1 } });
  assert.equal(res.statusCode, 200);

  // 音频端点（espeak-ng 合成，可能较慢，允许 200）
  const itemId = (await call('GET', '/api/dictation/items?size=1', { cookie: admin })).json?.items?.[0]?.id
    ?? JSON.parse((await call('GET', '/api/dictation/items?size=1', { cookie: admin })).body).items[0].id;
  res = await call('GET', `/api/dictation/audio/${itemId}`, { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /audio\/wav/);
  assert.ok(res.rawPayload.length > 1000);
});
