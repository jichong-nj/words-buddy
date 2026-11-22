/**
 * 音效与动效（零依赖）：
 * - playCorrect(): 答对，「叮咚」上行双音 + 满屏彩带/花瓣粒子烟花
 * - playWrong():  答错，低沉蜂鸣 + 屏幕左右抖动
 * - 尊重系统「减少动态效果」设置；声音可在练习页自行开关（localStorage 记忆）
 */

const KEY = 'wb_sound_enabled';
let audioCtx = null;

export function isSoundEnabled() {
  const v = localStorage.getItem(KEY);
  return v === null ? true : v === '1';
}
export function setSoundEnabled(on) {
  localStorage.setItem(KEY, on ? '1' : '0');
}

function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(ac, { freq, start = 0, dur = 0.22, type = 'sine', gain = 0.16 }) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ac.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** 答对音效：C6 → E6 → G6 快速琶音（清脆、短促） */
export function playCorrectSound() {
  if (!isSoundEnabled()) return;
  const ac = ctx();
  if (!ac) return;
  tone(ac, { freq: 1046.5, dur: 0.16, type: 'sine', gain: 0.12 });
  tone(ac, { freq: 1318.5, start: 0.09, dur: 0.18, type: 'sine', gain: 0.11 });
  tone(ac, { freq: 1568.0, start: 0.18, dur: 0.26, type: 'triangle', gain: 0.09 });
}

/** 答错音效：低频锯齿波短促两声，像「嗡—嗡」 */
export function playWrongSound() {
  if (!isSoundEnabled()) return;
  const ac = ctx();
  if (!ac) return;
  tone(ac, { freq: 130, dur: 0.18, type: 'sawtooth', gain: 0.10 });
  tone(ac, { freq: 110, start: 0.16, dur: 0.22, type: 'sawtooth', gain: 0.09 });
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** 答对：满屏彩带/花瓣粒子（固定定位 canvas，1.8s 后自动移除） */
export function burstConfetti({ count = 90 } = {}) {
  if (reducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'wb-confetti-canvas';
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%',
    pointerEvents: 'none', zIndex: 9999,
  });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx2d = canvas.getContext('2d');
  ctx2d.scale(dpr, dpr);
  document.body.appendChild(canvas);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const colors = ['#ff6b6b', '#ffd93d', '#6bcB77', '#4d96ff', '#c780fa', '#ff9f68', '#5fd3f3'];
  const cx = W / 2;
  const cy = H * 0.34;
  const parts = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.7;
    const speed = 6 + Math.random() * 11;
    return {
      x: cx + (Math.random() - 0.5) * 60,
      y: cy + (Math.random() - 0.5) * 30,
      vx: Math.cos(angle) * speed * (0.7 + Math.random() * 0.8),
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.35,
      color: colors[(Math.random() * colors.length) | 0],
      petal: Math.random() > 0.55,
      life: 0,
    };
  });

  const t0 = performance.now();
  function frame(now) {
    const dt = Math.min(32, now - t0);
    const elapsed = now - t0;
    ctx2d.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.life += 16;
      p.vy += 0.28;
      p.vx *= 0.988;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = elapsed > 1200 ? Math.max(0, 1 - (elapsed - 1200) / 600) : 1;
      ctx2d.save();
      ctx2d.globalAlpha = alpha;
      ctx2d.translate(p.x, p.y);
      ctx2d.rotate(p.rot);
      ctx2d.fillStyle = p.color;
      if (p.petal) {
        ctx2d.beginPath();
        ctx2d.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
        ctx2d.fill();
      } else {
        ctx2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size * 0.6);
      }
      ctx2d.restore();
    }
    if (elapsed < 1800) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

/** 答错：屏幕左右抖动（一次性注入 keyframes） */
export function shakeScreen() {
  if (reducedMotion()) return;
  if (!document.getElementById('wb-shake-style')) {
    const style = document.createElement('style');
    style.id = 'wb-shake-style';
    style.textContent = `
      @keyframes wb-shake {
        0%, 100% { transform: translateX(0) }
        15% { transform: translateX(-9px) }
        30% { transform: translateX(8px) }
        45% { transform: translateX(-6px) }
        60% { transform: translateX(5px) }
        75% { transform: translateX(-3px) }
      }
      body.wb-shaking { animation: wb-shake 0.38s ease-in-out; }
    `;
    document.head.appendChild(style);
  }
  document.body.classList.remove('wb-shaking');
  void document.body.offsetWidth;
  document.body.classList.add('wb-shaking');
  setTimeout(() => document.body.classList.remove('wb-shaking'), 420);
}

/** 答对组合技 */
export function celebrate() {
  playCorrectSound();
  burstConfetti();
}
/** 答错组合技 */
export function oops() {
  playWrongSound();
  shakeScreen();
}
