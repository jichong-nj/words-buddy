/**
 * 参考音频合成：用 espeak-ng（WASM，无需系统依赖 / 无需 sudo）把句子合成 WAV。
 *
 * 这份音频只用于评分基准，学生听到的是浏览器 speechSynthesis 的自然语音。
 * 合成结果按 句子+音色 做磁盘缓存，同一句只合成一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const REF_VOICE = process.env.SHADOW_REF_VOICE || 'en-gb';
export const REF_WPM = Number(process.env.SHADOW_REF_WPM || 150);

let espeakMod = null;
async function mod() {
  if (!espeakMod) {
    const m = await import('espeak-ng');
    espeakMod = m.default || m;
  }
  return espeakMod;
}

/** 归一化句子：折叠空白，作为缓存键的一部分 */
export function normalizeSentence(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function cacheKey(text, voice, wpm) {
  return crypto.createHash('sha256').update(`${voice}|${wpm}|${text}`).digest('hex').slice(0, 32);
}

export function refPathFor(text, voice = REF_VOICE, wpm = REF_WPM) {
  const dir = path.join(config.audioDir, 'shadow');
  return path.join(dir, `${cacheKey(normalizeSentence(text), voice, wpm)}.wav`);
}

/**
 * 合成一句参考音频。已缓存则直接返回路径。
 * @returns {Promise<{file:string, cached:boolean}>}
 */
export async function synthesizeRef(text, opts = {}) {
  const voice = opts.voice || REF_VOICE;
  const wpm = opts.wpm || REF_WPM;
  const clean = normalizeSentence(text);
  if (!clean) throw new Error('empty_sentence');
  const file = refPathFor(clean, voice, wpm);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) return { file, cached: true };

  const ESpeakNg = await mod();
  const inst = await ESpeakNg({ arguments: ['-v', voice, '-s', String(wpm), '-w', 'out.wav', clean] });
  const wav = inst.FS.readFile('out.wav');
  inst.terminate?.();
  if (!wav || wav.length < 1024) throw new Error('tts_failed');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(wav));
  fs.renameSync(tmp, file);          // 原子落盘，避免并发读到半个文件
  return { file, cached: false };
}

/** 预热一批句子（管理员用，避免首次练习时卡顿） */
export async function prewarm(sentences, limit = 50) {
  let made = 0, hit = 0;
  for (const s of sentences.slice(0, limit)) {
    try {
      const r = await synthesizeRef(s);
      r.cached ? hit++ : made++;
    } catch { /* 单句失败不影响整体 */ }
  }
  return { made, hit };
}
