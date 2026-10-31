import { config } from '../config.js';
import { readSession } from './session.js';
import { unauthorized, forbidden, ApiError } from './errors.js';

const PUBLIC = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/login', '/api/health']);
// DELETE 没有请求体（HTML 表单发不出 DELETE），不需要 JSON 约束；POST/PUT/PATCH 才做 CSRF 校验
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/** 登录失败计数（内存态，重启即清零，本地工具够用） */
const attempts = new Map();

export function checkLock(username) {
  const rec = attempts.get(String(username).toLowerCase());
  if (rec && rec.until > Date.now()) {
    const secs = Math.ceil((rec.until - Date.now()) / 1000);
    throw new ApiError(429, 'locked', `失败次数过多，请 ${secs} 秒后重试`, { retryAfter: secs });
  }
}

export function noteFailure(username) {
  const k = String(username).toLowerCase();
  const rec = attempts.get(k) || { fails: 0, until: 0 };
  rec.fails += 1;
  if (rec.fails >= config.password.maxFail) {
    rec.until = Date.now() + config.password.lockMs;
    rec.fails = 0;
  }
  attempts.set(k, rec);
}

export function clearFailures(username) {
  attempts.delete(String(username).toLowerCase());
}

export function resetAttempts() { attempts.clear(); }

export function registerAuth(app) {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/')) return;          // 静态资源与 SPA 路由放行
    const sess = readSession(app.db, req.cookies?.[config.session.cookieName]);
    req.user = sess ? {
      id: sess.id, username: sess.username, displayName: sess.displayName,
      role: sess.role, mustChangePw: !!sess.mustChangePw,
    } : null;

    if (PUBLIC.has(path)) return;
    if (!req.user) throw unauthorized();

    // CSRF：写接口只接受 JSON（multipart 由 SameSite=Lax 兜底），杜绝跨站简单表单提交
    if (WRITE_METHODS.has(req.method)) {
      const ct = String(req.headers['content-type'] || '');
      if (!ct.includes('application/json') && !ct.includes('multipart/form-data')) {
        throw forbidden('请求格式不正确');
      }
    }
  });

  /** 路由级：preHandler: app.requireRole('admin') */
  app.decorate('requireRole', role => async (req) => {
    if (!req.user) throw unauthorized();
    if (req.user.role !== role) throw forbidden('该操作仅管理员可用');
  });
}
