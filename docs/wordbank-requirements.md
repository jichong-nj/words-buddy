# Words Buddy · 词库管理模块需求设计 v0.1

> 阶段目标：先只做「词库管理 + Excel 导入」这一个闭环，跑通后再叠加背单词/测验等模块。
> 架构：B/S，本地 SQLite 单文件库，完全离线运行。

---

## 1. 模块定位

把外部整理的词表（KET / PET / FCE / 自编词表等 Excel）**批量导入**成本地结构化词库，并提供词库与单词的增删改查、筛选、导出能力。它是后续所有功能（SRS 复习、测验、听力）的数据地基。

### 术语

| 术语 | 含义 |
|---|---|
| 词库 (Word Bank) | 一组单词的集合，如「KET 官方词表」「PET 高频 1200」 |
| 词条 (Word) | 一个单词及其音标、词性、释义、例句、主题等属性 |
| 导入批次 (Import Batch) | 一次 Excel 导入动作，可追溯、可回滚 |
| 归一键 (word_norm) | `lower(trim(word))`，词库内唯一，用于查重与更新 |

---

## 2. 功能清单（按优先级）

### P0（本期必做）

- **F1 词库列表**：卡片/表格展示，显示名称、等级徽章、词数、来源、更新时间。
- **F2 词库 CRUD**：新建（空白 / Excel 导入）、重命名、改描述、复制、归档、删除（二次确认）。
- **F3 Excel 模板下载**：系统生成 `.xlsx` 模板，含表头说明、示例行、词性下拉校验。
- **F4 Excel 导入向导**：上传 → 列映射 → 校验预览 → 确认导入 → 结果页（4 步）。
- **F5 校验报告与错误下载**：逐行错误清单（行号 + 字段 + 原因），可导出「错误报告.xlsx」供人工修正后重传。
- **F6 单词列表**：分页、模糊搜索（单词/释义）、按主题/词性/标签筛选、排序。
- **F7 单词 CRUD**：抽屉式编辑、新增、删除、批量删除、批量打标签。
- **F8 词库导出**：一键导出 `.xlsx`（与模板同构，可改完再导回来）。

### P1（本期可选，结构预留）

- **F9 导入批次管理**：历史批次列表 + **一键回滚**某次导入新增的词。
- **F10 待补充标记**：缺中文释义的词条单独筛出，便于后续补全。
- **F11 CSV 导入**：兼容 UTF-8 / UTF-8-BOM / **GBK**（中文 Excel 另存 CSV 常见 GBK）。
- **F12 数据库备份**：手动导出 `.db` + 每日自动快照保留 7 份。

### P2（后续版本）

- 在线词典 API 补全音标/释义/例句；PDF 词表转 Excel 的辅助脚本；多词库合并去重。

---

## 3. Excel 模板设计

### 3.1 标准列定义

| 列名 | 字段 | 必填 | 自动识别别名（不区分大小写） | 示例 |
|---|---|---|---|---|
| 单词 | `word` | ✅ | word / 单词 / 词汇 / vocabulary / 词汇表 | apple |
| 音标 | `phonetic_uk` | | 音标 / 英式音标 / phonetic / IPA /  KK | /ˈæpl/ |
| 美音 | `phonetic_us` | | 美式音标 / 美音 / US | /ˈæpl/ |
| 词性 | `pos` | | 词性 / POS / part of speech | n. |
| 中文释义 | `def_cn` | 建议 | 释义 / 中文释义 / 意思 / 翻译 / 汉语意思 | 苹果 |
| 英文释义 | `def_en` | | 英文释义 / definition / EN | a round fruit with red or green skin |
| 例句 | `example_en` | | 例句 / example / 例句英文 | I eat an apple every day. |
| 例句翻译 | `example_cn` | | 例句翻译 / 例句中文 / 例句译文 | 我每天吃一个苹果。 |
| 主题 | `topic` | | 主题 / Topic / 分类 / category / 类别 | Food and Drink |
| 标签 | `tags` | | 标签 / tags | 高频,自然拼读 |
| 等级 | `level` | | 等级 / 级别 / level | KET |
| 备注 | `notes` | | 备注 / note / 说明 | 不规则复数 apples |

**字段归属**：`单词 / 音标 / 美音 / 主题 / 标签 / 等级 / 备注` 落在 `word`；`词性 / 中文释义 / 英文释义 / 例句 / 例句翻译` 落在 `word_sense`。

**主题列取值已定稿**：采用**剑桥官方 Topic 体系**（A2 Key 24 项 / B1 Preliminary 22 项，August 2025 版），完整清单、中文对照与校验规则见 [cambridge-topics.md](cambridge-topics.md)。模板中该列做成下拉（数据源为隐藏表 `_dict`，绕开 Excel 内联列表 255 字符上限），值存官方英文名原文；不在枚举内只 warn 不阻断；`level` 非 KET/PET 的词库不校验。

**设计原则**：模板是「推荐格式」而非「强制格式」。用户手上的 KET/PET 表格表头五花八门，所以导入向导第 2 步提供**列映射**：系统按别名自动匹配，匹配不上的让用户用下拉手动指定。只要有一列能映射到「单词」，文件就能导入。

### 3.2 多词性 / 多义项的表达方式（重要）

**结论：一个单词 = 一个词条（`word` 表 1 行），每个「词性 + 释义 + 该义项例句」= 一个义项（`word_sense` 表 N 行）。** 词性属于义项，不属于单词，因此 `word` 表不设 `pos` 字段。

曾考虑的四种方案与取舍：

| 方案 | 结构 | 结论 |
|---|---|---|
| A. 释义字段内换行 | `word.def_cn = "n. 苹果\nv. 吃"` | ❌ 词性与释义脱钩；例句无法绑定义项；编辑要在 textarea 里数行 |
| **B. word + word_sense 一对多** | 词条 1 行，义项 N 行 | ✅ **采用**。义项是出题与复习的最小单位，现在省这张表，将来补要写数据迁移拆已导入的行 |
| C. JSON 列 | `word.senses = '[{...}]'` | ❌ 按义项查询/统计需 `json_each`，难索引，SQL 调试不直观 |
| D. 一行一个「词+词性」 | `UNIQUE(bank_id, word_norm, pos)` | ❌ 音标重复存 N 份；背单词时同一词出现多张卡片，体感差 |

**Excel 中的三种写法（解析器全部支持）**：

```
写法 1  一行一词，「中文释义」单元格内 Alt+Enter 换行，每行带词性前缀
        中文释义: "n. 苹果\nv. [非正式] 吃苹果"

写法 2  一行一义项，同词多行 → 导入时自动合并（默认开启）
        apple | n. | 苹果
        apple | v. | 吃苹果

写法 3  一行一词，多义项用 ； 或 | 分隔
        中文释义: "n. 苹果；v. 吃苹果"
```

**切分规则**：按行首词性前缀正则切分（枚举 `n. v. vt. vi. adj. adv. prep. conj. pron. num. int. aux. modal art. abbr. pl.`，允许 `n./v.` 组合）。切不出前缀时——该行有独立「词性」列则所有义项共用该词性，否则 `pos` 留空，**不做猜测**。

**三个设计细节**：

1. **音标下放到义项但可空**。`record` 名词读 /ˈrekɔːd/、动词读 /rɪˈkɔːd/，KET/PET 确有此类词。`word_sense.phonetic_*` 为空时继承 `word.phonetic_*`，绝大多数词不必填。
2. **`sort = 1` 为主义项**。背单词卡片背面只显示主义项，避免一个词堆五条释义；详情页展开全部。
3. **列表页词性用聚合**：`GROUP_CONCAT(DISTINCT s.pos)` 得到 `n./v.`，不在 `word` 上冗余存储。

**对后续功能的收益**：听音选义的干扰项可从其他词的**同词性**义项中抽取；SRS 进度记在 `word` 级（体感是「这个词熟不熟」），测验题目可下钻到 `sense` 级（名词义已掌握、动词义未掌握）；导出时把 senses 展开成写法 2 的多行，改完再导回仍是同一批词条。


### 3.3 模板文件本身

- 由后端用 ExcelJS 动态生成（`GET /api/import/template?level=KET`），不是静态文件，方便以后按等级带不同预置列。
- 第 1 行表头加粗 + 冻结首行 + 自适应列宽；必填列表头标红。
- 第 2 行灰色斜体「示例行」，导入时自动忽略（识别规则：单词列内容等于示例值）。
- 「词性」列加数据有效性下拉：`n. v. adj. adv. prep. conj. pron. num. int. aux. modal`（允许多个用 `/` 分隔，如 `n./v.`）。

---

## 4. 导入流程（4 步向导）

```
[Step1 选择文件]        [Step2 列映射]         [Step3 校验预览]         [Step4 结果]
 下载模板               选 Sheet               统计卡:总行/有效/重复/错误   导入摘要
 选目标词库             「首行为表头」开关      重复策略单选               下载错误报告
 拖拽/选择 .xlsx         系统字段 ←→ 文件列      前 20 行预览表格           跳转词库
 限制 10MB              别名自动匹配+手动改      错误明细表(行号/原因)
```

**技术处理**：Step1 上传后文件落盘 `data/uploads/<batchId>.xlsx`，返回 `batchId` + 表头行内容 + 自动映射建议；Step3 用当前映射做一次「干跑」解析，把统计与错误写入批次记录（不落 word 表）；Step4 点确认才用同一映射重新解析并在**单个事务**内写库。好处：用户调整映射无需重复上传文件，且预览与实际导入结果一致。

### 4.1 校验规则

| 规则 | 级别 | 处理方式 |
|---|---|---|
| 没有任何列能映射到「单词」 | Error | 拒绝导入 |
| 单词单元格为空 | Error | 该行不导入，记入错误清单 |
| 单词长度 > 64 或含换行/制表符 | Error | 该行不导入 |
| 单词含非字母字符（数字/汉字/符号） | Warn | 仍导入，标记「疑似非单词」 |
| 文件内归一键重复 | Warn | 按「文件内重复策略」处理（默认合并为多义项） |
| 库内归一键已存在 | Warn | 按「库内重复策略」处理 |
| 音标未用 `/…/` 包裹 | Warn | 仍导入，自动补 `/` |
| 词性不在枚举内 | Warn | 仍导入，原样保留（义项级校验） |
| 主题不在官方 Topic 枚举内 | Warn | 仍导入，原样保留；仅当词库 `level` 为 KET/PET 时校验 |
| 义项中文释义为空 | Warn | 该义项仍导入，词条标记「待补充」 |
| 词条无任何有效义项 | Warn | 导入词条本体（仅单词+音标），标记「待补充」 |
| 同词条义项数 > 10 | Warn | 仍导入，提示可能是解析切分错误 |
| 总行数 > 20000 | Error | 拒绝，提示拆分文件 |
| 文件无法解析 / 加密 / 空表 | Error | 拒绝并给出原因 |

### 4.2 重复策略

| 场景 | 可选策略 | 默认 |
|---|---|---|
| 文件内同词多行 | 合并义项 / 保留首行 / 保留末行 / 视为错误 | 合并义项 |
| 库内已存在该词 | 跳过 / **覆盖更新** / 整批中止 | 覆盖更新 |

**关键点 1**：「覆盖更新」走 `UPDATE`（按 `bank_id + word_norm` 命中已有行），词条 `id` 不变。这样将来接 SRS 复习进度、测验成绩时，**更新词库内容不会打断已有的学习进度**（外键指向的 id 保持稳定）。

**关键点 2**：覆盖时义项采用**整组替换**（`DELETE FROM word_sense WHERE word_id=?` 后重新插入），实现最简单、结果最可预期。前提是学习进度只记在 `word` 级。若将来出现引用 `word_sense.id` 的记录（例如错题本按义项记错），需改为按 `(pos, def_cn)` 匹配的增量更新——本期不做，但字段上 `word_sense` 不出现在任何外键目标位置，避免埋雷。

**关键点 3**：导入解析阶段先做**同词合并**再落库：把归一键相同的行聚成一个词条，各行按原顺序生成 `sort = 1..N` 的义项；单词级字段（音标、主题、标签）取该组内第一个非空值。

---

## 5. 数据模型（SQLite）

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 词库
CREATE TABLE word_bank (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  level        TEXT,                              -- KET / PET / FCE / 自定义
  description  TEXT,
  source       TEXT,                              -- 来源：官方词表 / 自编 / 导入文件名
  word_count   INTEGER NOT NULL DEFAULT 0,        -- 冗余计数，导入后重算
  status       TEXT    NOT NULL DEFAULT 'active', -- active / archived
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 词条（一个单词一行；词性/释义/例句在 word_sense）
CREATE TABLE word (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id      INTEGER NOT NULL REFERENCES word_bank(id) ON DELETE CASCADE,
  word         TEXT    NOT NULL,
  word_norm    TEXT    GENERATED ALWAYS AS (lower(trim(word))) STORED,
  phonetic_uk  TEXT,          -- 单词级音标；义项未单独指定时继承它
  phonetic_us  TEXT,
  topic        TEXT,
  tags         TEXT,          -- 逗号分隔
  level        TEXT,
  notes        TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,  -- 待补充标记
  src_row      INTEGER,                      -- 导入时的原始行号，便于回溯
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (bank_id, word_norm)
);
CREATE INDEX idx_word_bank  ON word(bank_id);
CREATE INDEX idx_word_topic ON word(bank_id, topic);
CREATE INDEX idx_word_norm  ON word(word_norm);

-- 义项（一个词性/释义一行，sort=1 为主义项）
CREATE TABLE word_sense (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id      INTEGER NOT NULL REFERENCES word(id) ON DELETE CASCADE,
  pos          TEXT,                         -- n. / vt. / adj. ...
  def_cn       TEXT,
  def_en       TEXT,
  example_en   TEXT,                         -- 例句跟着义项走
  example_cn   TEXT,
  phonetic_uk  TEXT,                         -- 可空，为空则继承 word.phonetic_uk
  phonetic_us  TEXT,                         -- 可空，为空则继承 word.phonetic_us
  sort         INTEGER NOT NULL DEFAULT 1,
  src_row      INTEGER,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_sense_word ON word_sense(word_id, sort);

-- 列表页取主义项 + 聚合词性
--   SELECT w.id, w.word, w.phonetic_uk,
--          s.def_cn AS main_def, s.pos AS main_pos,
--          (SELECT GROUP_CONCAT(DISTINCT s2.pos) FROM word_sense s2
--            WHERE s2.word_id = w.id AND s2.pos IS NOT NULL) AS pos_list
--     FROM word w
--     LEFT JOIN word_sense s ON s.word_id = w.id AND s.sort = 1
--    WHERE w.bank_id = ?;

-- 导入批次
CREATE TABLE import_batch (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id       INTEGER REFERENCES word_bank(id) ON DELETE CASCADE,
  filename      TEXT    NOT NULL,
  stored_path   TEXT,                       -- data/uploads/<id>.xlsx
  sheet_name    TEXT,
  header_row    INTEGER,
  column_map    TEXT,                       -- JSON: 系统字段 -> 文件列
  dup_in_file   TEXT,
  dup_in_bank   TEXT,
  merge_senses  INTEGER NOT NULL DEFAULT 1,
  total_rows    INTEGER DEFAULT 0,
  inserted      INTEGER DEFAULT 0,
  updated       INTEGER DEFAULT 0,
  skipped       INTEGER DEFAULT 0,
  failed        INTEGER DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'preview', -- preview/committed/rolled_back/failed
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  committed_at  TEXT
);

-- 导入错误明细（用于展示 + 生成错误报告 xlsx）
CREATE TABLE import_error (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id  INTEGER NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  row_no    INTEGER NOT NULL,   -- Excel 实际行号（含表头偏移）
  word      TEXT,
  field     TEXT,
  severity  TEXT NOT NULL,      -- error / warn
  code      TEXT NOT NULL,      -- EMPTY_WORD / BAD_PHONETIC / DUP_IN_BANK ...
  message   TEXT NOT NULL
);
CREATE INDEX idx_err_batch ON import_error(batch_id, severity);
```

主题**不建表**：取值是剑桥官方固定枚举（见 [cambridge-topics.md](cambridge-topics.md)），作为代码常量 `shared/topic-taxonomy.ts` 内置，`word.topic` 存官方英文名原文。标签本期用 `DISTINCT` 查询动态聚合，同样不建独立表（数据量小，够用）。

---

## 6. API 设计

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/banks` | 词库列表（含词数、状态筛选） |
| POST | `/api/banks` | 新建空白词库 |
| GET | `/api/banks/:id` | 词库详情 + 统计（主题分布、词性分布、待补充数） |
| PATCH | `/api/banks/:id` | 重命名 / 描述 / 归档 |
| DELETE | `/api/banks/:id` | 删除词库（连带词条） |
| GET | `/api/banks/:id/words` | 单词分页列表：`q, topic, pos, tag, needs, sort, page, size`；每行返回主义项 + 聚合词性 |
| POST | `/api/banks/:id/words` | 新增词条，body 含 `senses: [{pos, def_cn, def_en, example_en, example_cn}]` |
| POST | `/api/banks/:id/words/batch-delete` | 批量删除 |
| GET | `/api/words/:id` | 词条详情，**含全部 senses（按 sort 排序）** |
| PUT | `/api/words/:id` | 编辑词条；`senses` 整组替换（同关键点 2） |
| DELETE | `/api/words/:id` | 删除词条 |
| POST | `/api/banks/:id/words/batch-tag` | 批量打/去标签 |
| GET | `/api/import/template` | 下载 `.xlsx` 模板 |
| POST | `/api/import/preview` | 上传文件 → 建批次 → 返回表头 + 映射建议 + 校验报告 |
| PATCH | `/api/import/:batchId` | 更新映射/Sheet/策略 → 返回新的校验报告 |
| POST | `/api/import/:batchId/commit` | 确认导入（单事务） |
| POST | `/api/import/:batchId/rollback` | 回滚该批次新增的词条 |
| GET | `/api/import/:batchId/errors.xlsx` | 下载错误报告 |
| GET | `/api/banks/:id/export.xlsx` | 导出词库 |
| GET | `/api/meta/topics?bank=:id` | 该库可用主题 `[{key, cn}]`（官方枚举 ∪ 库内实际值）；也可 `?level=KET` 直接取 |
| GET | `/api/meta/tags?bank=:id` | 标签枚举（`DISTINCT` 聚合，供筛选下拉） |

---

## 7. 页面结构

```
/                     首页：词库卡片列表 + 「新建词库」「导入 Excel」
/banks/:id            词库详情：统计条 + 筛选栏 + 单词表格 + 分页 + 批量操作
/import               导入向导（4 步，模态或独立页）
/batches              导入历史（P1）
```

词库详情页表格列：`☐ | 单词 | 音标 | 词性 | 中文释义 | 主题 | 操作(编辑/删除)`，其中**词性与中文释义显示主义项**（`sort=1`），词性列显示聚合的 `n./v.`；释义超长折叠 + 悬浮展开。

点击行展开义项明细，右侧抽屉编辑：

```
apple  /ˈæpl/                                          n./v.
  ① n. 苹果
     I eat an apple every day.  我每天吃一个苹果。
  ② v. [非正式] 吃苹果
```

编辑抽屉用**动态义项块**而非一个大 textarea：每块含词性下拉 + 中文释义 + 英文释义 + 例句 + 例句翻译，可新增、删除、上下移动调整 `sort`；第一块标记为「主义项」。`Ctrl+S` 保存。

---

## 8. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 后端 | Node 24 + **Fastify** | 本机已有 Node 24；Fastify 自带 schema 校验、multipart 插件成熟 |
| 数据库 | **better-sqlite3** | 同步 API、事务极快，5000 行导入 < 200ms；WAL 模式 |
| Excel 读写 | **ExcelJS** | 读写 xlsx 都支持，含样式/列宽/数据有效性下拉（模板和错误报告都要用） |
| 上传 | `@fastify/multipart` | 内存流式接收，限制 10MB |
| CSV 编码 | `iconv-lite` | 处理 GBK / BOM |
| 前端 | Vue 3 + Vite + TS + Element Plus | 表格、分页、上传、抽屉表单等管理台组件开箱即用 |
| 部署 | 前端 `vite build` 产物由 Fastify `@fastify/static` 托管 | 单进程单端口，浏览器开 `http://127.0.0.1:PORT` 即用 |

### ⚠️ Excel 库选型说明（重要）

npm 上的 `xlsx`（SheetJS 社区版）最后版本停在 **0.18.5（2022 年）**，官方已把维护版迁到自己的 CDN，npm 版不再更新；其安全公告（原型污染 GHSA-4r6h-8v6p-xvw6、ReDoS GHSA-5pgg-2g8v-p4x9）标注 **"no fix available"**。我们要解析的是**用户上传的任意 Excel 文件**，属于不可信输入，因此**不用 npm 的 `xlsx`**，改用 ExcelJS（或从 cdn.sheetjs.com 安装维护版）。

参考：[From xlsx to exceljs: when the advisory says "no fix available"](https://sarmalinux.com/blog/xlsx-to-exceljs-no-fix-available)、[SheetJS CDN](https://cdn.sheetjs.com)

---

## 9. 非功能需求

- **完全离线**：不引用任何外网 CDN / API，前端资源全部本地打包。
- **数据文件**：`data/words.db`（SQLite）+ `data/uploads/`（导入原文件，保留最近 20 个批次）+ `data/backups/`。
- **导入上限**：单文件 10MB / 20000 行；超出给出明确提示。
- **中文界面**，时间显示 `YYYY-MM-DD HH:mm`。
- **响应式**：表格在窄屏下折叠次要列（音标/主题），保证手机浏览器可用。
- **删除保护**：删词库需输入词库名确认；导入批次可回滚。

---

## 10. 验收标准（本期完成定义）

1. 下载模板 → 填 3 行数据 → 导入 → 词库详情页能看到这 3 个词，字段无错位。
2. 导入一份表头为 `Word / 中文 / Example` 的非标准表格，通过列映射成功导入。
3. 导入含 5 行错误（空单词、超长、库内重复）的文件：错误行被跳过，结果页显示准确计数，下载的错误报告 xlsx 里能看到行号和原因。
4. 同一文件二次导入且策略选「跳过」：inserted=0，词数不变；选「覆盖」：updated=N，词数不变。
5. 同词多行（`apple n.` / `apple v.`）在开启合并后只生成 **1 个 `word` 行 + 2 个 `word_sense` 行**，`sort` 依次为 1、2，列表页只显示主义项。
6. 释义单元格内写 `"n. 苹果\nv. 吃苹果"`（写法 1）与写两行（写法 2），导入结果完全一致。
7. 编辑抽屉里删除第 2 个义项后保存，`word_sense` 中该词条只剩 1 行且 `sort=1`；词条 `id` 未变。
8. 导出词库 → 修改若干释义 → 再导回，释义被更新且词条 id 未变。
9. 回滚某导入批次后，该批次新增的词消失（连带其义项），原有词不受影响。

---

## 11. 已确认的设计决策（2026-10-30 定稿）

| # | 议题 | 决策 | 影响 |
|---|---|---|---|
| D1 | 词库结构 | **每个词库独立存一份词条** | 沿用第 5 节 DDL：`word.bank_id` + `UNIQUE(bank_id, word_norm)`，不引入全局词条表与关联表。KET/PET 重叠词各存一条，学习进度分开记录。 |
| D2 | 技术栈 | **Vue 3 + Vite + TypeScript + Element Plus**，后端 Fastify | 前端组件用 Element Plus（`el-table` / `el-upload` / `el-drawer` / `el-steps`）；构建产物由 Fastify 静态托管，单端口访问。 |
| D3 | 词表数据来源 | **先内置示例词跑通流程** | 见第 12 节种子数据方案；正式 KET/PET 词表后续由你提供 Excel 或联网整理。 |
| D4 | 库内重复默认策略 | **覆盖更新（UPDATE，词条 id 不变）** | 导入向导第 3 步默认选中「覆盖更新」，仍可切换为跳过 / 整批中止。 |
| D5 | 义项表达 | **`word` + `word_sense` 一对多** | 词性/释义/例句挂在义项上，`word` 表不设 `pos`；详见 §3.2。 |
| D6 | 用户与角色 | **多用户，分 admin / student** | 词库仅 admin 可维护，学生只读；详见 [roles-and-permissions.md](./roles-and-permissions.md)。 |

由此确定的导入默认值：文件内同词多行 → **合并义项**；库内已存在 → **覆盖更新**；同词多行合并开关 → **默认开启**。

### 11.1 权限约束（对应 D6）

词库模块是**管理端功能**，权限边界如下（详见角色文档 §5）：

| 接口 | 所需角色 |
|---|---|
| `POST /api/banks`、`PATCH/DELETE /api/banks/:id` | admin |
| `POST/PATCH /api/import/*`（预览、提交、回滚） | admin |
| `POST/PUT/DELETE` 单词与义项 | admin |
| `GET /api/banks*`、`GET /api/words/:id` | admin（全量） |
| `GET /api/banks*`、`GET /api/words/:id` | admin 与 student 均可（已确认全部词库对学生可见），但 student 响应中剔除 `src_row` / `needs_review` / 批次等管理性字段 |

**连带规则**：存在学习记录的词库**禁止硬删，只能归档**（`status='archived'`），否则级联删除会让学习进度外键悬空。删除确认框需据此分流：有记录 → 只给「归档」按钮。

---

## 12. 种子数据方案（对应 D3）

本期不引入外部词表，改为内置一份演示数据，用于验证导入链路与支撑后续功能开发：

- `server/seed/demo-words.csv`：约 **60 个** KET 高频词（长短词、常见词性均有覆盖），字段齐全（音标、词性、中英释义、例句、主题、标签）。
- 主题列**全部取自剑桥官方 KET Topic 表**（见 [cambridge-topics.md](cambridge-topics.md)），按 **24 个主题均匀分配，每主题 2–3 词**，保证筛选与报表的主题分布图每个主题都有数据。
- 故意埋入 **3 类脏数据**用于测试校验：1 行单词为空、1 行单词超长、2 行同词不同词性（验证多义项合并）。
- 启动时若 `word_bank` 表为空，自动创建演示词库「示例词库 · KET 60 词」并导入上述 CSV；可用环境变量 `SEED_DEMO=0` 关闭。
- 同时用 ExcelJS 生成一份 `docs/templates/词库导入模板.xlsx` 供你手工试传。

---

## 13. 实施顺序（**暂不启动**，待全部模块设计完成后统一开工）

> 见 [roadmap.md](./roadmap.md)：用户仍在设计背单词、练习考试、报表等模块，需求冻结后再开工。

1. 项目脚手架：`server/`（Fastify + better-sqlite3 + 建表迁移）+ `web/`（Vite + Vue3 + TS + Element Plus）+ 根 `package.json` 一键 `dev`。
2. **用户与权限**（新增第 1 步）：建 `app_user` / `user_session`、`/setup` 引导、登录页、`requireRole` 中间件。
3. 数据库建表 + 词库/单词 CRUD API（带 admin 权限校验）。
4. ExcelJS 模板生成 + 导入解析器（列映射、校验、多义项合并、重复策略）+ 导入 API。
5. 前端：登录 → 词库列表页 → 词库详情页 → 导入向导 4 步。
6. 导出 xlsx + 错误报告 + 批次回滚。
7. 种子数据 + 按第 10 节验收标准逐条自测。

---

## 附：原始待议清单（已全部确认，留档）

1. **技术栈**：Vue 3 + Element Plus 可以吗？（也可换 React + Ant Design）
2. **词库是否共享词条**：KET 和 PET 有大量重叠词。
   - A. 每个词库独立存一份（实现简单，词库间互不影响）
   - B. 全局词条表 + 词库关联表（同一单词跨词库共享一份数据，进度只记一次）
3. **词表数据来源**：你手上已有 KET/PET 的 Excel 文件，还是需要我从公开资料整理成 Excel 种子数据？
4. **库内重复默认策略**：默认「覆盖更新」还是默认「跳过」？
