/**
 * 阅读理解 + 错题集 + 分题型统计：服务层与接口测试（临时数据库，不联网）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildApp } from '../server/app.js';
import { openDb, migrate } from '../server/db/index.js';
import { parseAnswerIndex } from '../server/services/readingbank.js';
import { recordAttempt, listMistakes, mistakeSummary, removeMistakes } from '../server/services/mistakes.js';

function readingCsv() {
  const rows = [
    ['标题', '正文', '等级', '主题', '标签', '来源', '题号', '题干', '选项A', '选项B', '选项C', '选项D', '正确答案', '解析', '备注'],
    ['A Day at the Beach', 'Last Saturday Anna and her family went to the beach. They swam in the sea and ate sandwiches. In the afternoon it started to rain, so they went home early. Anna was sad, but her mother said they would come again next month.', 'PET', 'Travel and Transport', '故事', '测试来源', '1', 'Where did Anna go last Saturday?', 'To the beach', 'To the mountains', 'To school', 'To the cinema', 'A', '第一句直接说明去海滩。', ''],
    ['A Day at the Beach', '', 'PET', 'Travel and Transport', '故事', '', '2', 'What did they eat?', 'Sandwiches', 'Pizza', 'Apples', 'Ice cream', 'A', '原文 ate sandwiches。', ''],
    ['A Day at the Beach', '', 'PET', 'Travel and Transport', '故事', '', '3', 'Why did they go home early?', 'It started to rain', 'It was too hot', 'They were tired', 'They forgot something', 'A', '原文 it started to rain。', ''],
    ['A New Bike', 'Tom got a new bike for his birthday. It is blue and has a small bell. Every morning he rides it to school with his sister. He says riding is faster than walking and it is also good exercise.', 'PET', 'Sport', '故事', '测试来源', '1', 'What colour is Tom\'s bike?', 'Blue', 'Red', 'Green', 'Black', 'A', '原文 It is blue。', ''],
    ['A New Bike', '', 'PET', 'Sport', '故事', '', '2', 'How does Tom go to school now?', 'By bus', 'By bike', 'On foot', 'By car', 'B', '原文 rides it to school。', ''],
  ];
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  return Buffer.from(rows.map(r => r.map(cell).join(',')).join('\n') + '\n', 'utf8');
}

test('parseAnswerIndex：字母/数字/选项原文都要支持', () => {
  assert.equal(parseAnswerIndex('A'), 0);
  assert.equal(parseAnswerIndex('d'), 3);
  assert.equal(parseAnswerIndex('2'), 1);
  assert.equal(parseAnswerIndex('Blue', ['Blue', 'Red']), 0);
  assert.equal(parseAnswerIndex('', []), -1);
  assert.equal(parseAnswerIndex('Z'), -1);
});

test('错题集服务：答错才入集、答对只累加、可人工移除', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mist-'));
  const db = openDb(path.join(dir, 'm.db'));
  migrate(db);
  try {
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO app_user(id,username,password_hash,display_name,role) VALUES(1,'u','x','U','student')`).run();
    recordAttempt(db, 1, { qtype: 'form', refId: 10, isCorrect: false, snapshot: { prompt: 'He ____ (go).', base: 'go', answer: 'went' } });
    recordAttempt(db, 1, { qtype: 'form', refId: 10, isCorrect: false });
    recordAttempt(db, 1, { qtype: 'form', refId: 10, isCorrect: true });
    // 第一次就答对的不进错题集
    recordAttempt(db, 1, { qtype: 'form', refId: 11, isCorrect: true });
    let sum = mistakeSummary(db, 1);
    assert.equal(sum.total, 1);
    assert.equal(sum.byType.find(x => x.qtype === 'form').wrongs, 2);
    assert.equal(sum.byType.find(x => x.qtype === 'form').rights, 1);

    const list = listMistakes(db, 1, {});
    assert.equal(list.total, 1);
    assert.equal(list.items[0].wrongCount, 2);
    assert.equal(list.items[0].rightCount, 1);
    assert.equal(list.items[0].snapshot.answer, 'went');

    removeMistakes(db, 1, [list.items[0].id]);
    assert.equal(listMistakes(db, 1, {}).total, 0);
    assert.equal(listMistakes(db, 1, { includeRemoved: true }).total, 1);
    // 再次答错会重新出现在错题集
    recordAttempt(db, 1, { qtype: 'form', refId: 10, isCorrect: false });
    assert.equal(listMistakes(db, 1, {}).total, 1);
    assert.equal(listMistakes(db, 1, {}).items[0].wrongCount, 3);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('接口：阅读理解导入 → 练习判分 → 错题集与分题型统计', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-read-'));
  const app = await buildApp({ logger: false, dbFile: path.join(dir, 'r.db') });
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
  const multipart = (fields, text, filename = 'reading.csv') => {
    const boundary = `----wbr${Date.now()}${Math.random().toString(16).slice(2)}`;
    const lines = [];
    for (const [k, v] of Object.entries(fields)) lines.push(`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', String(v));
    lines.push(`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, 'Content-Type: text/csv', '', text, `--${boundary}--`, '');
    return { body: Buffer.from(lines.join('\r\n'), 'utf8'), type: `multipart/form-data; boundary=${boundary}` };
  };

  let res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!' } });
  const admin = cookieOf(res);
  assert.ok(admin);

  // 导入（dry-run 后落库）
  const mp = multipart({ dryRun: '1' }, readingCsv().toString('utf8'));
  res = await call('POST', '/api/reading/import', { cookie: admin, payload: mp.body, headers: { 'content-type': mp.type } });
  assert.equal(res.statusCode, 200, res.body);
  let preview = json(res);
  assert.equal(preview.stats.validRows, 5);
  assert.equal(preview.stats.errorRows, 0);
  assert.equal(preview.rows.length, 2, '两篇文章');
  assert.equal(preview.rows[0].questions.length, 3);

  const mp2 = multipart({ dryRun: '0', onDuplicate: 'skip' }, readingCsv().toString('utf8'));
  res = await call('POST', '/api/reading/import', { cookie: admin, payload: mp2.body, headers: { 'content-type': mp2.type } });
  assert.equal(json(res).stats.inserted, 2);
  assert.equal(json(res).stats.questions, 5);

  // 重复导入 skip / overwrite
  res = await call('POST', '/api/reading/import', { cookie: admin, payload: mp2.body, headers: { 'content-type': mp2.type } });
  assert.equal(json(res).stats.skipped, 2);
  const mp3 = multipart({ dryRun: '0', onDuplicate: 'overwrite' }, readingCsv().toString('utf8'));
  res = await call('POST', '/api/reading/import', { cookie: admin, payload: mp3.body, headers: { 'content-type': mp3.type } });
  assert.equal(json(res).stats.updated, 2);

  // 列表 / 详情 / 模板 / 导出
  res = await call('GET', '/api/reading/passages?size=10', { cookie: admin });
  const list = json(res);
  assert.equal(list.total, 2);
  assert.equal(list.items[0].questionCount >= 2, true);
  const pid = list.items.find(p => p.title === 'A Day at the Beach').id;
  res = await call('GET', `/api/reading/passages/${pid}`, { cookie: admin });
  const passage = json(res);
  assert.equal(passage.questions.length, 3);
  assert.equal(passage.questions[0].options.length, 4);
  assert.equal(passage.questions[0].answerIndex, 0);
  res = await call('GET', '/api/reading/template', { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.ok(res.rawPayload.length > 4000);
  res = await call('GET', '/api/reading/export.xlsx', { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.ok(res.rawPayload.length > 3000);

  // 练习池 + 抽题（只出 A Day at the Beach 这类的全部题目）
  res = await call('GET', '/api/reading/pools', { cookie: admin });
  const pools = json(res);
  assert.equal(pools.passages, 2);
  assert.equal(pools.questions, 5);

  res = await call('POST', '/api/reading/sessions', { cookie: admin, payload: { passages: 1 } });
  assert.equal(res.statusCode, 200, res.body);
  const sess = json(res);
  assert.equal(sess.mode, 'reading');
  assert.equal(sess.passages.length, 1);
  assert.equal(sess.total, sess.passages[0].questions.length);
  for (const q of sess.passages[0].questions) {
    assert.equal(q.options.length, 4);
    assert.equal(q.answerIndex, undefined, '抽题不能带答案');
  }

  // 答错两题（记录错题），再答对若干题
  const qs = sess.passages[0].questions;
  for (const q of qs.slice(0, 2)) {
    res = await call('POST', `/api/reading/sessions/${sess.sessionId}/answer`, {
      cookie: admin, payload: { seq: q.seq, choice: 3, latencyMs: 800 },
    });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(json(res).isCorrect, false);
    assert.ok(json(res).answerText);
  }
  // 剩余题目随便作答（对错都行，不影响错题数）
  for (const q of qs.slice(2)) {
    const r = await call('POST', `/api/reading/sessions/${sess.sessionId}/answer`, { cookie: admin, payload: { seq: q.seq, choice: 0 } });
    assert.equal(r.statusCode, 200, r.body);
  }

  res = await call('POST', `/api/reading/sessions/${sess.sessionId}/finish`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).total, sess.total);

  // 记录详情：reading 分支
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: admin });
  const detail = json(res);
  assert.equal(detail.session.mode, 'reading');
  assert.ok(detail.items[0].options.length === 4);
  assert.equal(typeof detail.items[0].chosenIndex, 'number');

  // 错题集：阅读错题入库
  res = await call('GET', '/api/mistakes?type=reading', { cookie: admin });
  const mistakes = json(res);
  assert.equal(mistakes.total, 2);
  assert.equal(mistakes.items[0].qtype, 'reading');
  assert.ok(mistakes.items[0].snapshot.passageTitle);
  assert.ok(mistakes.items[0].wrongCount >= 1);

  // 人工移出错题集
  const ids = mistakes.items.map(m => m.id);
  res = await call('POST', '/api/mistakes/remove', { cookie: admin, payload: { ids } });
  assert.equal(json(res).removed, ids.length);
  res = await call('GET', '/api/mistakes?type=reading', { cookie: admin });
  assert.equal(json(res).total, 0);
  res = await call('GET', '/api/mistakes?type=reading&removed=1', { cookie: admin });
  assert.equal(json(res).total, ids.length);
  // 恢复
  res = await call('POST', '/api/mistakes/restore', { cookie: admin, payload: { ids } });
  assert.equal(json(res).restored, ids.length);
  res = await call('GET', '/api/mistakes?type=reading', { cookie: admin });
  assert.equal(json(res).total, ids.length);

  // 分题型统计
  res = await call('GET', '/api/stats/by-type', { cookie: admin });
  const byType = json(res);
  const reading = byType.items.find(x => x.type === 'reading');
  assert.equal(reading.items, sess.total);
  assert.equal(reading.sessions, 1);
  assert.ok(reading.accuracy >= 0 && reading.accuracy <= 100);
  assert.equal(byType.items.length, 3);

  // 学生权限：不能维护题库，但能练习和看自己的错题集
  res = await call('POST', '/api/users', { cookie: admin, payload: { username: 'stu', password: 'Student123!', role: 'student' } });
  res = await call('POST', '/api/auth/login', { payload: { username: 'stu', password: 'Student123!' } });
  const student = cookieOf(res);
  res = await call('GET', '/api/reading/passages', { cookie: student });
  assert.equal(res.statusCode, 403);
  res = await call('POST', '/api/reading/import', { cookie: student, payload: mp2.body, headers: { 'content-type': mp2.type } });
  assert.equal(res.statusCode, 403);
  res = await call('GET', '/api/reading/pools', { cookie: student });
  assert.equal(res.statusCode, 200);
  res = await call('POST', '/api/reading/sessions', { cookie: student, payload: { passages: 1 } });
  assert.equal(res.statusCode, 200);
  res = await call('GET', '/api/mistakes', { cookie: student });
  assert.equal(json(res).total, 0);
  res = await call('POST', '/api/mistakes/remove', { cookie: student, payload: { ids: [1] } });
  assert.equal(json(res).removed, 0, '不能移除他人的错题');

  // 学生不能看别人的阅读练习
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: student });
  assert.equal(res.statusCode, 403);
});

test('变形填空答错也会进入错题集（qtype=form）', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mix-'));
  const app = await buildApp({ logger: false, dbFile: path.join(dir, 'm.db') });
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = async (method, url, { payload, cookie } = {}) => {
    const opts = { method, url, headers: {} };
    if (cookie) opts.headers.cookie = cookie;
    if (payload !== undefined) { opts.payload = JSON.stringify(payload); opts.headers['content-type'] = 'application/json'; }
    return app.inject(opts);
  };
  const cookieOf = res => (res.cookies || []).find(x => x.name === 'wb_session');
  let res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!' } });
  const c = cookieOf(res);
  const cookie = `wb_session=${c.value}`;
  res = await call('POST', '/api/form/items', { cookie, payload: { prompt: 'He ____ to school every day.', base: 'go', answer: 'goes', point: '主谓一致', level: 'PET' } });
  const itemId = JSON.parse(res.body).id;
  res = await call('POST', '/api/form/sessions', { cookie, payload: { count: 1 } });
  const sess = JSON.parse(res.body);
  res = await call('POST', `/api/form/sessions/${sess.sessionId}/answer`, { cookie, payload: { seq: sess.questions[0].seq, given: 'go' } });
  assert.equal(JSON.parse(res.body).isCorrect, false);
  res = await call('GET', '/api/mistakes?type=form', { cookie });
  const m = JSON.parse(res.body);
  assert.equal(m.total, 1);
  assert.equal(m.items[0].refId, itemId);
  assert.equal(m.items[0].snapshot.base, 'go');
});
