/**
 * 评分算法验证台（开发用）：用 espeak 造出各种受控变体，检查分数排序是否符合直觉。
 * 用法：node scripts/probe-shadow-score.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { synthesizeRef } from '../server/services/tts.js';
import { scoreFiles } from '../server/services/shadowscore.js';

const execFileP = promisify(execFile);
const OUT = '/tmp/shadow-probe';
fs.mkdirSync(OUT, { recursive: true });

const SENT = 'She has been working here since last year.';
const OTHER = 'The weather in London is quite cold today.';
const HALF = 'She has been working here.';

async function espeak(text, voice, wpm, out) {
  const r = await synthesizeRef(text, { voice, wpm });
  fs.copyFileSync(r.file, out);
  return out;
}
/** ffmpeg 后处理：变调 / 变音量 / 加噪 */
async function ff(inFile, out, filters) {
  await execFileP('ffmpeg', ['-v', 'error', '-i', inFile, '-af', filters, out, '-y']);
  return out;
}
/** 叠加背景噪声：按权重混合一路粉色噪声 */
async function addNoise(inFile, out, weight = 0.25) {
  const w = Math.max(0.05, Math.min(0.9, weight));
  await execFileP('ffmpeg', ['-v', 'error', '-i', inFile,
    '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.05',
    '-filter_complex', `[0:a][1:a]amix=inputs=2:duration=first:normalize=0:weights=${(1 - w).toFixed(2)} ${w.toFixed(2)}`,
    out, '-y']);
  return out;
}

const ref = path.join(OUT, 'ref.wav');
await espeak(SENT, 'en-gb', 150, ref);
const base = await espeak(SENT, 'en-gb', 150, path.join(OUT, 'same.wav'));

const cases = [];
cases.push(['完全相同', base]);
cases.push(['换口音 en-us', await espeak(SENT, 'en-us', 150, path.join(OUT, 'us.wav'))]);
cases.push(['读得快 -s200', await espeak(SENT, 'en-gb', 200, path.join(OUT, 'fast.wav'))]);
cases.push(['读得慢 -s110', await espeak(SENT, 'en-gb', 110, path.join(OUT, 'slow.wav'))]);
// 关键：rubberband 变调但保持时长，才是真实的"换一个人读"（音域不同、语速不变）
cases.push(['音域下调4半音', await ff(base, path.join(OUT, 'rb_down.wav'), 'rubberband=pitch=0.794')]);
cases.push(['音域上调5半音', await ff(base, path.join(OUT, 'rb_up.wav'), 'rubberband=pitch=1.335')]);
// 极端：音高+共振峰+时长一起变（asetrate 会连带拉长时长），作为压力测试
cases.push(['极端变调变速0.7x', await ff(base, path.join(OUT, 'low.wav'), 'asetrate=22050*0.7,aresample=22050')]);
// 关键：离麦克风远，音量小
cases.push(['音量 0.25x', await ff(base, path.join(OUT, 'quiet.wav'), 'volume=0.25')]);
cases.push(['音量 3x', await ff(base, path.join(OUT, 'loud.wav'), 'volume=3')]);
cases.push(['加背景噪声', await addNoise(base, path.join(OUT, 'noisy.wav'), 0.25)]);
// 应当低分的情况
cases.push(['只读半句', await espeak(HALF, 'en-gb', 150, path.join(OUT, 'half.wav'))]);
cases.push(['读了另一句', await espeak(OTHER, 'en-gb', 150, path.join(OUT, 'other.wav'))]);
// 完全静音
await execFileP('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '2', path.join(OUT, 'silence.wav'), '-y']);
cases.push(['全程静音', path.join(OUT, 'silence.wav')]);

console.log(`参考句：${SENT}\n`);
console.log('变体'.padEnd(22), '总分'.padStart(7), '音高'.padStart(6), '节奏'.padStart(6), '清浊'.padStart(6), '完整'.padStart(6), '时长比'.padStart(8), 'pCost'.padStart(8), 'vCost'.padStart(8));
console.log('-'.repeat(84));
const rows = [];
for (const [name, file] of cases) {
  let r;
  try { r = await scoreFiles(ref, file); } catch (e) { r = { ok: false, reason: e.message }; }
  if (!r.ok) {
    console.log(name.padEnd(22), `— 判定：${r.reason}`);
    rows.push({ name, total: -1 });
    continue;
  }
  console.log(
    name.padEnd(22),
    String(r.total).padStart(7),
    String(r.pitch).padStart(6),
    String(r.rhythm).padStart(6),
    String(r.fluency).padStart(6),
    String(r.completeness).padStart(6),
    String(r.durationRatio).padStart(8),
    String(r.pitchCost).padStart(8),
    String(r.vuCost).padStart(8),
    r.offTarget ? ' ←判为读错句' : '',
  );
  rows.push({ name, total: r.total });
}

// 断言：算法必须满足的常识
const g = n => rows.find(r => r.name === n)?.total ?? -1;
const checks = [
  ['相同 > 85', g('完全相同') > 85],
  ['换音域(下调4半音)不致命 > 75', g('音域下调4半音') > 75],
  ['换音域(上调5半音)不致命 > 75', g('音域上调5半音') > 75],
  ['极端变调变速仍 > 55', g('极端变调变速0.7x') > 55],
  ['音量差异不致命(0.25x > 70)', g('音量 0.25x') > 70],
  ['音量差异不致命(3x > 70)', g('音量 3x') > 70],
  ['语速快仍可容忍 > 70', g('读得快 -s200') > 70],
  ['语速慢仍可容忍 > 70', g('读得慢 -s110') > 70],
  ['读错句 < 60', g('读了另一句') < 60],
  ['半句被压分 <= 55', g('只读半句') <= 55],
  ['静音被拒', g('全程静音') === -1],
  ['排序：相同 > 换口音 > 错句', g('完全相同') > g('换口音 en-us') && g('换口音 en-us') > g('读了另一句')],
];
console.log('\n断言：');
let bad = 0;
for (const [name, pass] of checks) {
  console.log(` ${pass ? '✓' : '✗'} ${name}`);
  if (!pass) bad++;
}
console.log(bad ? `\n${bad} 项未通过` : '\n全部通过');
process.exit(bad ? 1 : 0);
