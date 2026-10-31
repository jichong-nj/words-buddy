# Words Buddy 项目交接备忘（HANDOFF）

> 用于新会话 / 新模型（如本地 200K 上下文模型）快速接手。最后更新于「变形填空答后展示句子与词义」完成后。
> 前端详细交接见 [web/HANDOFF.md](web/HANDOFF.md)。

## 1. 项目是什么

本地运行的英语词汇学习应用（B/S，单机部署）：词库管理 → 三种练习（释义填空 / 变形填空 / 阅读理解）→ 记录、掌握度、分题型统计、错题集。全中文 UI。

- 后端：Node 20+ / Fastify 5 / better-sqlite3（单文件 `data/words.db`）/ exceljs / @fastify/{cookie,multipart,static}
- 前端：Vue 3 + Vite 6 + Element Plus + Pinia + vue-router，构建产物 `dist/web` 由 Fastify 托管
- 启动：`npm start`（默认 0.0.0.0:5178）；演示账号 `admin/admin123`、`student/student123`
- 数据目录 `data/`（words.db、uploads、backups）；schema_version = **4**

## 2. 当前状态（截至 2026-10-31）

| 项 | 数量 / 状态 |
|---|---|
| 词库 | KET 示例 69 词；**PET 完整词库 3018 词**（覆盖剑桥 B1 官方 2739 词条 100%） |
| 释义填空 | 可出题 2510 词 |
| 变形填空 | **4118 题**（83 手工 + 36 时政 + 4000 双语语料生成），全部带「句子翻译 + 词义」 |
| 阅读理解 | **1217 篇 / 4248 题**（17 篇人工整理 + 1200 篇 SQuAD 生成） |
| 练习记录 / 错题 | 服务端判分；错题自动入集，可人工移除/恢复；分题型正确率 |
| 测试 | `npm test` 29/29 通过（unit / api / form / reading） |
| 前端 | 16 个页面，`npm run build` 通过（index chunk >500kB 为既有警告） |
| 服务 | 运行时 pid 写 `/tmp/wb.pid`，日志 `/tmp/wb-server.log` |

## 3. 目录速查

```
server/
  index.js / app.js / config.js
  db/          连接 + migrations（001_init, 002_transform_fill, 003_reading_mistakes, 004_form_meaning）
  lib/         auth、password、session、excel（词库模板）、formexcel、readingexcel、parse、wordnet
  services/    importer、practice（释义填空）、formbank（变形题库）、formpractice、readingbank、readingpractice、mistakes、mastery、stats
  routes/      auth、banks、import、practice/stats、form、reading、mistakes
  seed/        demo-words.csv、pet-words.csv、pet-defs-override.json、form-items*.csv、form-items-cn.json、reading-*.csv、b1-official-words.json
web/           Vue 前端（views/ 16 个页面；api.js 统一请求；router.js 路由与 admin 守卫）
shared/        topic-taxonomy.js（KET 24 / PET 22 主题、词性枚举）
scripts/       db-init、seed-demo、build-pet-bank、fill-defs、check-pet-coverage、build-form-items、build-reading-bank
test/          unit.test.js、api.test.js、form.test.js、reading.test.js
docs/          api-contract.md（唯一契约）、roles-and-permissions.md、wordbank-requirements.md、cambridge-topics.md、roadmap.md
```

## 4. 常用命令

```bash
npm run db:init          # 建库/迁移（幂等）
npm run seed:demo        # 演示账号 + 三个题库（表为空才写，幂等）
npm run bank:pet         # 重建 PET 词库 CSV（--import 直接入库）
npm run bank:check       # 校验 PET 覆盖官方 B1 词表
npm run form:generate    # 用双语语料重建 4000 道变形题（参数见 README）
npm run reading:generate # 用 SQuAD 重建 1200 篇阅读
npm run defs:fill        # 给缺英文释义的义项回填 WordNet
npm test                 # 29 项测试
npm run build            # 前端构建
npm start                # 启动（0.0.0.0:5178）
```

重启服务（勿用 `pkill -f "node server/index.js"`，会杀掉自身 shell）：

```bash
kill $(cat /tmp/wb.pid) 2>/dev/null
nohup node server/index.js > /tmp/wb-server.log 2>&1 &
pgrep -f "node server/index.js" > /tmp/wb.pid
```

## 5. 关键约定与坑（务必遵守）

1. **API 契约以 [docs/api-contract.md](docs/api-contract.md) 为准**，改接口要同步前端与文档。
2. `@fastify/cookie` v11：`reply.cookie/clearCookie` 在 **Reply** 上，`req.cookie` 不存在。
3. `@fastify/multipart` v10：用 `req.parts()`，`req.multipart()` 已移除。
4. CSRF 守卫：POST/PUT/PATCH 必须带 `application/json` 或 `multipart/form-data`；**DELETE 不需要**（前端 `api.del(path)` 可无 body）。
5. 静态托管用 `wildcard:true`（按需读磁盘）：前端重新 build 后无需重启服务；`/assets/*` 缺失返回 404 而不是 index.html。
6. SQLite `data.*` 语义：`practice_item.word_id` 可空；变形题用 `transform_id`，阅读题用 `reading_question_id`，三者互斥。
7. 种子数据「表为空才写」；`seedFormData` / `seedReadingData` 只在表空时导入多个 CSV 文件。
8. 变形填空：**出题不返回 `point`**（避免泄题），判分返回 `filled/sentenceCn/wordCn/point/explain`。
9. WordNet 解析注意：`data.*` 词数是十六进制、offset 各 POS 文件独立、形容词有 `(p)` 标记（均已处理，见 `server/lib/wordnet.js`）。
10. `npm test` 与 curl 登录：**不要用 curl 登录做判断**（工具会遮蔽密码导致 401 假象），用 `buildApp({logger:false,dbFile:tmp}) + app.inject`。
11. 前端只用 `web/api.js`，不新增依赖、不装图标包；`el-radio` 用 `:value`。
12. 数据库 schema 版本断言在 `test/api.test.js`，迁移新增后要同步（当前 4）。

## 6. 已知缺口 / 可继续做

- 自动生成的 4000 道变形题中文译文是人工译文但句子偏口语，建议抽样校对（管理页可逐题改）。
- SQuAD 阅读题难度略高于纯 PET，可按等级/主题再做分层或人工精选。
- 统计页可进一步做「按考点/主题」的正确率细分。
- `STUDENT` 角色不可见管理接口（已后端 403，前端菜单裁剪）。

## 7. 新会话开场建议

把本文件作为第一份上下文：

> 读取 @HANDOFF.md（以及 @web/HANDOFF.md），继续 words-buddy 项目。先跑 `npm test` 与 `npm run build` 确认环境，再开始新需求。
