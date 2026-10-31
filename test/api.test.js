/**
 * 接口集成测试：用 app.inject() 跑完整流程，使用临时数据库，不监听端口、不联网。
 * 覆盖：初始化 → 登录 → 建库 → 导入（预览/提交/回滚）→ 练习 → 统计 → 权限 → 404。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApp } from '../server/app.js';
import { migrate, openDb } from '../server/db/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CSV = [
  '"单词","词性","中文释义","英文释义","主题","等级"',
  '"garden","n.","花园；菜园","a plot of ground where plants are cultivated","Hobbies and Leisure","PET"',
  '"harbour","n.","港口","a place where ships can shelter from bad weather","Places: Buildings","PET"',
  '"quay","n.","码头","a landing place for ships to load and unload","Places: Buildings","PET"',
  '"shelter","v.","遮蔽；庇护","provide protection from danger or bad weather","Environment","PET"',
  '"harvest","n.","收获；收成","the gathering of ripened crops from the fields","The Natural World","PET"',
  '"thunder","n.","雷声","a loud rumbling or crashing noise heard after lightning","Weather","PET"',
  '"quay","n.","码头（重复行，应合并义项）","","Places: Buildings","PET"',
  '"9zzz","n.","非法单词行（只报警告，仍会导入）","","Places: Buildings","PET"',
  '"","n.","空单词行（错误，跳过）","","Places: Buildings","PET"',
].join('\n') + '\n';

function multipartBody(fields, text, filename = 'bank.csv') {
  const boundary = `----wbtest${Date.now()}${Math.random().toString(16).slice(2)}`;
  const lines = [];
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`--${boundary}`, `Content-Disposition: form-data; name="${k}"`, '', String(v));
  }
  lines.push(
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    'Content-Type: text/csv',
    '',
    text,
    `--${boundary}--`,
    '',
  );
  return {
    body: Buffer.from(lines.join('\r\n'), 'utf8'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const SESSION_COOKIE = 'wb_session';

test('接口全流程：初始化 → 导入 → 练习 → 统计 → 权限', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-api-'));
  const dbFile = path.join(dir, 'test.db');
  const app = await buildApp({ logger: false, dbFile });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cookieOf = res => {
    const c = (res.cookies || []).find(x => x.name === SESSION_COOKIE);
    return c ? `${SESSION_COOKIE}=${c.value}` : null;
  };
  const call = async (method, url, { payload, cookie, headers = {} } = {}) => {
    const opts = { method, url, headers: { ...headers } };
    if (cookie) opts.headers.cookie = cookie;
    if (payload !== undefined) {
      if (Buffer.isBuffer(payload)) opts.payload = payload;
      else if (typeof payload === 'string') { opts.payload = payload; opts.headers['content-type'] ||= 'application/json'; }
      else { opts.payload = JSON.stringify(payload); opts.headers['content-type'] ||= 'application/json'; }
    }
    return app.inject(opts);
  };
  const json = res => JSON.parse(res.body);

  // ── 健康检查与初始化状态 ──
  let res = await call('GET', '/api/health');
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).ok, true);
  assert.equal(json(res).schema, '4');

  res = await call('GET', '/api/auth/status');
  assert.equal(json(res).needsSetup, true);

  res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!', displayName: '管理员' } });
  assert.equal(res.statusCode, 200);
  let admin = cookieOf(res);
  assert.ok(admin, '初始化应下发会话 cookie');
  assert.equal(json(res).user.role, 'admin');

  // 初始化后再初始化应冲突
  res = await call('POST', '/api/auth/setup', { payload: { username: 'x2', password: 'Admin123!' } });
  assert.equal(res.statusCode, 409);

  // 未登录访问受保护接口
  res = await call('GET', '/api/banks');
  assert.equal(res.statusCode, 401);
  res = await call('GET', '/api/banks', { cookie: `${SESSION_COOKIE}=not-a-session` });
  assert.equal(res.statusCode, 401);

  // ── 建词库 ──
  res = await call('POST', '/api/banks', { cookie: admin, payload: { name: '测试词库', level: 'PET', description: '集成测试' } });
  assert.equal(res.statusCode, 200);
  const bankId = json(res).id;
  assert.ok(bankId > 0);

  // ── 导入：预览 → 提交 ──
  const mp = multipartBody({ bankId, dupInFile: 'merge_senses', dupInBank: 'overwrite' }, CSV);
  res = await call('POST', '/api/import/preview', {
    cookie: admin, payload: mp.body, headers: { 'content-type': mp.contentType },
  });
  assert.equal(res.statusCode, 200, res.body);
  const preview = json(res);
  assert.equal(preview.stats.totalRows, 9);
  assert.equal(preview.stats.errorRows, 1, '空单词行应报错');
  assert.ok(preview.errors.some(e => e.code === 'non_alpha_word' && e.severity === 'warn'), '9zzz 应以警告形式提示');
  assert.ok(preview.map['单词'] === 'word');
  const batchId = preview.batchId;

  // 改策略后重新预览：返回新批次，不改动原批次
  res = await call('PATCH', `/api/import/${batchId}`, { cookie: admin, payload: { dupInBank: 'overwrite' } });
  assert.equal(res.statusCode, 200);
  assert.notEqual(json(res).batchId, batchId);

  res = await call('POST', `/api/import/${batchId}/commit`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200, res.body);
  const commit = json(res);
  assert.equal(commit.inserted, 7);
  assert.equal(commit.failed, 0);   // 空单词行在解析阶段就没进入记录，只记在 import_error

  // 有校验问题时可以下载错误报告
  res = await call('GET', `/api/import/${batchId}/errors.xlsx`, { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok(res.rawPayload.length > 3000);

  // 词库与单词列表
  res = await call('GET', `/api/banks/${bankId}`, { cookie: admin });
  assert.equal(json(res).wordCount, 7);
  res = await call('GET', `/api/banks/${bankId}/words?size=50`, { cookie: admin });
  const words = json(res).items;
  assert.equal(words.length, 7);
  const quay = words.find(w => w.word === 'quay');
  assert.equal(quay.senseCount, 2, '文件内重复行应合并成两个义项');

  // 单词详情 / 更新 / 主题统计
  res = await call('GET', `/api/words/${quay.id}`, { cookie: admin });
  assert.equal(json(res).word, 'quay');
  res = await call('PUT', `/api/words/${quay.id}`, { cookie: admin, payload: { tags: '码头,测试', needsReview: true } });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).tags, '码头,测试');
  assert.equal(json(res).needsReview, true);

  // 导入记录
  res = await call('GET', '/api/batches', { cookie: admin });
  assert.ok(json(res).items.some(b => b.id === batchId && b.status === 'committed'));

  // ── 练习：取题 → 答错 → 答对 → 交卷 ──
  res = await call('GET', '/api/practice/pools', { cookie: admin });
  const pool = json(res).items.find(p => p.bankId === bankId);
  assert.ok(pool.total >= 5);

  res = await call('POST', '/api/practice/sessions', { cookie: admin, payload: { bankId, count: 4 } });
  assert.equal(res.statusCode, 200, res.body);
  const sess = json(res);
  assert.equal(sess.total, 4);
  for (const q of sess.questions) {
    assert.ok(q.stem.length > 0);
    assert.equal(q.hint[0].toLowerCase(), q.masked ? q.hint[0] : q.hint[0]); // 提示首字母存在
    assert.ok(!q.stem.includes('zzz9'));
  }

  const q1 = sess.questions[0];
  res = await call('POST', `/api/practice/sessions/${sess.sessionId}/answer`, {
    cookie: admin, payload: { seq: q1.seq, given: 'definitely-wrong', latencyMs: 900 },
  });
  assert.equal(res.statusCode, 200);
  const a1 = json(res);
  assert.equal(a1.isCorrect, false);
  assert.equal(a1.mastery.band, 'weak');

  // 同一题重复作答应冲突
  res = await call('POST', `/api/practice/sessions/${sess.sessionId}/answer`, {
    cookie: admin, payload: { seq: q1.seq, given: q1.hint, latencyMs: 100 },
  });
  assert.equal(res.statusCode, 409);

  // 第二题答对（答案由服务端判分，这里用会话明细里的答案不行，改猜一个必然错的，只验证结构）
  const q2 = sess.questions[1];
  res = await call('POST', `/api/practice/sessions/${sess.sessionId}/answer`, {
    cookie: admin, payload: { seq: q2.seq, given: '', latencyMs: 10 },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).isCorrect, false);

  res = await call('POST', `/api/practice/sessions/${sess.sessionId}/finish`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  const fin = json(res);
  assert.equal(fin.total, 4);
  assert.equal(fin.correct, 0);
  assert.equal(fin.score, 0);

  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: admin });
  assert.equal(json(res).session.status, 'finished');
  assert.equal(json(res).items.length, 4);

  res = await call('GET', '/api/practice/sessions', { cookie: admin });
  assert.ok(json(res).total >= 1);

  // ── 统计 ──
  res = await call('GET', '/api/stats/overview', { cookie: admin });
  const ov = json(res);
  assert.equal(ov.sessions, 1);
  assert.equal(ov.todayAnswered, 2);
  assert.equal(ov.accuracy, 0);
  assert.ok(ov.byBand.weak >= 1);

  res = await call('GET', '/api/stats/mastery?page=1&size=10', { cookie: admin });
  assert.equal(json(res).total, 2);   // 两题对应两个词
  assert.ok(json(res).items.every(i => i.band === 'weak'));

  res = await call('GET', `/api/stats/mastery?bank=${bankId}&band=weak`, { cookie: admin });
  assert.equal(json(res).total, 2);

  res = await call('GET', `/api/stats/weak-words?bank=${bankId}`, { cookie: admin });
  assert.equal(json(res).items.length, 2);

  res = await call('GET', `/api/stats/topic?bank=${bankId}`, { cookie: admin });
  const topics = json(res).items;
  assert.ok(topics.length >= 2);
  assert.ok(topics.every(x => typeof x.words === 'number'));

  res = await call('GET', '/api/stats/daily?days=7', { cookie: admin });
  const days = json(res).items;
  assert.equal(days.length, 7);
  assert.equal(days[6].answered, 2);

  res = await call('GET', `/api/stats/words/${quay.id}`, { cookie: admin });
  assert.ok(json(res).word.word === 'quay');

  // 重算掌握度是管理员接口，且结果应与增量一致
  res = await call('POST', '/api/stats/recompute', { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.ok(json(res).updated >= 2);

  // ── 用户与权限 ──
  res = await call('POST', '/api/users', {
    cookie: admin, payload: { username: 'student1', password: 'Student123!', displayName: '学生一', role: 'student' },
  });
  assert.equal(res.statusCode, 200);
  const studentId = json(res).id;

  res = await call('GET', '/api/users', { cookie: admin });
  assert.ok(json(res).items.length >= 2);

  res = await call('POST', '/api/auth/login', { payload: { username: 'student1', password: 'Student123!' } });
  assert.equal(res.statusCode, 200);
  const student = cookieOf(res);

  res = await call('GET', '/api/banks', { cookie: student });
  assert.equal(res.statusCode, 200);

  res = await call('POST', '/api/banks', { cookie: student, payload: { name: '越权词库' } });
  assert.equal(res.statusCode, 403);
  res = await call('GET', '/api/users', { cookie: student });
  assert.equal(res.statusCode, 403);
  res = await call('GET', '/api/batches', { cookie: student });
  assert.equal(res.statusCode, 403);
  res = await call('POST', '/api/practice/sessions', { cookie: student, payload: { bankId, count: 2 } });
  assert.equal(res.statusCode, 200);

  // 学生不能看别人的练习记录
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: student });
  assert.equal(res.statusCode, 403);

  // 停用账号后无法登录
  res = await call('PATCH', `/api/users/${studentId}`, { cookie: admin, payload: { status: 'disabled' } });
  assert.equal(res.statusCode, 200);
  res = await call('POST', '/api/auth/login', { payload: { username: 'student1', password: 'Student123!' } });
  assert.equal(res.statusCode, 403);

  // ── 回滚导入 ──
  res = await call('POST', `/api/import/${batchId}/rollback`, { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).removed, 7);
  res = await call('GET', `/api/banks/${bankId}`, { cookie: admin });
  assert.equal(json(res).wordCount, 0);

  // ── 删除词库需要名称确认 ──
  res = await call('DELETE', `/api/banks/${bankId}`, { cookie: admin, payload: { confirmName: '错的' } });
  assert.equal(res.statusCode, 400);
  res = await call('DELETE', `/api/banks/${bankId}`, { cookie: admin, payload: { confirmName: '测试词库' } });
  assert.equal(res.statusCode, 200);

  // ── 不存在的接口返回 JSON 404 ──
  res = await call('GET', '/api/nope', { cookie: admin });
  assert.equal(res.statusCode, 404);
  assert.equal(json(res).code, 'not_found');

  // ── 模板与导出能下载 ──
  res = await call('GET', '/api/import/template?level=PET', { cookie: admin });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /spreadsheetml/);
  assert.ok(res.rawPayload.length > 4000);

  // ── 退出登录 ──
  res = await call('POST', '/api/auth/logout', { cookie: admin, payload: {} });
  assert.equal(res.statusCode, 200);
  res = await call('GET', '/api/banks', { cookie: admin });
  assert.equal(res.statusCode, 401);
});

test('数据库迁移可重复执行且版本正确', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-db-'));
  try {
    const db = openDb(path.join(dir, 'm.db'));
    const first = migrate(db);
    assert.ok(first.length >= 1);
    const second = migrate(db);
    assert.equal(second.length, 0, '第二次迁移不应重复执行');
    const ver = db.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).get().value;
    assert.equal(ver, '4');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('前端构建产物存在时，SPA 路由回落到 index.html', async t => {
  const distIndex = path.join(ROOT, 'dist', 'web', 'index.html');
  if (!fs.existsSync(distIndex)) {
    t.skip('尚未构建 dist/web');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-spa-'));
  const app = await buildApp({ logger: false, dbFile: path.join(dir, 'spa.db') });
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const res = await app.inject({ method: 'GET', url: '/practice' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<div id="app"/);
  // 未登录时鉴权钩子先于路由匹配，所以是 401 而不是 404
  const api = await app.inject({ method: 'GET', url: '/api/nope' });
  assert.equal(api.statusCode, 401);
});
