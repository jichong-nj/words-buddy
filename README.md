# Words Buddy 单词伙伴

本地运行的英语词汇学习应用（B/S 架构，单机部署）：**词库管理 → 英文释义填空练习 → 掌握度统计**，全程中文界面。

- 学生：选词库 → 看英文释义写单词 → 看记录与掌握度
- 管理员：建词库、Excel/CSV 导入、行级校验报告、增删改单词、管理账号、查看全员数据
- 数据全部落在本地 SQLite（`data/words.db`），不依赖任何外部服务

## 功能一览

| 模块 | 说明 |
|---|---|
| 词库 | 等级（KET/PET/自定义）、主题分类、标签、单词数与可练习数统计、复制/归档/删除（需输入库名确认） |
| 导入 | 支持 xlsx / csv（含 UTF-8 BOM、GBK）；表头自动识别与手动列映射；文件内同词合并义项；`skip/overwrite/abort` 冲突策略；**预览 → 调整 → 提交 → 回滚**四步；可下载带问题行标注的校验报告 |
| 单词 | 一词多义项（词性、中文释义、英文释义、例句），英文释义来源标记（manual / wordnet），批量打标签/删除，待复核标记 |
| 释义填空 | 看英文释义写单词；同一单词的不同义项都可出题；题干自动给答案词及其变形打码；答案只留在服务端判分；可筛主题/标签/掌握度档位/词长/最近是否练过 |
| 变形填空 | 给带空的句子 + 括号里的原型，填正确变形（时态 / 词性 / 介词 / 比较级等）；**出题不给考点提示，答完后展示：完整句子、整句中文意思、原型词词义、考点与解析**；可按考点/等级/主题筛题；题库 **4118 题**（内置 83 + 时政新闻 36 + 双语语料生成 4000），全部带句子翻译与词义，支持 xlsx/csv 结构化导入与维护 |
| 阅读理解 | 文章 + 4 个单选题的阅读练习，按篇抽题；答完即时给对错与解析；题库支持结构化导入与维护（内置 **1217 篇 / 4248 题**：17 篇百科短文 + 1200 篇 SQuAD 自动生成） |
| 错题集 | 三种题型答错自动入集，记录错次/对次；可按题型筛选，人工移出/恢复；后续答对只累加对次 |
| 分题型统计 | 统计页新增「分题型正确率」：各题型的题数、正确率、错题数，以及最近练习的类型明细 |
| 记录 | 每场练习的题目、作答、耗时、正确率；可回看每道题的题干与答案 |
| 统计 | 总览（累计/今日/学习时长/活跃天数/覆盖率）、掌握度分布、近 30 天趋势、主题维度、薄弱词、单词练习历史、掌握度重算 |
| 账号 | 首次启动引导建管理员；管理员可建学生账号、改密、停用；登录失败 5 次锁定 5 分钟 |

## 技术栈

- 后端：Node.js 20+ · Fastify 5 · better-sqlite3 · exceljs · @fastify/multipart / cookie / static
- 前端：Vue 3 · Vite · Element Plus · Pinia · Vue Router（构建产物由 Fastify 直接托管）
- 英文释义语料：`wordnet-db`（WordNet 3.1 原始词典文件，本地解析，不联网）

## 快速开始

```bash
npm install
npm run db:init        # 建库并执行迁移（可重复执行）
npm run seed:demo      # 可选：写入演示账号 + KET 示例词库
npm run build          # 构建前端到 dist/web
npm start              # http://127.0.0.1:5178
```

首次打开会引导创建管理员账号（也可以直接用演示账号）：

| 账号 | 密码 | 角色 |
|---|---|---|
| `admin` | `admin123` | 管理员 |
| `student` | `student123` | 学生 |

开发模式（前端热更新）：

```bash
npm run dev:server     # 后端 :5178，--watch 自动重启
npm run dev:web        # 前端 :5179，/api 代理到 :5178
```

## 词库数据

### KET 示例词库

`npm run seed:demo` 会从 `server/seed/demo-words.csv` 导入 69 个 KET 高频词，
并故意保留少量脏数据行（空单词、非字母开头、主题拼错等），用来演示导入校验报告。

### PET 词库（覆盖剑桥官方 B1 词表，WordNet 自动生成英文释义）

`server/seed/pet-words.csv` 共 **3028 行**，完整覆盖
[Cambridge B1 Preliminary Vocabulary List (August 2025)](https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf)
的 **2740 个词条**（含 221 个短语、短语动词与语法词），另保留原有 1088 个 PET 常考词/扩展词。

- 词性、中文释义：按官方词表词性 + 高中/CET4 词表释义整理，逐条人工校对短语与功能词
- 主题：官方 Appendix 2 的 22 个 Topic 自动映射（约 1646 条带主题），官方未给主题的词条显示为「未分类」，可在前端补充
- 英文释义与例句：WordNet 自动补齐（含多词短语如 `air conditioning`、`bus stop`），
  查不到或义项不对的 **195 条**由 `server/seed/pet-defs-override.json` 人工校订

```bash
npm run bank:pet                # 生成导入文件 server/seed/pet-bank-import.csv 并打印覆盖率/各主题词数
npm run bank:pet -- --import    # 同时建库（「PET 完整词库 · B1」，level=PET）并导入
npm run bank:pet -- --limit 50  # 只取前 50 行，快速试跑
npm run bank:check              # 校验词表对官方 B1 词条的覆盖率（当前 2738/2739，100%）
```

官方词条快照保存在 `server/seed/b1-official-words.json`（2739 条，含词性），
`npm run bank:check` 会做英美拼写/单复数归并后比对，缺失时会以非零码退出。

WordNet 查询（`server/lib/wordnet.js`）做了两件额外的事：

1. **义项排序**：按 `index.*` 的常用度顺序重排 `data.*` 的义项，避免拿到冷门意思
   （例如 `jacket` 取「短外套」而不是「牙冠」）；
2. **屈折还原**：`children → child`、`boxes → box`、`running → run`，另含常见不规则变化表；
3. **拼写变体与短语**：`second-hand → secondhand`、`colour → color`、多词短语（`bus stop`、`traffic lights`）直接可查。

给已有词库补齐缺失的英文释义（回填后这些词即可进入练习池）：

```bash
npm run defs:fill                  # 预览
npm run defs:fill -- --bank 2 --write
```

## 变形填空题库

题库由三个来源组成（`npm run seed:demo` 或首次启动时自动写入，表为空才写，幂等）：

| 文件 | 题量 | 说明 |
|---|---|---|
| `server/seed/form-items.csv` | 83 | 手工整理：时态/语态/词性/介词/非谓语/比较级/复数/主谓一致；中文翻译见 `form-items-cn.json` |
| `server/seed/form-items-news.csv` | 36 | 时政/新闻风格句子（气候、选举、科技、体育等） |
| `server/seed/form-items-pet.csv` | 4000 | 真实**双语**语料自动生成：从 Tatoeba（eng-cmn）、TED2020、QED 的英中句对里挑出含 PET 词变形的句子，挖空变形、给出原型，**句子翻译取自人工译文** |

每道题除了 `句子/原型/答案/考点` 外，还带 `句子翻译`（整句中文意思）与 `词义`（原型词中文意思），
作答后一并展示；出题阶段不返回考点，避免「复数/比较级」这类提示提前泄题。

自动生成题可以用脚本重建（需要双语语料）：

```bash
# Tatoeba 英文句子 + 英中句对
curl -L -o /tmp/eng_sentences.tsv.bz2   https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2
curl -L -o /tmp/eng_cmn_links.tsv.bz2   https://downloads.tatoeba.org/exports/per_language/eng/eng-cmn_links.tsv.bz2
curl -L -o /tmp/cmn_sentences.tsv.bz2   https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2
# OPUS 英中句对（可选，补充语料）
#   TED2020: https://object.pouta.csc.fi/OPUS-TED2020/v1/moses/en-zh.txt.zip
#   QED:     https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/en-zh.txt.zip

npm run form:generate -- \
  --sentences /tmp/eng_sentences.tsv.bz2 \
  --zh-links /tmp/eng_cmn_links.tsv.bz2 \
  --zh-sentences /tmp/cmn_sentences.tsv.bz2 \
  --require-zh --limit 4000 \
  --opus /tmp/TED2020.en-zh.en:/tmp/TED2020.en-zh.zh,/tmp/QED.en-zh.en:/tmp/QED.en-zh.zh
```

生成逻辑：PET 词表 → 词形规则（复数、三单、-ed/-ing、-er/-est、形容词变副词、不规则动词）+ 句子词汇/上下文过滤，
挖掉原句中的变形词并给出原型；中文翻译直接取句对里的中文侧（繁体经 OpenCC 映射转简体），`wordCn` 取 PET 词表释义；
题目 `notes` 里保留语料 id（Tatoeba CC BY 2.0 / TED CC BY-NC-ND / QED），`tags` 标注「自动生成」。

题目模型：`句子`（含 `____`）+ `原型` + `答案`（可多个，用 `|` 分隔）+ 可选的可接受答案 / 考点 / 等级 / 主题 / 标签 / 解析。

```bash
npm run seed:demo          # 首次启动或手动执行：写入内置变形题库
npm run dev:server         # 管理员登录后在「变形题库」页面导入/新增/编辑/删除
```

导入模板列（也可用 API `GET /api/form/template` 下载带下拉的 xlsx）：

| 句子 | 原型 | 答案 | 可接受答案 | 考点 | 等级 | 主题 | 标签 | 解析 | 备注 |
|---|---|---|---|---|---|---|---|---|---|
| I ____ school at eight yesterday. | arrive | arrived at | arrived | 时态 | PET | Places: Buildings | 一般过去时 | yesterday 表示过去 | |

- 空位统一写成 `____`（也接受 `___`、`（）`、`{}`、`{blank}`），句子里的 `(arrive)` 括号提示会自动去掉
- 同一「句子 + 原型」唯一；重复导入可选跳过或覆盖
- 导入分两步：先 `dryRun=1` 预览校验（错误/警告逐行列出），确认后再落库
- 判分忽略大小写、多余空格、统一引号，并去掉句末标点；`arrived at` 与 `arrived at.` 都能判对
- 练习记录会同时出现在「练习记录」里，用「类型」列区分释义填空 / 变形填空

## 阅读理解题库

题库由两部分组成（`npm run seed:demo` 或首次启动自动写入，表为空才写）：

| 文件 | 篇数 / 题数 | 说明 |
|---|---|---|
| `server/seed/reading-passages.csv` | 17 / 68 | 人工整理：改写自 [Simple English Wikipedia](https://simple.wikipedia.org)（CC BY-SA 4.0），每篇 4 题 |
| `server/seed/reading-squad.csv` | 1200 / 4180 | 由 [SQuAD 1.1](https://rajpurkar.github.io/SQuAD-explorer/)（Wikipedia，CC BY-SA 4.0）自动生成：人工标注的「问题 + 原文答案跨度」转成四选一，干扰项取同篇的日期/数字/实体 |

共 **1217 篇 / 4248 题**，覆盖运动、环境、科技、教育、健康、饮食、交通、城市、自然、天气、工作等主题。
自动生成篇目标注 `标签=自动生成;SQuAD`、`来源=SQuAD 1.1…`，可按标签筛选或批量清理。

```bash
# 重新生成 SQuAD 阅读题（可选，需要先下载数据集）
curl -L -o /tmp/squad-train.json https://rajpurkar.github.io/SQuAD-explorer/dataset/train-v1.1.json
npm run reading:generate -- --squad /tmp/squad-train.json --limit 1200

npm run seed:demo          # 首次启动自动写入（17 + 1200 篇）
```

生成规则：文章 320–1400 字符、3–14 句；非专有名词词汇至少 82% 落在 PET+常用词表内；题干保留 SQuAD 原问题；
正确答案取原标注跨度；干扰项优先取同篇的其它答案/实体/数字，不够再补全库同类型答案；解析自动摘出答案所在原句。

导入格式：**一行一道题**，同一「标题」的多行合并成一篇，正文只在首行填写：

| 标题 | 正文 | 等级 | 主题 | 标签 | 来源 | 题号 | 题干 | 选项A | 选项B | 选项C | 选项D | 正确答案 | 解析 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A Day at the Beach | Last Saturday Anna… | PET | Travel and Transport | 故事 | 自编 | 1 | Where did Anna go? | To the beach | To school | To the cinema | To the park | A | 第一句… |

- 正确答案写 A/B/C/D（也接受 1-4 或选项原文）
- 同一标题重复导入：`skip` 跳过 / `overwrite` 覆盖
- 管理端支持：预览校验 → 落库、下载模板、导出、单篇编辑/删除/批量删除

## 错题集与分题型统计

- 答错自动进入错题集（`qtype` = definition / form / reading），记录错次、对次、最近答错时间
- 后续答对只累加对次，题目仍保留在错题集；可人工「移出错题集」，之后再次答错会重新出现
- 每道错题带题干快照（原文、选项、正确答案、解析），题目被删也能回看
- 统计页的「分题型正确率」来自 `GET /api/stats/by-type`，包含三种题型的题数/正确率/错题数与最近练习明细

## 导入文件格式

模板列（顺序不限，表头可用中文名或英文字段名，`GET /api/import/template` 可下载带下拉的 xlsx）：

| 单词 | 音标 | 美音 | 词性 | 中文释义 | 英文释义 | 例句 | 例句翻译 | 主题 | 标签 | 等级 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| apple | /ˈæpl/ | | n. | 苹果 | a round fruit with red or green skin | I ate an apple. | 我吃了一个苹果。 | Food and Drink | 水果 | KET | |

- 一格内可用换行、`；`、`|` 分隔多个义项；每个义项可自带 `n./v./adj.` 前缀，也可只在「词性」列写一次
- `英文释义` 是练习题干来源：长度 ≥ 8 且单词为纯字母、长度 4–12 的义项才会进入练习池
- 主题填官方 Topic key（`GET /api/meta/topics?level=PET`），不在表内只报警告；单词不是字母开头也只报警告
- 文件内重复单词默认合并义项；与库内重复单词按 `dupInBank` 策略处理

## 判分与掌握度

- 判分在服务端完成：忽略大小写与首尾空格，严格匹配词的原形（题干里出现过的变形会被打码提示）
- 单题掌握度分值 0–100，按指数加权（新题答对 70、答错 20，之后 `新分 = 旧分×0.65 + 本次×0.35`）
- 档位：`new` 未接触 / `weak` 薄弱 / `fuzzy` 模糊 / `known` 已掌握（≥70）/ `mastered` 精通（≥85 且连对 ≥3）
- 掌握度是派生数据，可用 `POST /api/stats/recompute` 从作答明细全量重算

## 目录结构

```
server/
  index.js            启动入口（迁移 + 可选种子 + 监听）
  app.js              buildApp()：插件注册、鉴权钩子、静态托管与 SPA 回退
  config.js           环境变量与默认配置
  db/                 SQLite 连接与 migrations/*.sql
  lib/                auth 会话/锁定、密码 scrypt、Excel 读写、行解析、WordNet 查询、变形题模板
  services/           importer（词库导入四步）、practice（释义填空判分）、formbank（变形题库）、
                      formpractice（变形填空判分）、readingbank（阅读题库）、readingpractice（阅读判分）、
                      mistakes（错题集/分题型统计）、mastery、stats
  routes/             auth/users、banks/words、import、practice/stats、form、reading、mistakes
  seed/               演示词表、PET 词表、PET 人工释义覆盖、变形填空题库（内置/时政/生成/中文对照）、阅读题库
web/                  Vue 3 前端源码（16 个页面）
shared/               topic-taxonomy.js：KET/PET 官方主题与词性枚举（前后端共用）
scripts/              db-init、seed-demo、build-pet-bank、fill-defs
test/                 unit.test.js（纯函数）、api.test.js（inject 全流程）、form.test.js（变形填空）、reading.test.js（阅读理解/错题集）
dist/web/             前端构建产物（由 Fastify 托管）
data/                 运行期数据：words.db、uploads/、backups/
docs/                 API 契约、角色权限、词库需求、路线图
```

## 测试

```bash
npm test
```

- `test/unit.test.js`：解析、变形、打码、档位、WordNet 查询与主题表
- `test/api.test.js`：临时库跑完整流程（初始化 → 登录 → 建库 → 导入预览/提交/回滚 → 练习 → 统计 → 权限 → SPA 回退），
  使用 `app.inject()`，不占端口、不联网

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `5178` | 监听地址；默认监听所有网卡，本机 `http://127.0.0.1:5178`、手机/局域网用 `http://<本机IP>:5178`（只想本机访问可设 `HOST=127.0.0.1`） |
| `DATA_DIR` | `./data` | 数据根目录 |
| `DB_FILE` | `$DATA_DIR/words.db` | SQLite 文件路径 |
| `SEED_DEMO` | `1` | 启动时是否补齐演示数据（`0` 关闭） |
| `PRAC_MIN_LEN` / `PRAC_MAX_LEN` | `4` / `12` | 可出题的单词长度区间 |

## 文档

- [API 契约](docs/api-contract.md)
- [角色与权限](docs/roles-and-permissions.md)
- [词库需求](docs/wordbank-requirements.md)
- [主题分类来源](docs/cambridge-topics.md)
- [路线图](docs/roadmap.md)
