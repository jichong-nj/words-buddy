/**
 * 变形填空：纯函数单测 + 服务/接口集成测试（临时数据库，不占端口、不联网）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../server/app.js';
import { openDb } from '../server/db/index.js';
import {
  normalizeAnswer, normalizePrompt, splitAlternatives,
  importFormItems, createItem, listItems, formStats, updateItem, deleteItem,
} from '../server/services/formbank.js';
import { gradeAnswer } from '../server/services/formpractice.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────── 纯函数 ─────────────────────────────

test('normalizeAnswer：忽略大小写、多余空格、句末标点与引号差异', () => {
  assert.equal(normalizeAnswer('  Arrived  At. '), 'arrived at');
  assert.equal(normalizeAnswer('hasn’t finished'), "hasn't finished");
  assert.equal(normalizeAnswer('“Most Interesting”'), '"most interesting"');
  assert.equal(normalizeAnswer(''), '');
  assert.equal(normalizeAnswer(null), '');
});

test('normalizePrompt：各种空位写法统一成 ____，并去掉括号里的原型提示', () => {
  assert.equal(normalizePrompt('I ___(arrive) school.'), 'I ____ school.');
  assert.equal(normalizePrompt('I ____ (arrive) school.'), 'I ____ school.');
  assert.equal(normalizePrompt('I （ arrive ） school yesterday.', 'arrive'), 'I school yesterday.');
  assert.equal(normalizePrompt('She ____ to London.', 'go'), 'She ____ to London.');
  assert.equal(normalizePrompt('He ____ (teach) us maths.'), 'He ____ us maths.');
  assert.ok(normalizePrompt('It is {blank} today.').includes('____'));
  assert.ok(normalizePrompt('The box is ( ).').includes('____'));
});

test('splitAlternatives：支持 | / 分隔，去重并归一化', () => {
  assert.deepEqual(splitAlternatives('arrived at|arrived'), ['arrived at', 'arrived']);
  assert.deepEqual(splitAlternatives('hasn\'t finished', 'has not finished'), ["hasn't finished", 'has not finished']);
  assert.deepEqual(splitAlternatives('  Went | went '), ['went']);
  assert.deepEqual(splitAlternatives('', null), []);
});

test('gradeAnswer：按 accepted 列表判分，忽略大小写与首尾空格', () => {
  assert.equal(gradeAnswer('Arrived At', ['arrived at', 'arrived']).isCorrect, true);
  assert.equal(gradeAnswer('  arrived   at  ', ['arrived at']).isCorrect, true);
  assert.equal(gradeAnswer('arrived', ['arrived at']).isCorrect, false);
  assert.equal(gradeAnswer('', ['arrived at']).isCorrect, false);
  assert.equal(gradeAnswer('WENT', ['went']).isCorrect, true);
});

// ───────────────────────────── 服务层 ─────────────────────────────

async function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-form-'));
  const dbFile = path.join(dir, 'form.db');
  const app = await buildApp({ logger: false, dbFile });
  return { dir, dbFile, app };
}

function formCsv(rows) {
  const head = '"句子","原型","答案","可接受答案","考点","等级","主题","句子翻译","词义","解析"';
  return Buffer.from([head, ...rows].join('\n') + '\n', 'utf8');
}

test('导入：缺空位/空原型/文件内重复 要报错或警告', async t => {
  const { dir, app } = await tempDb();
  const db = app.db;
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const buf = formCsv([
    '"I ____ school yesterday.","arrive","arrived at","arrived","时态","PET","",""',
    '"I go school yesterday.","go","went","","时态","PET","",""',
    '"He ____ a teacher.","","is","","时态","PET","",""',
    '"She ____ to London.","go","went","","时态","KET","",""',
    '"She ____ to London.","go","went","","时态","KET","",""',
  ]);
  const preview = await importFormItems(db, { buffer: buf, filename: 'x.csv', dryRun: true });
  assert.equal(preview.stats.totalRows, 5);
  assert.equal(preview.stats.validRows, 2);
  assert.equal(preview.stats.errorRows, 2);
  assert.ok(preview.stats.warnRows >= 1, '文件内重复应报警告');
  const codes = preview.errors.map(e => e.code);
  assert.ok(codes.includes('no_blank'));
  assert.ok(codes.includes('empty_base'));
  assert.ok(codes.includes('dup_in_file'));

  // 落库后再导入：skip 策略全部跳过
  const written = await importFormItems(db, { buffer: buf, filename: 'x.csv', onDuplicate: 'skip' });
  assert.equal(written.stats.inserted, 2);
  const again = await importFormItems(db, { buffer: buf, filename: 'x.csv', onDuplicate: 'skip' });
  assert.equal(again.stats.inserted, 0);
  assert.equal(again.stats.skipped, 2);
  // overwrite 策略：更新而不是新增
  const over = await importFormItems(db, { buffer: buf, filename: 'x.csv', onDuplicate: 'overwrite' });
  assert.equal(over.stats.updated, 2);
  await app.close();
});

test('服务层：CRUD 与去重约束', async t => {
  const { dir, app } = await tempDb();
  const db = app.db;
  t.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const item = createItem(db, {
    prompt: 'I ____ (arrive) school at eight yesterday.', base: 'arrive',
    answer: 'arrived at|arrived', point: '时态', level: 'pet', topic: 'Education',
    tags: '一般过去时, arrive at', explain: 'yesterday 表示过去。',
    sentenceCn: '我昨天八点到了学校。', wordCn: '到达；抵达',
  });
  assert.equal(item.sentenceCn, '我昨天八点到了学校。');
  assert.equal(item.wordCn, '到达；抵达');
  assert.equal(item.prompt, 'I ____ school at eight yesterday.');
  assert.deepEqual(item.accepted, ['arrived at', 'arrived']);
  assert.equal(item.level, 'PET');
  assert.equal(item.tags, '一般过去时,arrive at');
  assert.equal(item.needsReview, false);

  assert.throws(() => createItem(db, { prompt: item.prompt, base: 'arrive', answer: 'arrived' }), /已存在/);
  assert.throws(() => createItem(db, { prompt: '没有空位的句子', base: 'x', answer: 'y' }), /____/);

  const updated = updateItem(db, item.id, { point: '词形变化', needsReview: true });
  assert.equal(updated.point, '词形变化');
  assert.equal(updated.needsReview, true);
  assert.equal(updated.answer, 'arrived at');

  const listed = listItems(db, { q: 'arrive' });
  assert.equal(listed.total, 1);
  const stats = formStats(db);
  assert.equal(stats.total, 1);
  assert.deepEqual(stats.byPoint, [{ point: '词形变化', count: 1 }]);

  deleteItem(db, item.id);
  assert.equal(listItems(db).total, 0);
  assert.throws(() => deleteItem(db, item.id), /不存在/);
});

// ───────────────────────────── 接口 ─────────────────────────────

test('接口：变形填空练习全流程 + 权限 + 记录/明细', async t => {
  const { dir, app: instance } = await tempDb();
  t.after(async () => { await instance.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  const call = async (method, url, { payload, cookie, headers = {} } = {}) => {
    const opts = { method, url, headers: { ...headers } };
    if (cookie) opts.headers.cookie = cookie;
    if (payload !== undefined) {
      if (Buffer.isBuffer(payload)) opts.payload = payload;
      else {
        opts.payload = JSON.stringify(payload);
        opts.headers['content-type'] ||= 'application/json';
      }
    }
    return instance.inject(opts);
  };
  const json = res => JSON.parse(res.body);
  const cookieOf = res => {
    const c = (res.cookies || []).find(x => x.name === 'wb_session');
    return c ? `wb_session=${c.value}` : null;
  };
  const multipart = (fields, text, filename = 'form.csv') => {
    const boundary = `----wbtf${Date.now()}${Math.random().toString(16).slice(2)}`;
    const lines = [];
    for (const [k, v] of Object.entries(fields)) {
      lines.push(`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', String(v));
    }
    lines.push(`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, 'Content-Type: text/csv', '', text, `--${boundary}--`, '');
    return { body: Buffer.from(lines.join('\r\n'), 'utf8'), type: `multipart/form-data; boundary=${boundary}` };
  };

  // 初始化管理员
  let res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!' } });
  const admin = cookieOf(res);
  assert.ok(admin);

  // 导入题库
  const mp = multipart({ dryRun: '0', onDuplicate: 'skip' }, formCsv([
    '"I ____ school at eight yesterday.","arrive","arrived at","arrived","时态","PET","Education","我昨天八点到了学校。","到达；抵达","yesterday 表示过去。"',
    '"She ____ to London last summer.","go","went","","时态","KET","Travel and Transport","去年夏天她去了伦敦。","去；走",""',
    '"He is good ____ playing the piano.","at","at","","介词","PET","Hobbies and Leisure","他擅长弹钢琴。","在（某事）方面","be good at doing sth."',
    '"There are three ____ in the family.","child","children","","复数","KET","House and Home","这个家庭里有三个孩子。","儿童；孩子","child 的复数是 children。"',
  ]).toString('utf8'));
  res = await call('POST', '/api/form/import', {
    cookie: admin, payload: mp.body, headers: { 'content-type': mp.type },
  });
  assert.equal(res.statusCode, 200, res.body);
  const imported = json(res);
  assert.equal(imported.stats.inserted, 4);

  // 预览接口只读
  const mp2 = multipart({ dryRun: '1' }, formCsv([
    '"It ____ raining now.","rain","is raining","","时态","KET","Weather",""',
  ]).toString('utf8'));
  res = await call('POST', '/api/form/import', { cookie: admin, payload: mp2.body, headers: { 'content-type': mp2.type } });
  assert.equal(json(res).stats.inserted, 0);
  assert.equal(json(res).stats.validRows, 1);

  // 题库列表 / 统计 / 模板
  res = await call('GET', '/api/form/items?size=2', { cookie: admin });
  assert.equal(json(res).total, 4);
  assert.equal(json(res).items.length, 2);
  res = await call('GET', '/api/form/stats', { cookie: admin });
  assert.equal(json(res).total, 4);
  res = await call('GET', '/api/form/template', { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok(res.rawPayload.length > 4000);

  // 练习池
  res = await call('GET', '/api/form/pools', { cookie: admin });
  const pools = json(res);
  assert.equal(pools.total, 4);
  assert.ok(pools.byPoint.some(p => p.point === '时态'));

  // 抽题（只抽时态）
  res = await call('POST', '/api/form/sessions', { cookie: admin, payload: { count: 5, points: ['时态'] } });
  assert.equal(res.statusCode, 200, res.body);
  const sess = json(res);
  assert.equal(sess.mode, 'form_fill');
  assert.equal(sess.total, 2);
  for (const q of sess.questions) {
    assert.ok(q.prompt.includes('____'));
    assert.ok(q.base);
    assert.equal(q.answer, undefined, '抽题响应不能带答案');
  }
  const qArrive = sess.questions.find(q => q.base === 'arrive');
  const qGo = sess.questions.find(q => q.base === 'go');
  assert.ok(qArrive && qGo, '应抽到 arrive 与 go 两题');

  // 答对 arrive 题（大小写/空格/句末标点都应判对）
  res = await call('POST', `/api/form/sessions/${sess.sessionId}/answer`, {
    cookie: admin, payload: { seq: qArrive.seq, given: '  Arrived At. ', latencyMs: 1200 },
  });
  assert.equal(res.statusCode, 200);
  const a1 = json(res);
  assert.equal(a1.isCorrect, true);
  assert.equal(a1.answer, 'arrived at');
  assert.ok(a1.explain.includes('yesterday'));
  assert.equal(a1.filled, 'I arrived at school at eight yesterday.');
  assert.equal(a1.sentenceCn, '我昨天八点到了学校。');
  assert.equal(a1.wordCn, '到达；抵达');
  assert.equal(a1.point, '时态');

  // 答错 go 题
  res = await call('POST', `/api/form/sessions/${sess.sessionId}/answer`, {
    cookie: admin, payload: { seq: qGo.seq, given: 'go', latencyMs: 700 },
  });
  assert.equal(json(res).isCorrect, false);

  // 重复作答冲突
  res = await call('POST', `/api/form/sessions/${sess.sessionId}/answer`, { cookie: admin, payload: { seq: qArrive.seq, given: 'arrived at' } });
  assert.equal(res.statusCode, 409);

  // 交卷
  res = await call('POST', `/api/form/sessions/${sess.sessionId}/finish`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).correct, 1);
  assert.equal(json(res).total, 2);

  // 记录列表与明细（mode=form_fill）
  res = await call('GET', '/api/practice/sessions', { cookie: admin });
  const rec = json(res).items.find(s => s.id === sess.sessionId);
  assert.equal(rec.mode, 'form_fill');
  assert.equal(rec.bankName, null);

  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: admin });
  const detail = json(res);
  assert.equal(detail.session.mode, 'form_fill');
  assert.equal(detail.items.length, 2);
  const arriveItem = detail.items.find(i => i.base === 'arrive');
  assert.equal(arriveItem.prompt, 'I ____ school at eight yesterday.');
  assert.equal(arriveItem.isCorrect, 1);
  assert.equal(arriveItem.answer, 'arrived at');
  assert.deepEqual(arriveItem.accepted, ['arrived at', 'arrived']);

  // 学生权限：不能维护题库，但可以练习
  res = await call('POST', '/api/users', { cookie: admin, payload: { username: 'stu', password: 'Student123!', role: 'student' } });
  assert.equal(res.statusCode, 200);
  res = await call('POST', '/api/auth/login', { payload: { username: 'stu', password: 'Student123!' } });
  const student = cookieOf(res);

  res = await call('GET', '/api/form/items', { cookie: student });
  assert.equal(res.statusCode, 403);
  res = await call('POST', '/api/form/import', { cookie: student, payload: mp2.body, headers: { 'content-type': mp2.type } });
  assert.equal(res.statusCode, 403);
  res = await call('GET', '/api/form/pools', { cookie: student });
  assert.equal(res.statusCode, 200);
  res = await call('POST', '/api/form/sessions', { cookie: student, payload: { count: 3 } });
  assert.equal(res.statusCode, 200);
  const stuSess = json(res);

  // 学生不能看别人的变形练习
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: student });
  assert.equal(res.statusCode, 403);

  // 答案只保存在服务端：学生自己的会话明细在作答后才出现答案
  res = await call('GET', `/api/practice/sessions/${stuSess.sessionId}`, { cookie: student });
  assert.equal(json(res).items.every(i => i.given === null), true);
});

test('内置变形题库文件格式正确（seed/form-items.csv 可被解析）', async () => {
  const csv = fs.readFileSync(path.join(ROOT, 'server', 'seed', 'form-items.csv'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-formseed-'));
  try {
    const db = openDb(path.join(dir, 'seed.db'));
    const { migrate } = await import('../server/db/index.js');
    migrate(db);
    const out = await importFormItems(db, { buffer: csv, filename: 'form-items.csv', dryRun: true });
    assert.equal(out.stats.errorRows, 0, JSON.stringify(out.errors.slice(0, 5)));
    assert.ok(out.stats.validRows >= 60, `内置题量应 >= 60，实际 ${out.stats.validRows}`);
    const points = new Set(out.rows.map(r => r.point));
    for (const p of ['时态', '语态', '词性', '介词', '非谓语', '比较级', '复数']) assert.ok(points.has(p), `缺少考点 ${p}`);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
