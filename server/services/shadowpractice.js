/**
 * 跟读练习（shadowing）：出例句 → 学生听发音并跟读录音 → 服务端比对韵律打分 0–100。
 *
 * 会话复用 practice_session（mode='shadowing'），每题一行 practice_item。
 * practice_item.is_correct 恒为 NULL：跟读没有对错，不进错题集、不进正确率统计，
 * 只记分数。会话的 score = 各题平均分，correct = 已录音题数。
 *
 * 学生听到的是浏览器 speechSynthesis 的自然语音；服务端 espeak-ng 合成的 WAV
 * 只作为评分基准，不下发给学生。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { nowStr } from '../db/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { analyze, decodeToPcm, scoreAnalysis } from './shadowscore.js';
import { REF_VOICE, REF_WPM, normalizeSentence, synthesizeRef } from './tts.js';

export const SHADOW_MODE = 'shadowing';

/** 例句池：只取词数合适、且能关联到单词的例句 */
function poolWhere(opts = {}) {
  const parts = [`ws.example_en IS NOT NULL`, `trim(ws.example_en) <> ''`];
  const p = {};
  const wc = `(length(trim(ws.example_en)) - length(replace(trim(ws.example_en),' ','')) + 1)`;
  parts.push(`${wc} BETWEEN @minWords AND @maxWords`);
  p.minWords = Number(opts.minWords) || config.shadow.minWords;
  p.maxWords = Number(opts.maxWords) || config.shadow.maxWords;

  if (opts.levels?.length) {
    p.levels = opts.levels;
    parts.push(`COALESCE(NULLIF(w.level,''),'（未分级）') IN (${opts.levels.map((_, i) => `@lv${i}`).join(',')})`);
    opts.levels.forEach((v, i) => { p[`lv${i}`] = v; });
  }
  if (Number(opts.bankId) > 0) { p.bankId = Number(opts.bankId); parts.push(`w.bank_id = @bankId`); }
  if (Number(opts.excludeRecentDays) > 0) {
    p.recent = `-${Math.floor(Number(opts.excludeRecentDays))} days`;
    p.userId = Number(opts.userId);
    parts.push(`ws.id NOT IN (SELECT pi.sense_id FROM practice_item pi
                              JOIN practice_session ps ON ps.id=pi.session_id
                              WHERE ps.mode='${SHADOW_MODE}' AND ps.user_id=@userId
                                AND pi.sense_id IS NOT NULL
                                AND pi.asked_at >= datetime('now','localtime',@recent))`);
  }
  return { where: parts.join(' AND '), params: p };
}

export function shadowPoolSize(db, opts = {}) {
  const e = poolWhere(opts);
  return db.prepare(`SELECT COUNT(*) AS c FROM word_sense ws JOIN word w ON w.id=ws.word_id
                     WHERE ${e.where}`).get(e.params).c;
}

/** 练习页展示用：可选范围与题量 */
export function shadowPools(db) {
  const base = `FROM word_sense ws JOIN word w ON w.id=ws.word_id
                WHERE ws.example_en IS NOT NULL AND trim(ws.example_en) <> ''
                  AND (length(trim(ws.example_en)) - length(replace(trim(ws.example_en),' ','')) + 1)
                      BETWEEN ${config.shadow.minWords} AND ${config.shadow.maxWords}`;
  return {
    mode: SHADOW_MODE,
    total: db.prepare(`SELECT COUNT(*) AS c ${base}`).get().c,
    maxPerSession: config.shadow.maxPerSession,
    voice: REF_VOICE,
    wpm: REF_WPM,
    wordRange: [config.shadow.minWords, config.shadow.maxWords],
    byLevel: db.prepare(`SELECT COALESCE(NULLIF(w.level,''),'（未分级）') AS level, COUNT(*) AS count
                         ${base} GROUP BY level ORDER BY count DESC, level`).all(),
  };
}

/** 创建一次跟读练习。参考音频不在这里合成，等到评分时惰性生成。 */
export function createShadowSession(db, user, opts = {}) {
  const count = Math.max(1, Math.min(config.shadow.maxPerSession, Number(opts.count) || 10));
  const e = poolWhere({ ...opts, userId: user.id });
  e.params.limit = count;
  const rows = db.prepare(`
    SELECT ws.id AS sense_id, ws.word_id AS word_id, w.word, w.level,
           ws.pos, ws.def_cn, ws.example_en, ws.example_cn,
           w.phonetic_uk, w.phonetic_us
    FROM word_sense ws JOIN word w ON w.id=ws.word_id
    WHERE ${e.where} ORDER BY RANDOM() LIMIT @limit`).all(e.params);
  if (!rows.length) throw badRequest('no_sentences', '当前筛选条件下没有可跟读的例句，请调整范围');

  const now = nowStr();
  const scope = {
    count, levels: opts.levels || null, bankId: Number(opts.bankId) || null,
    excludeRecentDays: Number(opts.excludeRecentDays) || 0,
    minWords: config.shadow.minWords, maxWords: config.shadow.maxWords,
  };
  const sess = db.prepare(`
    INSERT INTO practice_session(user_id,bank_id,mode,scope_json,total,status,started_at)
    VALUES(?,?,?,?,?, 'active', ?)`).run(user.id, scope.bankId, SHADOW_MODE, JSON.stringify(scope), rows.length, now);
  const sessionId = sess.lastInsertRowid;

  const ins = db.prepare(`
    INSERT INTO practice_item(session_id,seq,word_id,sense_id,question_type,stem_snapshot,answer_snapshot,asked_at)
    VALUES(?,?,?,?,?,?,?,?)`);
  const questions = [];
  db.transaction(() => {
    rows.forEach((r, i) => {
      const sentence = normalizeSentence(r.example_en);
      ins.run(sessionId, i + 1, r.word_id, r.sense_id, SHADOW_MODE, sentence, sentence, now);
      questions.push({
        seq: i + 1,
        sentence,
        word: r.word,
        pos: r.pos || '',
        defCn: r.def_cn || '',
        sentenceCn: r.example_cn || '',
        phoneticUk: r.phonetic_uk || '',
        level: r.level || '',
      });
    });
  })();
  return { sessionId, mode: SHADOW_MODE, total: questions.length, questions };
}

// ── 参考音频分析缓存 ─────────────────────────────────────────────
// espeak-ng 是确定性的：同一句话的合成结果永远一样，分析结果可以直接复用。
const refCache = new Map();

async function analyzeFile(file) {
  const st = fs.statSync(file);
  const key = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = refCache.get(key);
  if (hit) return hit;
  const a = analyze(await decodeToPcm(file));
  if (a) {
    if (refCache.size > 64) refCache.delete(refCache.keys().next().value);
    refCache.set(key, a);
  }
  return a;
}

function relPath(absPath) {
  return path.relative(config.dataDir, absPath).split(path.sep).join('/');
}

/** 记录参考音频缓存表（信息性，评分不依赖它） */
function noteRef(db, text, file, analysis) {
  const hash = path.basename(file, '.wav');
  try {
    db.prepare(`
      INSERT INTO shadow_audio(text_hash,text,voice,wpm,file_path,sample_rate,duration_ms,bytes)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(text_hash) DO UPDATE SET
        duration_ms=excluded.duration_ms, bytes=excluded.bytes,
        updated_at=datetime('now','localtime')`)
      .run(hash, text, REF_VOICE, REF_WPM, relPath(file), 16000,
        analysis ? Math.round(analysis.durMs) : null, fs.statSync(file).size);
  } catch { /* 缓存表写失败不影响评分 */ }
}

/**
 * 提交一次跟读录音并评分。
 * 允许对同一题反复重录（以最后一次为准）——发音练习本就该反复练。
 */
export async function submitShadowAttempt(db, user, sessionId, { seq, audioBuffer, mime } = {}) {
  const s = db.prepare(`SELECT * FROM practice_session WHERE id=?`).get(sessionId);
  if (!s) throw notFound('练习会话不存在');
  if (user.role !== 'admin' && s.user_id !== user.id) throw badRequest('forbidden', '只能提交自己的练习');
  if (s.mode !== SHADOW_MODE) throw badRequest('wrong_mode', '这不是跟读练习');
  if (s.status !== 'active') throw conflict('finished', '该练习已结束');

  const item = db.prepare(`SELECT * FROM practice_item WHERE session_id=? AND seq=?`).get(sessionId, Number(seq));
  if (!item) throw notFound('题目不存在');
  if (!audioBuffer?.length) throw badRequest('no_audio', '没有收到录音');
  if (audioBuffer.length > config.shadow.maxAudioBytes) {
    throw badRequest('audio_too_large', `录音超过 ${Math.round(config.shadow.maxAudioBytes / 1024 / 1024)}MB 上限`);
  }

  // 落盘学生录音，便于回听
  const dir = path.join(config.audioDir, 'student', String(user.id), String(sessionId));
  fs.mkdirSync(dir, { recursive: true });
  const ext = /ogg/i.test(mime || '') ? 'ogg' : /wav/i.test(mime || '') ? 'wav' : 'webm';
  const stuFile = path.join(dir, `${item.seq}.${ext}`);
  fs.writeFileSync(stuFile, audioBuffer);

  const fail = (reason) => {
    db.prepare(`UPDATE practice_item SET shadow_reason=?, shadow_audio_path=?, answered_at=? WHERE id=?`)
      .run(reason, relPath(stuFile), nowStr(), item.id);
    return { ok: false, reason, seq: item.seq };
  };

  let stu;
  try {
    stu = analyze(await decodeToPcm(stuFile));
  } catch {
    return fail('decode_failed');
  }
  if (!stu || stu.env.length < 5 || stu.voicedCount < 5) return fail('no_speech');

  const { file: refFile } = await synthesizeRef(item.answer_snapshot);
  const ref = await analyzeFile(refFile);
  noteRef(db, item.answer_snapshot, refFile, ref);
  if (!ref) return fail('ref_failed');

  const r = scoreAnalysis(ref, stu);
  if (!r.ok) return fail(r.reason);

  db.prepare(`
    UPDATE practice_item SET
      shadow_score=?, shadow_pitch=?, shadow_rhythm=?, shadow_fluency=?, shadow_completeness=?,
      shadow_audio_path=?, shadow_ref_ms=?, shadow_stu_ms=?, shadow_off_target=?, shadow_reason=NULL,
      given=?, is_correct=NULL, latency_ms=?, answered_at=?
    WHERE id=?`)
    .run(r.total, r.pitch, r.rhythm, r.fluency, r.completeness, relPath(stuFile),
      r.refDurMs, r.stuDurMs, r.offTarget ? 1 : 0, `${r.total} 分`,
      Math.round(stu.durMs), nowStr(), item.id);

  return {
    ok: true,
    seq: item.seq,
    total: r.total,
    pitch: r.pitch,
    rhythm: r.rhythm,
    fluency: r.fluency,
    completeness: r.completeness,
    offTarget: r.offTarget,
    durationRatio: r.durationRatio,
    refDurMs: r.refDurMs,
    stuDurMs: r.stuDurMs,
    curves: r.curves,
    sentence: item.stem_snapshot,
    sentenceCn: db.prepare(`SELECT example_cn FROM word_sense WHERE id=?`).get(item.sense_id)?.example_cn || '',
  };
}

/** 交卷：分数取各题平均，correct 记已录音题数（跟读无对错） */
export function finishShadowSession(db, user, sessionId) {
  const s = db.prepare(`SELECT * FROM practice_session WHERE id=?`).get(sessionId);
  if (!s) throw notFound('练习会话不存在');
  if (user.role !== 'admin' && s.user_id !== user.id) throw badRequest('forbidden', '只能操作自己的练习记录');
  if (s.mode !== SHADOW_MODE) throw badRequest('wrong_mode', '这不是跟读练习');
  if (s.status === 'finished') {
    return { sessionId: Number(sessionId), total: s.total, correct: s.correct, score: s.score, durationMs: s.duration_ms };
  }
  const agg = db.prepare(`
    SELECT COUNT(shadow_score) AS scored, COALESCE(AVG(shadow_score),0) AS avg
    FROM practice_item WHERE session_id=?`).get(sessionId);
  const score = Math.round(agg.avg);
  const started = new Date(String(s.started_at).replace(' ', 'T')).getTime();
  const duration = Math.max(0, Math.round(Date.now() - started));
  db.prepare(`UPDATE practice_session SET correct=?, score=?, duration_ms=?, status='finished', finished_at=? WHERE id=?`)
    .run(agg.scored, score, duration, nowStr(), sessionId);
  return { sessionId: Number(sessionId), total: s.total, correct: agg.scored, score, durationMs: duration };
}

/** 会话明细：每题的分数与录音（供 /api/practice/sessions/:id 复用） */
export function shadowSessionItems(db, sessionId) {
  return db.prepare(`
    SELECT pi.seq, pi.stem_snapshot AS sentence, pi.answer_snapshot AS target,
           w.word, ws.example_cn AS sentenceCn,
           pi.shadow_score AS score, pi.shadow_pitch AS pitch, pi.shadow_rhythm AS rhythm,
           pi.shadow_fluency AS fluency, pi.shadow_completeness AS completeness,
           pi.shadow_off_target AS offTarget, pi.shadow_reason AS reason,
           pi.shadow_ref_ms AS refMs, pi.shadow_stu_ms AS stuMs,
           pi.shadow_audio_path AS audioPath, pi.answered_at AS answeredAt
    FROM practice_item pi
    LEFT JOIN word w ON w.id=pi.word_id
    LEFT JOIN word_sense ws ON ws.id=pi.sense_id
    WHERE pi.session_id=? ORDER BY pi.seq`).all(sessionId);
}

/** 清理过期学生录音（启动时调用一次即可） */
export function pruneShadowAudio(db, days = config.shadow.keepAudioDays) {
  if (!(days > 0)) return { files: 0, bytes: 0 };
  const cutoff = nowStr(-days * 24 * 3600 * 1000);
  const rows = db.prepare(`
    SELECT id, shadow_audio_path AS p FROM practice_item
    WHERE shadow_audio_path IS NOT NULL AND answered_at IS NOT NULL AND answered_at < ?`).all(cutoff);
  let files = 0, bytes = 0;
  const clr = db.prepare(`UPDATE practice_item SET shadow_audio_path=NULL WHERE id=?`);
  for (const r of rows) {
    const abs = path.join(config.dataDir, r.p);
    try {
      bytes += fs.statSync(abs).size;
      fs.rmSync(abs);
      files++;
      clr.run(r.id);
    } catch { /* 文件已不在 */ }
  }
  return { files, bytes, scanned: rows.length };
}
