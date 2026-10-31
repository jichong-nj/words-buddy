import crypto from 'node:crypto';
import { config } from '../config.js';
import { nowStr } from '../db/index.js';

export function createSession(db, userId, { remember = false, ip = null } = {}) {
  const id = crypto.randomBytes(32).toString('hex');
  const ttl = remember ? config.session.rememberMs : config.session.ttlMs;
  const expiresAt = nowStr(ttl);
  db.prepare(`INSERT INTO user_session(id,user_id,expires_at,ip) VALUES(?,?,?,?)`)
    .run(id, userId, expiresAt, ip);
  return { id, expiresAt, maxAge: Math.floor(ttl / 1000) };
}

export function readSession(db, id) {
  if (!id) return null;
  const row = db.prepare(`
    SELECT s.id, s.expires_at AS expiresAt, u.id, u.username, u.display_name AS displayName,
           u.role, u.status, u.must_change_pw AS mustChangePw
    FROM user_session s JOIN app_user u ON u.id = s.user_id
    WHERE s.id = ?`).get(id);
  if (!row) return null;
  if (row.expiresAt < nowStr()) {
    db.prepare(`DELETE FROM user_session WHERE id=?`).run(id);
    return null;
  }
  if (row.status !== 'active') return null;   // 停用账号即刻失效（服务端会话的优势）
  return row;
}

export function destroySession(db, id) {
  if (id) db.prepare(`DELETE FROM user_session WHERE id=?`).run(id);
}

export function destroyUserSessions(db, userId) {
  db.prepare(`DELETE FROM user_session WHERE user_id=?`).run(userId);
}

export function cleanupSessions(db) {
  return db.prepare(`DELETE FROM user_session WHERE expires_at < ?`).run(nowStr()).changes;
}
