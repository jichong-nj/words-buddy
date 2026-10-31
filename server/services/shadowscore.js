/**
 * 跟读评分：把学生录音与参考音频做韵律对比，输出 0–100 分。
 *
 * 只比"韵律"（音高轮廓 + 能量节奏），不比音色。原因有二：
 *   1) 需求本身要的是"音调与节奏越接近分越高"；
 *   2) 参考音频是 TTS，音色与学生声带天然不同，一旦引入 MFCC 之类音色特征，
 *      距离会被音色差异淹没，分数就失去意义。
 *
 * 两个关键归一化，缺一不可：
 *   - 音量归一化：学生离麦克风远近不同，能量包络归一到 0–1；
 *   - 音高归一化：男女声基频差一倍以上，用 log-F0 减中位数再除 MAD，
 *     比的是"起伏形状"而不是绝对音高，否则男生一律低分。
 *
 * 时间对齐用 DTW，因此语速快慢不直接扣分，扣的是"节奏形状不匹配"。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const SR = 16000;          // 分析采样率
const HOP_MS = 10;                // 帧移
const WIN_MS = 50;                // 窗长：至少覆盖 60Hz 的两个周期
const F0_MIN = 60;
const F0_MAX = 400;
const YIN_THRESH = 0.15;          // CMNDF 阈值：越低越严格
const YIN_FLOOR = 0.45;           // 超过这个 CMNDF 视为无清音
const PITCH_SCALE_FLOOR = 0.30;   // log-F0 归一化尺度下限（约 ±0.4 个八度）
const PITCH_CLIP = 3;             // 归一化音高裁剪，孤立尖峰不该主导整段对齐
const BAND = 0.12;                // Sakoe-Chiba 带宽：约 ±120ms，够语速差异但不足以乱配

// 分数标定：cost → 分数的指数衰减宽容度，用 scripts/probe-shadow-score.js 校准
export const TAU_PITCH = 0.55;    // 音高轮廓平均距离（MAD 归一后）
export const TAU_ENV = 0.16;      // 能量包络平均距离（0–1 尺度）
export const TAU_VU = 0.03;       // 清浊模式平均距离：最敏感的一路，用来卡"读错句"
export const TAU_DUR = 0.5;       // |log(时长比)|
export const VU_CAP_COST = 0.05;  // 超过即判定"大概率不是这句"，总分封顶
export const W_PITCH = 0.30;
export const W_RHYTHM = 0.25;
export const W_VU = 0.30;
export const W_DUR = 0.15;

/** 解码任意音频（webm/opus/mp3/wav…）为单声道 Float32 PCM */
export async function decodeToPcm(file, sr = SR) {
  // encoding 必须是 'buffer'：默认 utf8 会把二进制 PCM 当文本解码，数据直接损坏
  const { stdout } = await execFileP('ffmpeg', [
    '-v', 'error', '-i', file,
    '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sr),
    '-',
  ], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  // 拷一份到对齐的 ArrayBuffer：Buffer 的 byteOffset 未必 4 字节对齐
  const ab = new ArrayBuffer(stdout.length);
  new Uint8Array(ab).set(stdout);
  return new Float32Array(ab);
}

export async function loadAudio(file, sr = SR) {
  return { pcm: await decodeToPcm(file, sr), sr };
}

/** 帧级能量（dB） */
function energyFrames(pcm, sr, hop, win) {
  const n = Math.max(0, Math.floor((pcm.length - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const off = i * hop;
    for (let j = 0; j < win; j++) { const v = pcm[off + j]; sum += v * v; }
    db[i] = 10 * Math.log10(sum / win + 1e-12);
  }
  return db;
}

/** 噪声底：能量低分位（比全局 min 稳，避免个别爆音影响） */
function noiseFloor(db) {
  if (!db.length) return -60;
  const a = Array.from(db).sort((x, y) => x - y);
  return a[Math.floor(a.length * 0.1)] ?? -60;
}

/**
 * YIN 基频提取（累积均值归一化差分 CMNDF）。
 * 比裸自相关取峰可靠得多：自相关在低基频上常把 2 倍周期当基频（八度错误），
 * CMNDF 用"到目前为止的平均差分"做分母，正好压掉这种偏好。
 * 未清音帧 f0=0、voiced=0。
 */
function f0Frames(pcm, sr, hop, win) {
  const n = Math.max(0, Math.floor((pcm.length - win) / hop) + 1);
  const f0 = new Float32Array(n);
  const voiced = new Uint8Array(n);
  const minLag = Math.max(2, Math.floor(sr / F0_MAX));
  const maxLag = Math.min(Math.floor(sr / F0_MIN), Math.floor(win / 2));
  if (maxLag <= minLag) return { f0, voiced };

  const d = new Float64Array(maxLag + 1);
  const cm = new Float64Array(maxLag + 1);

  for (let i = 0; i < n; i++) {
    const off = i * hop;
    // 差分能量 d(tau) = Σ (x[j] - x[j+tau])²
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      const lim = win - tau;
      for (let j = 0; j < lim; j++) {
        const diff = pcm[off + j] - pcm[off + j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // CMNDF：除以到 tau 为止的均值，tau=1 时保持原值
    let running = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      running += d[tau];
      cm[tau] = tau === 1 ? d[tau] : d[tau] * tau / running;
    }
    // 在合法区间内取第一个低于阈值的谷，否则取全域最小
    let best = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (cm[tau] < YIN_THRESH && (tau === minLag || cm[tau] <= cm[tau - 1])) { best = tau; break; }
    }
    if (best < 0) {
      let minVal = Infinity;
      for (let tau = minLag; tau <= maxLag; tau++) if (cm[tau] < minVal) { minVal = cm[tau]; best = tau; }
      if (minVal > YIN_FLOOR) continue;
    }
    if (best <= 0) continue;
    // 抛物线插值细化，避免量化成台阶
    let delta = 0;
    if (best > minLag && best < maxLag) {
      const s0 = cm[best - 1], s1 = cm[best], s2 = cm[best + 1];
      const denom = 2 * (s0 - 2 * s1 + s2);
      if (Math.abs(denom) > 1e-12) delta = (s0 - s2) / denom;
    }
    const lag = best + Math.max(-0.5, Math.min(0.5, delta));
    f0[i] = sr / lag;
    voiced[i] = 1;
  }
  fixOctaveJumps(f0, voiced);
  return { f0, voiced };
}

/**
 * 八度纠错：若某帧是前一清音帧的 ~2 倍或 ~0.5 倍，且翻转后更贴近邻域中位数，就翻转。
 * YIN 之后仍会零星漏几个，这一步把轮廓毛刺抹平，DTW 才不会被带偏。
 */
function fixOctaveJumps(f0, voiced) {
  const n = f0.length;
  const med5 = (arr, i) => {
    const w = [];
    for (let k = i - 2; k <= i + 2; k++) if (k >= 0 && k < n && arr[k] > 0) w.push(arr[k]);
    if (!w.length) return 0;
    w.sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < n - 1; i++) {
      if (!voiced[i]) continue;
      const ctx = med5(f0, i);
      if (ctx <= 0) continue;
      const r = f0[i] / ctx;
      if (r > 1.55 && r < 2.45) f0[i] /= 2;
      else if (r < 0.65 && r > 0.41) f0[i] *= 2;
    }
  }
}

/**
 * 中位数 / MAD 归一化，比 mean/std 抗离群值。
 * scale 有下限：合成语音或平淡说话人的 MAD 可能极小，
 * 不设下限会把一两个八度错误放大成十几倍的尖峰，把 DTW 整个带偏。
 */
function robustStats(values) {
  const v = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return { med: 0, scale: PITCH_SCALE_FLOOR };
  const med = v[Math.floor(v.length / 2)];
  const devs = v.map(x => Math.abs(x - med)).sort((x, y) => x - y);
  const mad = devs[Math.floor(devs.length / 2)] || 0;
  return { med, scale: Math.max(1.4826 * mad, PITCH_SCALE_FLOOR) };
}

/** 未清音帧的 log-F0 会断，DTW 需要连续序列：线性插值补齐 */
function interpolate(logf) {
  const out = new Float32Array(logf.length);
  for (let i = 0; i < logf.length; i++) {
    if (Number.isFinite(logf[i])) { out[i] = logf[i]; continue; }
    let l = i - 1; while (l >= 0 && !Number.isFinite(logf[l])) l--;
    let r = i + 1; while (r < logf.length && !Number.isFinite(logf[r])) r++;
    const lv = l >= 0 ? logf[l] : null;
    const rv = r < logf.length ? logf[r] : null;
    out[i] = lv === null && rv === null ? 0
      : lv === null ? rv
      : rv === null ? lv
      : lv + (rv - lv) * ((i - l) / (r - l));
  }
  return out;
}

/** 能量包络归一化到 0–1，裁掉首尾静音，返回起始偏移 */
function normalizeEnvelope(db) {
  const floor = noiseFloor(db);
  let peak = -Infinity;
  for (const v of db) if (v > peak) peak = v;
  const norm = new Float32Array(db.length);
  for (let i = 0; i < db.length; i++) {
    norm[i] = Math.max(0, Math.min(1, (db[i] - floor) / (peak - floor + 1e-6)));
  }
  let s = 0, e = norm.length - 1;
  while (s < norm.length && norm[s] < 0.15) s++;
  while (e > s && norm[e] < 0.15) e--;
  if (s > e) { s = 0; e = norm.length - 1; }
  return { env: norm.subarray(s, e + 1), start: s };
}

/**
 * 带 Sakoe-Chiba 带约束的 DTW。
 * 带宽限制对齐点只能落在对角线附近：自然语速差异照样能对齐，
 * 但"把句子中段对到另一句开头"这种病态路径被禁止——否则随便读一句都能凑出高分。
 * 返回平均代价 + 对齐路径 + 参考侧覆盖率。
 */
function dtw(n, m, dist) {
  if (!n || !m) return { cost: Infinity, path: [], coverage: 0 };
  const W = m + 1;
  const D = new Float64Array((n + 1) * W).fill(Infinity);
  D[0] = 0;
  const bandFrames = Math.max(2, Math.round(BAND * Math.max(n, m)));
  for (let i = 1; i <= n; i++) {
    const row = i * W, prow = row - W;
    // 对角线中心，映射到 B 上的列范围
    const center = Math.round(i * m / n);
    const jLo = Math.max(1, center - bandFrames);
    const jHi = Math.min(m, center + bandFrames);
    for (let j = 1; j <= m; j++) {
      if (j < jLo || j > jHi) continue;
      const d = dist(i - 1, j - 1);
      D[row + j] = d + Math.min(D[prow + j], D[row + j - 1], D[prow + j - 1]);
    }
  }
  const path = [];
  const seen = new Uint8Array(n);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const cur = D[i * W + j];
    if (!Number.isFinite(cur)) break;      // 带约束下可能走不通，停止回溯
    path.push([i - 1, j - 1]);
    seen[i - 1] = 1;
    const a = D[(i - 1) * W + j], b = D[i * W + j - 1], c = D[(i - 1) * W + j - 1];
    if (c <= a && c <= b) { i--; j--; } else if (b <= a) { j--; } else { i--; }
  }
  path.reverse();
  let covered = 0;
  for (const v of seen) covered += v;
  return {
    cost: path.length ? D[n * W + m] / path.length : Infinity,
    path,
    coverage: covered / n,
  };
}

/** 距离 → 分数：指数衰减，tau 决定宽容度 */
const decay = (cost, tau) => Math.max(0, Math.min(100, 100 * Math.exp(-cost / tau)));

/**
 * 分析一段音频，输出归一化后的韵律特征。
 * 归一化在段内完成，所以结果与学生性别、麦克风距离无关。
 */
export function analyze(pcm, sr = SR) {
  const hop = Math.round(sr * HOP_MS / 1000);
  const win = Math.round(sr * WIN_MS / 1000);
  const db = energyFrames(pcm, sr, hop, win);
  if (db.length < 5) return null;
  const { f0, voiced } = f0Frames(pcm, sr, hop, win);
  const { env, start } = normalizeEnvelope(db);

  // 音高：log-F0 → 减中位数 → 除 MAD，得到与绝对音高无关的"起伏形状"
  const rawLog = new Float32Array(f0.length);
  const voicedVals = [];
  for (let i = 0; i < f0.length; i++) {
    if (voiced[i] && f0[i] > 0) { rawLog[i] = Math.log(f0[i]); voicedVals.push(rawLog[i]); }
    else rawLog[i] = NaN;
  }
  const logf = interpolate(rawLog);
  const { med, scale } = robustStats(voicedVals);
  const pitch = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) {
    const z = (logf[start + i] - med) / scale;
    pitch[i] = Math.max(-PITCH_CLIP, Math.min(PITCH_CLIP, z));
  }

  let voicedFrames = 0;
  for (let i = start; i < start + env.length; i++) voicedFrames += voiced[i];

  // 清浊音密度：对 0/1 做短窗平滑。辅音串的位置与内容相关，
  // 但对音高、音量、音色都不敏感，是少数能反映"读的是不是同一句"的特征。
  const vuSlice = new Float32Array(env.length);
  const VU_SMOOTH = Math.max(1, Math.round(40 / HOP_MS));
  for (let i = 0; i < env.length; i++) {
    let s = 0;
    for (let k = -VU_SMOOTH; k <= VU_SMOOTH; k++) {
      const idx = start + i + k;
      if (idx >= 0 && idx < voiced.length) s += voiced[idx];
    }
    vuSlice[i] = s / (2 * VU_SMOOTH + 1);
  }

  return {
    hop, win, env, pitch, durMs: (pcm.length / sr) * 1000,
    voicedFrames, voicedRatio: voicedFrames / Math.max(1, env.length),
    voicedCount: voicedVals.length,
    pitchMed: med, pitchScale: scale,
    vu: vuSlice,
  };
}

/**
 * 对比参考与学生音频，返回总分 + 分项 + 前端画图用的曲线。
 *
 * 三个韵律通道 + 时长：
 *   音高轮廓 30% —— 语调起伏（减中位数除 MAD 后与音域无关）
 *   能量包络 25% —— 节奏 / 重音分布
 *   清浊模式 30% —— 辅音串位置，与内容相关，用于兜住"读的根本不是这句"
 *   时长完整 15% —— 漏读、拖沓
 *
 * 注意：本评分衡量的是"韵律相似度"，不是发音准确度。
 * 逐音素的发音错误需要 ASR 才能判定，这里不做。
 */
export function scoreAnalysis(ref, stu) {
  if (!ref || !stu) return { ok: false, reason: 'too_short' };
  if (stu.env.length < 5 || stu.voicedCount < 5) return { ok: false, reason: 'no_speech' };

  const n = ref.env.length, m = stu.env.length;
  const pitchD = dtw(n, m, (i, j) => Math.abs(ref.pitch[i] - stu.pitch[j])).cost;
  const envD = dtw(n, m, (i, j) => Math.abs(ref.env[i] - stu.env[j])).cost;
  const vuD = dtw(n, m, (i, j) => Math.abs(ref.vu[i] - stu.vu[j])).cost;
  const joint = dtw(n, m, (i, j) => {
    const a = ref.pitch[i] - stu.pitch[j], b = ref.env[i] - stu.env[j];
    return Math.sqrt(a * a + b * b);
  });

  // 时长比：过短多半漏读，过长多半拖沓。取对数使两侧惩罚对称
  const ratio = stu.durMs / Math.max(1, ref.durMs);
  const durErr = Math.abs(Math.log(Math.max(0.05, Math.min(20, ratio))));

  const pitchScore = decay(pitchD, TAU_PITCH);
  const rhythmScore = decay(envD, TAU_ENV);
  const vuScore = decay(vuD, TAU_VU);
  const completeness = decay(durErr, TAU_DUR);

  let total = W_PITCH * pitchScore + W_RHYTHM * rhythmScore + W_VU * vuScore + W_DUR * completeness;
  // 只读了半句这类情况硬性压分：局部对齐仍可能凑出不错的分项，必须兜住
  if (ratio < 0.6 || ratio > 1.7) total = Math.min(total, 55);
  // 清浊模式差异过大 = 大概率读的不是这句。实测合法变体（换口音/变调/噪声）
  // 最大 0.025，错句最小 0.076，阈值取中间的 0.05，两侧都有 2 倍余量。
  const offTarget = vuD > VU_CAP_COST;
  if (offTarget) total = Math.min(total, 50);

  return {
    ok: true,
    total: round1(total),
    pitch: round1(pitchScore),
    rhythm: round1(rhythmScore),
    fluency: round1(vuScore),
    completeness: round1(completeness),
    offTarget,
    durationRatio: Math.round(ratio * 100) / 100,
    refDurMs: Math.round(ref.durMs),
    stuDurMs: Math.round(stu.durMs),
    rawCost: round1(joint.cost),
    pitchCost: Math.round(pitchD * 1000) / 1000,
    envCost: Math.round(envD * 1000) / 1000,
    vuCost: Math.round(vuD * 1000) / 1000,
    curves: {
      refPitch: downsample(ref.pitch), refEnv: downsample(ref.env),
      stuPitch: downsample(stu.pitch), stuEnv: downsample(stu.env),
    },
  };
}

const round1 = v => Math.round(v * 10) / 10;

/** 曲线降采样，前端画图够用又不至于撑爆 JSON */
function downsample(a, target = 120) {
  if (a.length <= target) return Array.from(a, v => Math.round(v * 1000) / 1000);
  const out = [];
  const step = a.length / target;
  for (let i = 0; i < target; i++) {
    const s = Math.floor(i * step), e = Math.max(s + 1, Math.floor((i + 1) * step));
    let sum = 0;
    for (let j = s; j < e && j < a.length; j++) sum += a[j];
    out.push(Math.round((sum / (e - s)) * 1000) / 1000);
  }
  return out;
}

/** 便捷入口：给两个文件路径直接出分 */
export async function scoreFiles(refFile, stuFile) {
  const [r, s] = await Promise.all([loadAudio(refFile), loadAudio(stuFile)]);
  return scoreAnalysis(analyze(r.pcm, r.sr), analyze(s.pcm, s.sr));
}
