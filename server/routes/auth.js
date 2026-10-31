import { config } from '../config.js';
import { hashPassword, verifyPassword, checkPasswordStrength } from '../lib/password.js';
import { createSession, destroySession, destroyUserSessions } from '../lib/session.js';
import { badRequest, unauthorized, conflict, forbidden, notFound } from '../lib/errors.js';
import { checkLock, noteFailure, clearFailures } from '../lib/auth.js';

const publicUser = u => u && ({
  id: u.id, username: u.username, displayName: u.display_name, role: u.role,
  mustChangePw: !!u.must_change_pw, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at,
});

export async function authRoutes(app) {
  const db = app.db;

  app.get('/api/auth/status', async (req) => {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM app_user`).get().c;
    const me = req.user ? db.prepare(`SELECT * FROM app_user WHERE id=?`).get(req.user.id) : null;
    return { needsSetup: count === 0, user: me ? publicUser(me) : null };
  });

  /** 首次启动：创建第一个管理员账号 */
  app.post('/api/auth/setup', async (req, reply) => {
    const count = db.prepare(`SELECT COUNT(*) AS c FROM app_user`).get().c;
    if (count > 0) throw conflict('already_setup', '系统已初始化，请直接登录');
    const { username, password, displayName } = req.body || {};
    const uname = String(username || '').trim();
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(uname)) throw badRequest('bad_username', '用户名需为 2–32 位字母、数字、_ . -');
    const pw = String(password || '');
    const strength = checkPasswordStrength(pw);
    if (!strength.ok) throw badRequest('weak_password', strength.message);

    const info = db.prepare(`INSERT INTO app_user(username,password_hash,display_name,role) VALUES(?,?,?, 'admin')`)
      .run(uname, hashPassword(pw), String(displayName || uname).trim());
    const sess = createSession(db, info.lastInsertRowid, { ip: req.ip });
    reply.cookie(config.session.cookieName, sess.id, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: Math.floor(sess.maxAge / 1000),
    });
    const user = db.prepare(`SELECT * FROM app_user WHERE id=?`).get(info.lastInsertRowid);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password, remember } = req.body || {};
    const uname = String(username || '').trim();
    if (!uname || !password) throw badRequest('missing_credentials', '请输入用户名和密码');
    checkLock(uname);
    const user = db.prepare(`SELECT * FROM app_user WHERE username=?`).get(uname);
    if (!user || !verifyPassword(String(password), user.password_hash)) {
      noteFailure(uname);
      throw unauthorized('用户名或密码错误');
    }
    if (user.status !== 'active') throw forbidden('account_disabled', '账号已被停用，请联系管理员');
    clearFailures(uname);
    db.prepare(`UPDATE app_user SET last_login_at=datetime('now','localtime') WHERE id=?`).run(user.id);
    const sess = createSession(db, user.id, { remember: !!remember, ip: req.ip });
    reply.cookie(config.session.cookieName, sess.id, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: Math.floor(sess.maxAge / 1000),
    });
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const id = req.cookies?.[config.session.cookieName];
    if (id) destroySession(db, id);
    reply.clearCookie(config.session.cookieName, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/change-password', async req => {
    const me = req.user;
    const { oldPassword, newPassword } = req.body || {};
    const row = db.prepare(`SELECT * FROM app_user WHERE id=?`).get(me.id);
    if (!verifyPassword(String(oldPassword || ''), row.password_hash)) throw badRequest('wrong_password', '原密码不正确');
    const strength = checkPasswordStrength(String(newPassword || ''));
    if (!strength.ok) throw badRequest('weak_password', strength.message);
    if (verifyPassword(String(newPassword), row.password_hash)) throw badRequest('same_password', '新密码不能与原密码相同');
    db.prepare(`UPDATE app_user SET password_hash=?, must_change_pw=0 WHERE id=?`).run(hashPassword(String(newPassword)), row.id);
    // 改密后其他设备下线，当前会话保留
    const keep = req.cookies?.[config.session.cookieName];
    for (const s of db.prepare(`SELECT id FROM user_session WHERE user_id=? AND id<>?`).all(row.id, keep || '')) {
      destroySession(db, s.id);
    }
    return { ok: true };
  });
}

export async function userRoutes(app) {
  const db = app.db;

  app.get('/api/users', { preHandler: app.requireRole('admin') }, async () => {
    const rows = db.prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM practice_session s WHERE s.user_id=u.id) AS sessionCount
      FROM app_user u ORDER BY u.role DESC, u.id`).all();
    return { items: rows.map(u => ({ ...publicUser(u), sessionCount: u.sessionCount })) };
  });

  app.post('/api/users', { preHandler: app.requireRole('admin') }, async req => {
    const { username, password, displayName, role } = req.body || {};
    const uname = String(username || '').trim();
    if (!/^[A-Za-z0-9_.-]{2,32}$/.test(uname)) throw badRequest('bad_username', '用户名需为 2–32 位字母、数字、_ . -');
    if (db.prepare(`SELECT id FROM app_user WHERE username=?`).get(uname)) throw conflict('username_taken', '用户名已存在');
    const strength = checkPasswordStrength(String(password || ''));
    if (!strength.ok) throw badRequest('weak_password', strength.message);
    const r = role === 'admin' ? 'admin' : 'student';
    const info = db.prepare(`INSERT INTO app_user(username,password_hash,display_name,role,must_change_pw) VALUES(?,?,?,?,1)`)
      .run(uname, hashPassword(String(password)), String(displayName || uname).trim(), r);
    return publicUser(db.prepare(`SELECT * FROM app_user WHERE id=?`).get(info.lastInsertRowid));
  });

  app.patch('/api/users/:id', { preHandler: app.requireRole('admin') }, async req => {
    const id = Number(req.params.id);
    const user = db.prepare(`SELECT * FROM app_user WHERE id=?`).get(id);
    if (!user) throw notFoundUser();
    const { displayName, role, status, password } = req.body || {};
    if (role && role !== user.role && user.role === 'admin') {
      const admins = db.prepare(`SELECT COUNT(*) AS c FROM app_user WHERE role='admin' AND status='active' AND id<>?`).get(id).c;
      if (!admins) throw badRequest('last_admin', '系统必须保留至少一个管理员，不能取消最后一个管理员的角色');
    }
    if (status === 'disabled' && user.role === 'admin') {
      const admins = db.prepare(`SELECT COUNT(*) AS c FROM app_user WHERE role='admin' AND status='active' AND id<>?`).get(id).c;
      if (!admins) throw badRequest('last_admin', '系统必须保留至少一个启用的管理员');
    }
    db.prepare(`UPDATE app_user SET display_name=?, role=?, status=? WHERE id=?`).run(
      displayName !== undefined ? String(displayName).trim() : user.display_name,
      role === 'admin' || role === 'student' ? role : user.role,
      status === 'disabled' || status === 'active' ? status : user.status,
      id);
    if (password) {
      const strength = checkPasswordStrength(String(password));
      if (!strength.ok) throw badRequest('weak_password', strength.message);
      db.prepare(`UPDATE app_user SET password_hash=?, must_change_pw=1 WHERE id=?`).run(hashPassword(String(password)), id);
    }
    if (status === 'disabled') destroyUserSessions(db, id);
    return publicUser(db.prepare(`SELECT * FROM app_user WHERE id=?`).get(id));
  });

  app.delete('/api/users/:id', { preHandler: app.requireRole('admin') }, async req => {
    const id = Number(req.params.id);
    const user = db.prepare(`SELECT * FROM app_user WHERE id=?`).get(id);
    if (!user) throw notFoundUser();
    if (id === req.user.id) throw badRequest('self_delete', '不能删除当前登录账号');
    const records = db.prepare(`SELECT COUNT(*) AS c FROM practice_session WHERE user_id=?`).get(id).c;
    if (records > 0) throw conflict('has_records', `该用户有 ${records} 条学习记录，请改为「停用」以保留数据`);
    destroyUserSessions(db, id);
    db.prepare(`DELETE FROM app_user WHERE id=?`).run(id);
    return { ok: true };
  });
}

function notFoundUser() { return notFound('用户不存在'); }
