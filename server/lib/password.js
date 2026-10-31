import crypto from 'node:crypto';

// scrypt 参数：N=2^15, r=8, p=1 —— 零依赖，避免 bcrypt 原生模块编译问题。
// 存储格式：scrypt$N$r$p$salt$hash（均为 base64）
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;   // Node 默认 maxmem 32MB 不够，显式放宽

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [tag, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (tag !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expect = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(password), salt, expect.length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
    });
    return crypto.timingSafeEqual(got, expect);
  } catch {
    return false;
  }
}

/** 弱口令底线：本地学习工具，只挡明显误输，不追求强度 */
export function checkPasswordStrength(pw) {
  const s = String(pw ?? '');
  if (s.length < 4) return { ok: false, message: '密码至少 4 位' };
  if (s.length > 128) return { ok: false, message: '密码过长' };
  return { ok: true };
}
