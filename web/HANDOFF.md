# 前端交接备忘（web-frontend 会话状态快照）

> 供新会话/新模型快速接手。生成于 task-3 完成后，无进行中任务。

## 角色与硬性约束
- 项目：words-buddy（英语练习应用），前端 Vue 3.5 `<script setup>` 纯 JS + Vite 6 + Element Plus 2.14（全量引入 zhCn）+ vue-router 4 + pinia 3。
- **只允许修改 `web/` 目录**；`server/`、`test/`、`docs/`、`README.md` 只读。
- 所有请求走 `web/api.js`（`api.get/post/put/del`、`upload`、`download`），禁止裸 fetch；**不新增依赖、不装图标包**（无 @element-plus/icons-vue，只用文字/emoji）。
- UI 全中文。api.js 会自动 toast 后端 `{code,message}` 错误 → 视图里 catch 一律留空注释 `catch { /* 已提示 */ }`。
- 既有文案「释义填空」「变形填空」不得改动（lead 明确要求）。
- el-radio/el-radio-button 在 EP 2.14 用 `:value` 而非 `label`；布尔查询参数用 '0'/'1' 字符串。

## 任务板（全部 completed）
- task-1 变形填空前端 ✅ rev 3
- task-2 阅读理解练习/题库/错题集/分题型统计 ✅ rev 3
- task-3 变形填空答后展示句子/词义、出题不提示考点 ✅ rev 3（已汇报 lead）

## task-3 改动摘要（构建 ✓ 3.19s）
- `web/views/Transform.vue`：答题卡移除考点标签（只剩原型+答案长度提示）；反馈区依次 = 正确答案 → 完整句子 filled（兜底 `prompt.replace(/_{2,}/, answer)`）→ 句子意思 sentenceCn → 词义 base：wordCn → 考点 point 标签 → 解析 explain；空数据显示「—」。wrongList 每题存 filled/sentenceCn/wordCn/point，结果页错题表「句子」列显示 filled 并新增「句子意思」「词义」列。
- `web/views/TransformBank.vue`：新增/编辑弹窗加「句子翻译」sentenceCn（textarea 2 行）、「词义」wordCn（单行），form/resetForm/save 均带；列表「考点」后加「词义」列；导入弹窗加模板新增「句子翻译」「词义」两列的提示。
- `web/views/RecordDetail.vue`：form_fill 表格「正确答案」后加「句子意思」「词义」列（item.sentenceCn/wordCn）。
- `web/views/Mistakes.vue`：form 错题列表行加「句意/词义」小字（`.cn-line`，v-if 有值才显示）；详情弹窗加「句子意思」「词义：base：wordCn」两行。

## 后端契约要点（5178 端口，admin/admin123，已验证）
- `POST /api/form/sessions` questions 不含 point；`POST .../answer` 返回新增 `filled`/`sentenceCn`/`wordCn`（原 `{seq,isCorrect,answer,accepted,base,point,explain,prompt}` 不变）。
- `GET /api/practice/sessions/:id` form_fill items 与 `GET /api/mistakes` form snapshot 均含 `sentenceCn`/`wordCn`。
- 管理端 form items CRUD + 导入模板支持 `sentenceCn`（表头「句子翻译」）、`wordCn`（表头「词义」）。
- 验证优先用 `buildApp({logger:false, dbFile:tmp}) + app.inject` 冒烟，别用 curl 登录（密码可能被工具遮蔽导致 401 假象）。

## 常用工具函数（web/utils.js）
fmtPct / fmtSec(ms)→"X 分 Y 秒" / fmtClock(sec)→"MM:SS" / qs(params) / BAND_LABELS / BAND_COLORS / POS_OPTIONS / IMPORT_FIELDS。

## 验证方式
`npm run build`（root:'web'，输出 ../dist/web；index chunk >500kB 警告为既有现象，非致命）。

## 已知坑
- `todo_write` 条目只接受 `{content, status}`；bash 调用必须带 description。
- `read` 工具读大文件会截断中段，用 offset/limit 分段读。
- 路由 meta.admin + pinia useAuth{user,isAdmin}；App.vue 菜单 activeMenu 匹配需把长路径（/reading/bank）排在短路径（/reading）前。
