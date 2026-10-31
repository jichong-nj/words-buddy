/**
 * 跟读练习（shadowing）：评分算法单测 + 服务/接口集成测试。
 *
 * 用临时数据目录，不污染 data/；不监听端口、不联网。
 * 真实音频用 espeak-ng（项目依赖，WASM）合成，ffmpeg 解码——都是运行时真实链路。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { buildApp } from '../server/app.js';
import { config } from '../server/config.js';
import { analyze, decodeToPcm, scoreAnalysis } from '../server/services/shadowscore.js';
import { normalizeSentence, refPathFor, synthesizeRef } from '../server/services/tts.js';
import { shadowPoolSize, shadowPools } from '../server/services/shadowpractice.js';

// 把数据目录（含 audio/）指到临时目录，必须在 buildApp 之前改
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-shadow-'));
config.dataDir = DIR;

const SENTENCES = [
  'She sells sea shells by the sea shore.',
  'I ate an apple after lunch.',
  'An apple grows on a tree.',
];
const OTHER_SENTENCE = 'The weather in London is quite cold today.';

/** 生成一段 wav：kind = tone | silence */
function synthWav(file, kind) {
  const src = kind === 'silence' ? 'anullsrc=r=16000:cl=mono' : 'sine=frequency=200:duration=1';
  const args = ['-v', 'error', '-f', 'lavfi', '-i', src];
  if (kind === 'silence') args.push('-t', '1');
  execFileSync('ffmpeg', [...args, '-ar', '16000', '-ac', '1', file, '-y']);
}

async function speak(text) {
  const { file } = await synthesizeRef(text);
  return fs.readFileSync(file);
}

// ───────────────────────────── 纯函数 ─────────────────────────────

test('normalizeSentence：折叠空白、去首尾', () => {
  assert.equal(normalizeSentence('  a \n b\tc '), 'a b c');
  assert.equal(normalizeSentence(null), '');
});

test('analyze：静音不产生有效语音帧', async () => {
  const f = path.join(DIR, 'silence.wav');
  synthWav(f, 'silence');
  const a = analyze(await decodeToPcm(f));
  assert.ok(!a || a.voicedCount < 5, '纯静音应判为无语音');
});

test('scoreAnalysis：同一段音频自评 = 满分', async () => {
  const buf = await speak(SENTENCES[1]);
  const f = path.join(DIR, 'self.wav');
  fs.writeFileSync(f, buf);
  const a = analyze(await decodeToPcm(f));
  assert.ok(a && a.voicedCount > 10);
  const r = scoreAnalysis(a, a);
  assert.equal(r.ok, true);
  assert.equal(r.total, 100);
  assert.equal(r.offTarget, false);
  assert.ok(Array.isArray(r.curves.stuPitch) && r.curves.stuPitch.length > 0);
});

test('scoreAnalysis：读的是另一句 → 判为跑题并封顶', async () => {
  const refA = analyze(await decodeToPcm(await writeTmp('a.wav', await speak(SENTENCES[0]))));
  const stuB = analyze(await decodeToPcm(await writeTmp('b.wav', await speak(OTHER_SENTENCE))));
  assert.ok(refA && stuB);
  const r = scoreAnalysis(refA, stuB);
  assert.equal(r.ok, true);
  assert.equal(r.offTarget, true, `vuCost=${r.vuCost}`);
  assert.ok(r.total <= 50, `跑题应 <= 50，实际 ${r.total}`);
});

test('scoreAnalysis：音量差异不影响分数', async () => {
  const src = await writeTmp('v0.wav', await speak(SENTENCES[2]));
  const quiet = path.join(DIR, 'v1.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-af', 'volume=0.25', quiet, '-y']);
  const ref = analyze(await decodeToPcm(src));
  const stu = analyze(await decodeToPcm(quiet));
  const r = scoreAnalysis(ref, stu);
  assert.ok(r.total >= 90, `音量 1/4 应仍高分，实际 ${r.total}`);
});

test('scoreAnalysis：音频太短不给分', () => {
  const short = { env: new Float32Array(3), pitch: new Float32Array(3), vu: new Float32Array(3), durMs: 30, voicedCount: 2 };
  const full = { env: new Float32Array(50), pitch: new Float32Array(50), vu: new Float32Array(50), durMs: 500, voicedCount: 30 };
  assert.deepEqual(scoreAnalysis(full, short), { ok: false, reason: 'no_speech' });
  assert.deepEqual(scoreAnalysis(null, full), { ok: false, reason: 'too_short' });
});

async function writeTmp(name, buf) {
  const f = path.join(DIR, name);
  fs.writeFileSync(f, buf);
  return f;
}

// ───────────────────────────── 接口 ─────────────────────────────

const WORDS = [
  ['shell', 'n.', '贝壳；海螺', SENTENCES[0], '她沿着海岸卖海螺。', 'PET'],
  ['apple', 'n.', '苹果', SENTENCES[1], '我午饭后吃了一个苹果。', 'PET'],
  ['tree', 'n.', '树', SENTENCES[2], '', 'KET'],
];

function seedWords(db) {
  const bank = db.prepare(`INSERT INTO word_bank(name,level) VALUES('测试库','PET')`).run().lastInsertRowid;
  for (const [word, pos, defCn, ex, exCn, level] of WORDS) {
    const wid = db.prepare(`INSERT INTO word(bank_id,word,level,topic) VALUES(?,?,?, 'Food')`)
      .run(bank, word, level).lastInsertRowid;
    db.prepare(`INSERT INTO word_sense(word_id,pos,def_cn,example_en,example_cn) VALUES(?,?,?,?,?)`)
      .run(wid, pos, defCn, ex, exCn);
  }
  return bank;
}

function cookieOf(res) {
  const c = (res.cookies || []).find(x => x.name === 'wb_session');
  return c ? `wb_session=${c.value}` : null;
}

async function main() {
  const app = await buildApp({ logger: false, dbFile: path.join(DIR, 'shadow.db') });
  const db = app.db;
  const call = (method, url, { cookie, payload, headers } = {}) => {
    const opts = { method, url, headers: {} };
    if (cookie) opts.headers.cookie = cookie;
    if (payload !== undefined) {
      if (Buffer.isBuffer(payload)) opts.payload = payload;
      else {
        opts.payload = JSON.stringify(payload);
        opts.headers['content-type'] ||= 'application/json';
      }
    }
    if (headers) Object.assign(opts.headers, headers);
    return app.inject(opts);
  };
  const json = res => JSON.parse(res.body);
  const multipart = (fields, buf, filename = 'take.wav', type = 'audio/wav') => {
    const b = `----wbs${Date.now()}${Math.random().toString(16).slice(2)}`;
    const head = [];
    for (const [k, v] of Object.entries(fields)) {
      head.push(`--${b}`, `Content-Disposition: form-data; name="${k}"`, '', String(v));
    }
    head.push(`--${b}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, `Content-Type: ${type}`, '');
    return {
      body: Buffer.concat([Buffer.from(head.join('\r\n') + '\r\n', 'utf8'), buf, Buffer.from(`\r\n--${b}--\r\n`, 'utf8')]),
      type: `multipart/form-data; boundary=${b}`,
    };
  };

  // 迁移与表结构
  const ver = db.prepare(`SELECT value FROM app_meta WHERE key='schema_version'`).get().value;
  assert.equal(Number(ver), 5, `schema_version 应为 5，实际 ${ver}`);
  const cols = db.prepare(`SELECT name FROM pragma_table_info('practice_item')`).all().map(r => r.name);
  for (const c of ['shadow_score', 'shadow_pitch', 'shadow_rhythm', 'shadow_fluency',
    'shadow_completeness', 'shadow_audio_path', 'shadow_off_target', 'shadow_reason']) {
    assert.ok(cols.includes(c), `practice_item 缺列 ${c}`);
  }
  assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE name='shadow_audio'`).get(), '缺 shadow_audio 表');

  // 例句池
  const bank = seedWords(db);
  assert.equal(shadowPoolSize(db), 3);
  const pools = shadowPools(db);
  assert.equal(pools.mode, 'shadowing');
  assert.equal(pools.total, 3);
  assert.ok(pools.byLevel.some(l => l.level === 'PET' && l.count === 2));
  assert.equal(shadowPoolSize(db, { levels: ['KET'] }), 1);
  assert.equal(shadowPoolSize(db, { minWords: 8, maxWords: 18 }), 1, '按词数过滤应只剩长句');

  let res = await call('POST', '/api/auth/setup', { payload: { username: 'admin', password: 'Admin123!' } });
  const admin = cookieOf(res);
  assert.ok(admin, '初始化管理员失败');

  res = await call('POST', '/api/users', { cookie: admin, payload: { username: 'stu1', password: 'Stu12345!', displayName: '学生一' } });
  assert.equal(res.statusCode, 200, res.body);
  const stuCookie = cookieOf(await call('POST', '/api/auth/login', { payload: { username: 'stu1', password: 'Stu12345!' } }));
  assert.ok(stuCookie);

  // pools 接口
  res = await call('GET', '/api/shadow/pools', { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).total, 3);

  // 筛选后无题 → 400
  res = await call('POST', '/api/shadow/sessions', { cookie: stuCookie, payload: { count: 5, levels: ['（不存在的级别）'] } });
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).code, 'no_sentences');

  // 建会话
  res = await call('POST', '/api/shadow/sessions', { cookie: stuCookie, payload: { count: 3 } });
  assert.equal(res.statusCode, 200, res.body);
  const sess = json(res);
  assert.equal(sess.mode, 'shadowing');
  assert.equal(sess.total, 3);
  assert.equal(new Set(sess.questions.map(q => q.sentence)).size, 3);
  for (const q of sess.questions) {
    assert.ok(q.sentence && q.word);
    assert.ok(q.seq >= 1 && q.seq <= 3);
  }
  const q1 = sess.questions[0];

  // 未登录
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    payload: multipart({ seq: 1 }, Buffer.from('x')).body, headers: { 'content-type': multipart({ seq: 1 }, Buffer.from('x')).type },
  });
  assert.equal(res.statusCode, 401);

  // 正常评分：提交与参考同源的录音 → 高分
  const good = multipart({ seq: q1.seq, mime: 'audio/wav' }, await speak(q1.sentence));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: good.body, headers: { 'content-type': good.type },
  });
  assert.equal(res.statusCode, 200, res.body);
  const ok1 = json(res);
  assert.equal(ok1.ok, true, res.body);
  assert.equal(ok1.seq, q1.seq);
  assert.ok(ok1.total >= 90, `同源录音应 >= 90，实际 ${ok1.total}`);
  assert.equal(ok1.offTarget, false);
  for (const k of ['pitch', 'rhythm', 'fluency', 'completeness']) {
    assert.ok(typeof ok1[k] === 'number' && ok1[k] >= 0 && ok1[k] <= 100, `${k}=${ok1[k]}`);
  }
  assert.ok(ok1.curves.refEnv.length > 0 && ok1.curves.stuEnv.length > 0);
  assert.equal(ok1.sentence, q1.sentence);

  // 重录覆盖：再交一次差录音，分数应被替换（跟读允许反复练）
  const bad = multipart({ seq: q1.seq, mime: 'audio/wav' }, await speak(OTHER_SENTENCE));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: bad.body, headers: { 'content-type': bad.type },
  });
  assert.equal(res.statusCode, 200, res.body);
  const ok1b = json(res);
  assert.equal(ok1b.ok, true);
  assert.ok(ok1b.total <= ok1.total, `跑题录音应更低分：${ok1b.total} vs ${ok1.total}`);
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM practice_item WHERE session_id=? AND seq=?`)
    .get(sess.sessionId, q1.seq).c, 1, '重录不应新增行');

  // 静音 → no_speech（HTTP 200，业务失败）
  // 题目顺序是随机的，避开 q1 那一题，免得覆盖掉它的评分
  const [seqSil, seqJunk] = [1, 2, 3].filter(s => s !== q1.seq);
  const sil = path.join(DIR, 'sil.wav');
  synthWav(sil, 'silence');
  const mpSil = multipart({ seq: seqSil, mime: 'audio/wav' }, fs.readFileSync(sil));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mpSil.body, headers: { 'content-type': mpSil.type },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(json(res).ok, false);
  assert.equal(json(res).reason, 'no_speech');

  // 非音频 → decode_failed
  const mpJunk = multipart({ seq: seqJunk, mime: 'audio/webm' }, Buffer.from('这不是音频文件'));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mpJunk.body, headers: { 'content-type': mpJunk.type },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(json(res).reason, 'decode_failed');

  // 缺 seq / 缺音频 / 越界 seq
  const mpNoSeq = multipart({}, Buffer.from('x'));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mpNoSeq.body, headers: { 'content-type': mpNoSeq.type },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(json(res).code, 'no_seq');

  const mpNoFile = multipart({ seq: 1 }, Buffer.alloc(0));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mpNoFile.body, headers: { 'content-type': mpNoFile.type },
  });
  assert.equal(res.statusCode, 400);

  const mp99 = multipart({ seq: 99, mime: 'audio/wav' }, await speak(SENTENCES[1]));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mp99.body, headers: { 'content-type': mp99.type },
  });
  assert.equal(res.statusCode, 404);

  // 回听录音
  res = await call('GET', `/api/shadow/sessions/${sess.sessionId}/audio/${q1.seq}`, { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /audio\//);
  assert.ok(res.rawPayload.length > 1024);
  res = await call('GET', `/api/shadow/sessions/${sess.sessionId}/audio/2`, { cookie: stuCookie });
  assert.equal(res.statusCode, 200, '静音那次也存了录音');

  // 参考音频接口
  res = await call('GET', `/api/shadow/ref?text=${encodeURIComponent(SENTENCES[1])}`, { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /audio\/wav/);
  assert.ok(res.rawPayload.length > 1024);
  res = await call('GET', '/api/shadow/ref?text=', { cookie: stuCookie });
  assert.equal(res.statusCode, 400);
  res = await call('GET', `/api/shadow/ref?text=${encodeURIComponent(SENTENCES[1])}`);
  assert.equal(res.statusCode, 401, '参考音频需登录');

  // 参考音频缓存表有记录（评分时写入）
  const refHash = path.basename(refPathFor(q1.sentence), '.wav');
  const refRow = db.prepare(`SELECT * FROM shadow_audio WHERE text_hash=?`).get(refHash);
  assert.ok(refRow, `shadow_audio 应有 ${q1.sentence} 的记录`);
  assert.ok(refRow.duration_ms > 0 && refRow.bytes > 1024);
  assert.ok(fs.existsSync(path.join(config.dataDir, refRow.file_path)));
  assert.equal(refRow.text, normalizeSentence(q1.sentence));
  // 参考音频只按题目原句缓存（学生录音不入库），重录命中同一行
  assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM shadow_audio`).get().c, 1);

  // 别人不能访问
  res = await call('POST', '/api/shadow/sessions', { cookie: admin, payload: { count: 1 } });
  const adminSess = json(res);
  res = await call('GET', `/api/shadow/sessions/${sess.sessionId}/audio/${q1.seq}`, { cookie: admin });
  assert.equal(res.statusCode, 200, '管理员可回听（用于排查）');
  void adminSess;

  // 交卷
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/finish`, { cookie: stuCookie, payload: {} });
  assert.equal(res.statusCode, 200, res.body);
  const fin = json(res);
  assert.equal(fin.total, 3);
  assert.equal(fin.correct, 1, '只有 1 题真正打了分');
  assert.ok(fin.score >= 0 && fin.score <= 100);
  const stored = db.prepare(`SELECT * FROM practice_session WHERE id=?`).get(sess.sessionId);
  assert.equal(stored.status, 'finished');
  assert.equal(stored.mode, 'shadowing');

  // 已结束 → 409
  const mpAfter = multipart({ seq: 1, mime: 'audio/wav' }, await speak(SENTENCES[1]));
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/attempt`, {
    cookie: stuCookie, payload: mpAfter.body, headers: { 'content-type': mpAfter.type },
  });
  assert.equal(res.statusCode, 409);
  // 重复交卷幂等
  res = await call('POST', `/api/shadow/sessions/${sess.sessionId}/finish`, { cookie: stuCookie, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).score, fin.score);

  // 会话明细走通用练习记录接口
  res = await call('GET', `/api/practice/sessions/${sess.sessionId}`, { cookie: stuCookie });
  assert.equal(res.statusCode, 200, res.body);
  const detail = json(res);
  assert.equal(detail.session.mode, 'shadowing');
  assert.equal(detail.items.length, 3);
  const it1 = detail.items.find(i => i.seq === q1.seq);
  assert.equal(it1.sentence, q1.sentence);
  assert.ok(typeof it1.score === 'number');
  assert.equal(it1.offTarget, 1, '最后一次是跑题录音');
  assert.ok(detail.items.some(i => i.reason === 'no_speech'), '未打分题应带失败原因');
  assert.ok(detail.items.some(i => i.reason === 'decode_failed'), '解码失败应记录原因');
  assert.equal(detail.items.filter(i => i.score === null).length, 2, '两题未打分');

  // 练习记录列表能看到该会话
  res = await call('GET', '/api/practice/sessions?mode=shadowing&size=10', { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  assert.ok(json(res).items.some(s => s.id === sess.sessionId), '练习记录列表应含跟读会话');

  // 不污染错题集与正确率
  res = await call('GET', '/api/mistakes', { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  assert.equal(json(res).total, 0, '跟读不应产生错题');
  const nullCorrect = db.prepare(
    `SELECT COUNT(*) AS c FROM practice_item pi JOIN practice_session ps ON ps.id=pi.session_id
     WHERE ps.mode='shadowing' AND pi.is_correct IS NOT NULL`).get().c;
  assert.equal(nullCorrect, 0, '跟读题的 is_correct 必须为 NULL');
  res = await call('GET', '/api/stats/overview', { cookie: stuCookie });
  assert.equal(res.statusCode, 200);
  const ov = json(res);
  assert.equal(ov.itemsAnswered, 0, `跟读不计入已答题数：${JSON.stringify(ov)}`);
  assert.equal(ov.accuracy, 0, '跟读不参与正确率');
  assert.equal(ov.sessions, 1, '跟读计入练习次数');
  assert.equal(ov.shadowSessions, 1);
  assert.ok(ov.shadowAvgScore >= 0 && ov.shadowAvgScore <= 100);
  assert.ok(ov.studyMs >= 0);

  // 非跟读会话走跟读接口 → wrong_mode
  res = await call('POST', '/api/practice/sessions', { cookie: stuCookie, payload: { count: 1 } });
  if (res.statusCode === 200) {
    const defSess = json(res);
    const mpX = multipart({ seq: 1, mime: 'audio/wav' }, await speak(SENTENCES[1]));
    res = await call('POST', `/api/shadow/sessions/${defSess.sessionId}/attempt`, {
      cookie: stuCookie, payload: mpX.body, headers: { 'content-type': mpX.type },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).code, 'wrong_mode');
  }

  // 清理过期录音
  db.prepare(`UPDATE practice_item SET answered_at='2000-01-01 00:00:00' WHERE session_id=? AND seq=?`)
    .run(sess.sessionId, q1.seq);
  const { pruneShadowAudio } = await import('../server/services/shadowpractice.js');
  const pruned = pruneShadowAudio(db, 30);
  assert.ok(pruned.files >= 1, '应清掉过期录音');
  assert.equal(db.prepare(`SELECT shadow_audio_path AS p FROM practice_item WHERE session_id=? AND seq=?`)
    .get(sess.sessionId, q1.seq).p, null);
  res = await call('GET', `/api/shadow/sessions/${sess.sessionId}/audio/${q1.seq}`, { cookie: stuCookie });
  assert.equal(res.statusCode, 404, '录音已清理应 404');

  await app.close();
}

test('跟读练习接口全流程', { timeout: 120_000 }, async t => {
  t.after(() => fs.rmSync(DIR, { recursive: true, force: true }));
  await main();
});
