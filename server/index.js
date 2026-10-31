import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from './app.js';
import { config, ensureDirs } from './config.js';
import { hashPassword } from './lib/password.js';
import { cleanupSessions } from './lib/session.js';
import { seedDemoData, seedDemoUsers, seedFormData, seedReadingData } from '../scripts/seed-demo.js';

async function main() {
  ensureDirs();
  const app = await buildApp();

  if (config.seedDemo) {
    const users = app.db.prepare(`SELECT COUNT(*) AS c FROM app_user`).get().c;
    if (users === 0) {
      const created = seedDemoUsers(app.db);
      const note = [
        '# 演示账号（首次启动自动生成，请尽快修改密码）',
        ...created.map(c => `- ${c.role}: ${c.username} / ${c.password}`),
        '',
        `数据文件：${config.dbFile}`,
      ].join('\n');
      fs.writeFileSync(path.join(config.dataDir, 'DEMO-CREDENTIALS.txt'), note + '\n');
      app.log.info({ created }, '已创建演示账号（详见 data/DEMO-CREDENTIALS.txt）');
    }
    const banks = app.db.prepare(`SELECT COUNT(*) AS c FROM word_bank`).get().c;
    if (banks === 0) {
      const r = await seedDemoData(app.db);
      app.log.info(r, '已导入示例词库');
    }
    const formCount = app.db.prepare(`SELECT COUNT(*) AS c FROM transform_item`).get().c;
    if (formCount === 0) {
      const r = await seedFormData(app.db);
      app.log.info(r, '已导入变形填空内置题库');
    }
    const readingCount = app.db.prepare(`SELECT COUNT(*) AS c FROM reading_passage`).get().c;
    if (readingCount === 0) {
      const r = await seedReadingData(app.db);
      app.log.info(r, '已导入阅读理解内置题库');
    }
  }

  cleanupSessions(app.db);

  await app.listen({ host: config.host, port: config.port });
  const lanIps = Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  app.log.info(`Words Buddy 已启动： http://127.0.0.1:${config.port}` +
    (lanIps.length ? `  （局域网：${lanIps.map(ip => `http://${ip}:${config.port}`).join('、')}）` : ''));

  const stop = async signal => {
    app.log.info(`收到 ${signal}，正在关闭…`);
    try { await app.close(); } catch (e) { app.log.error(e); }
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

main().catch(err => {
  console.error('启动失败：', err);
  process.exit(1);
});
