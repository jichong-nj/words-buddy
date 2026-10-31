# API 契约 v1（实现基准）

> 本文件是前后端唯一契约。后端已按此实现，前端按此对接。改任何一条都要两边同步改。

## 通用约定

- 全部接口前缀 `/api`，请求/响应均 `application/json`（文件上传用 `multipart/form-data`，下载返回二进制）。
- 认证：HttpOnly Cookie `wb_session`，`SameSite=Lax`。前端用 `fetch(url, {credentials:'same-origin'})` 即可，无需带 token。
- 未登录访问受保护接口 → `401 {code:"unauthorized"}`；角色不足 → `403 {code:"forbidden"}`。
- 错误统一：`{ code, message, details? }`，HTTP 状态码语义正确。
- 分页：`?page=1&size=20`（size 上限 100），返回 `{ total, page, size, items }`。
- 时间：字符串 `YYYY-MM-DD HH:MM:SS`（本地时区）。
- 布尔：0/1。

## 角色

`admin` 可读写全部；`student` 只读词库、只能读写自己的练习数据。
学生响应中**不含** `src_row` / `needs_review` / 批次等管理字段。

---

## 1 认证与用户

| 方法 | 路径 | 角色 | 请求 | 响应 |
|---|---|---|---|---|
| GET | `/api/auth/status` | 公开 | – | `{needsSetup:boolean, user:{id,username,displayName,role,mustChangePw}\|null}` |
| POST | `/api/auth/setup` | 公开(仅当无用户) | `{username,password,displayName?}` | `{user}` 并写入 cookie |
| POST | `/api/auth/login` | 公开 | `{username,password,remember?}` | `{user}` |
| POST | `/api/auth/logout` | 登录 | – | `{ok:true}` |
| POST | `/api/auth/change-password` | 登录 | `{oldPassword,newPassword}` | `{ok:true}` |
| GET | `/api/users` | admin | – | `{items:[{id,username,displayName,role,status,lastLoginAt,createdAt}]}` |
| POST | `/api/users` | admin | `{username,password,displayName?,role}` | `{user}` |
| PATCH | `/api/users/:id` | admin | `{displayName?,role?,status?,password?,mustChangePw?}` | `{user}` |
| DELETE | `/api/users/:id` | admin | – | `{ok:true}`（有学习记录时 409，应改 status=disabled） |

登录失败 5 次锁定 5 分钟 → `429 {code:"locked"}`。密码最短 4 位。

## 2 词库

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/banks` | 全部 | `{items:[{id,name,level,description,wordCount,status,updatedAt,senseCount,defEnCount,practiceable}]}` |
| POST | `/api/banks` | admin | `{name,level?,description?,source?}` → `{bank}` |
| GET | `/api/banks/:id` | 全部 | `{bank}` 含同上统计字段 |
| PATCH | `/api/banks/:id` | admin | 同 POST 字段 → `{bank}` |
| POST | `/api/banks/:id/copy` | admin | `{name}` → `{bank}` |
| DELETE | `/api/banks/:id` | admin | body `{confirmName}` 必须等于库名；有学习记录 → 409 |

## 3 单词

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/banks/:id/words` | 全部 | query `q,topic,tag,pos,needs(0/1),page,size` → `{total,page,size,items:[{id,word,phoneticUk,mainPos,mainDef,mainDefEn,posList,topic,tags,level,needsReview,senseCount}]}` |
| POST | `/api/banks/:id/words` | admin | `{word,phoneticUk?,phoneticUs?,topic?,tags?,level?,notes?,senses:[{pos?,defCn?,defEn?,exampleEn?,exampleCn?,sort?}]}` → `{word:{id}}` |
| GET | `/api/words/:id` | 全部 | 扁平对象：`{id,bankId,bankName,word,phoneticUk,phoneticUs,topic,tags,level,notes,needsReview,createdAt,updatedAt,senses:[{id,pos,defCn,defEn,defEnSource,exampleEn,exampleCn,sort}]}`（`senses` 在顶层，没有 `word` 包一层） |
| PUT | `/api/words/:id` | admin | 同 POST，`senses` 整体替换 |
| DELETE | `/api/words/:id` | admin | → `{ok:true}` |
| POST | `/api/banks/:id/words/batch-delete` | admin | `{ids:[...]}` → `{deleted}` |
| POST | `/api/banks/:id/words/batch-tag` | admin | `{ids,add:[],remove:[]}` → `{updated}` |

`tags` 是逗号分隔字符串。

## 4 元数据

- `GET /api/meta/topics?bank=:id` 或 `?level=KET` → `{items:[{key,cn}], taxonomy:boolean}`；`taxonomy:false` 表示该库等级不在 KET/PET 体系内，前端主题输入应允许自由填写
- `GET /api/meta/tags?bank=:id` → `{items:[{tag,count}]}`

## 5 导入 / 导出

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/import/template?level=KET` | admin | 下载 xlsx |
| POST | `/api/import/preview` | admin | multipart：`file`,`bankId`,`sheet?`,`headerRow?`,`columnMap?`(JSON 串),`dupInFile?`,`dupInBank?`,`mergeSenses?` → `{batchId,sheets,sheet,headerRow,headers,rows:[{rowNo,word,senses:[...]}],suggestedMap,map,errors:[{rowNo,field,severity,code,message}],stats:{totalRows,validRows,errorRows,warnRows},preview:[前50行结果]}` |
| PATCH | `/api/import/:batchId` | admin | 同 preview 的选项字段（无需重传文件）→ 同 preview 响应 |
| POST | `/api/import/:batchId/commit` | admin | → `{inserted,updated,skipped,failed}` |
| POST | `/api/import/:batchId/rollback` | admin | → `{removed}` |
| GET | `/api/import/:batchId/errors.xlsx` | admin | 下载错误报告 |
| GET | `/api/banks/:id/export.xlsx` | admin | 下载词库 |
| GET | `/api/batches?bank=:id` | admin | `{items:[{id,bankId,filename,totalRows,inserted,updated,skipped,failed,status,createdAt,committedAt}]}` |

`columnMap` 形如 `{"单词":"word","中文释义":"def_cn",...}`（Excel 列名 → 字段名）。
`stats` 还带 `newWords` / `existingWords`；`rows` 里每条含 `senses:[{pos,defCn,defEn}]`；`preview` 是解析后的记录（含 `wordNorm`、`needsReview` 等），提交时会按同一逻辑重算。
`dupInFile`: `merge_senses`(默认)\|`keep_first`\|`keep_last`\|`error`
`dupInBank`: `skip`\|`overwrite`(默认)\|`abort`

## 6 练习（英文释义填空）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/practice/pools` | 全部 | `{items:[{bankId,bankName,level,total,answerable,byBand:{new,weak,fuzzy,known,mastered}}]}` |
| POST | `/api/practice/sessions` | 全部 | `{bankId,count=20,topics?[],tags?[],bands?[],wordIds?[],minLen?,maxLen?,excludeRecentDays?}` → `{sessionId,total,questions:[{seq,stem,hint,length,topic,mainPos,masked}]}` **不含答案** |
| POST | `/api/practice/sessions/:id/answer` | 全部 | `{seq,given,latencyMs?}` → `{seq,isCorrect,answer,accepted:[...],stem,mastery:{score,band,attempts,correct,streak}}`；同题重复作答 409 |
| POST | `/api/practice/sessions/:id/finish` | 全部 | `{}` → `{sessionId,total,correct,score,durationMs}` |
| GET | `/api/practice/sessions` | 全部 | query `page,size,bankId?,userId?(admin)` → `{total,page,size,items:[{id,bankId,bankName,mode,total,correct,score,startedAt,finishedAt}]}` |
| GET | `/api/practice/sessions/:id` | 全部(仅本人或 admin) | `{session,items:[{seq,stem,given,isCorrect,answer,accepted,latencyMs,answeredAt,word,defEn}]}` |

`stem` 已把答案词在释义中打码，例如 `a person who p______ pictures`；
`hint` 是 `p_____`（首字母 + 剩余位数下划线）。判分在服务端，忽略大小写与首尾空格。

练习会话有两种 `mode`：`definition_fill`（释义填空，本节的接口）与 `form_fill`（变形填空，见 §7）。
两种模式都写入 `practice_session`，所以练习记录列表 `/api/practice/sessions` 会同时包含二者；
`/api/practice/sessions/:id` 的 `session.mode` 决定 `items` 的字段结构（变形题见 §7 说明）。

## 7 变形填空（form_fill）

给一个带 `____` 的句子 + 括号里的原型，让用户填正确变形（时态 / 词性 / 介词 / 比较级等），例如
`I ____ school at eight yesterday.`（原型 arrive）→ `arrived at`。

### 7.1 练习（全部登录用户）

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/form/pools` | 全部 | `{total,mode:"form_fill",byPoint:[{point,count}],byLevel:[{level,count}],byTopic:[{topic,count}]}` |
| POST | `/api/form/sessions` | 全部 | `{count=10,points?[],levels?[],topics?[],excludeRecentDays?}` → `{sessionId,mode,total,questions:[{seq,prompt,base,topic,length}]}` **不含答案，也不返回 point（考点）**，避免出题时提示「复数/比较级」 |
| POST | `/api/form/sessions/:id/answer` | 全部 | `{seq,given,latencyMs?}` → `{seq,isCorrect,answer,accepted:[...],base,point,explain,prompt,filled,sentenceCn,wordCn}`；同题重复作答 409 |

`answer` 返回里：`filled` 是把答案填回空位后的完整句子，`sentenceCn` 是整句中文意思，`wordCn` 是原型词中文意思 —— 用于作答后展示；
`point`（时态/复数/比较级等考点）只在判分后返回。
| POST | `/api/form/sessions/:id/finish` | 全部 | `{}` → `{sessionId,total,correct,score,durationMs}` |

判分：`given` 先做归一化（转小写、合并空格、统一引号、去句末标点），再与 `accepted` 列表逐条比较；
`accepted` 至少包含首选答案 `answer`。

### 7.2 题库维护（仅管理员）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/form/items?q=&point=&topic=&level=&tag=&needs=0\|1&page=&size=` | `{total,page,size,items:[{id,prompt,base,answer,accepted[],point,level,topic,tags,explain,sentenceCn,wordCn,notes,needsReview,createdAt,updatedAt}]}` |
| GET | `/api/form/items/:id` | 同上单条 |
| POST | `/api/form/items` | `{prompt,base,answer,accepted?[],point?,level?,topic?,tags?,explain?,sentenceCn?,wordCn?,notes?,needsReview?}` → 单条 |
| PUT | `/api/form/items/:id` | 同上字段（可部分）→ 单条 |
| DELETE | `/api/form/items/:id` | `{ok:true}`（DELETE 不需要请求体） |
| POST | `/api/form/items/batch-delete` | `{ids:[...]}` → `{deleted}` |
| GET | `/api/form/stats` | `{total,byPoint[],byTopic[],byLevel[]}` |
| GET | `/api/form/template` | 下载导入模板 xlsx |
| GET | `/api/form/export.xlsx` | 下载题库 xlsx（列与模板一致，可再导入） |
| POST | `/api/form/import` | multipart：`file`,`dryRun`(1 预览/0 落库),`onDuplicate`(skip\|overwrite),`sheet?`,`headerRow?` → `{stats:{totalRows,validRows,errorRows,warnRows,inserted,updated,skipped},errors:[{rowNo,base,severity,field,code,message}],rows,headers,map}` |

导入列（表头可用中文名或英文字段名）：
`句子`(必填，含 `____`)、`原型`(必填)、`答案`(必填，多个用 `\|` 分隔)、`可接受答案`、`考点`、`等级`、`主题`、`标签`、`句子翻译`、`词义`、`解析`、`备注`。
同一「句子 + 原型」唯一；`dryRun=1` 只校验不写库，`onDuplicate=skip` 跳过、`overwrite` 覆盖更新。

### 7.3 练习记录

变形练习的会话写入 `practice_session(mode='form_fill', bank_id=NULL)`，
因此同样出现在 `/api/practice/sessions`（`bankId/bankName` 为 `null`，用 `mode` 区分）。
`GET /api/practice/sessions/:id` 在 `mode==='form_fill'` 时 `items` 为：

`{seq,prompt,base,given,isCorrect,answer,accepted[],point,explain,sentenceCn,wordCn,latencyMs,answeredAt}`

## 8 阅读理解

一篇文章 + 若干单选题（每篇通常 4 题）。练习按「篇」抽题，会话写入 `practice_session(mode='reading', bank_id=NULL)`。
内置题库 1217 篇 / 4248 题（17 篇人工整理 + 1200 篇 SQuAD 自动生成）。

### 8.1 练习（全部登录用户）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reading/pools` | `{passages,questions,byTopic:[{topic,count}],byLevel:[{level,count}],byTag:[{tag,count}]}` |
| POST | `/api/reading/sessions` | `{passages=2,levels?[],topics?[],tag?,excludeRecentDays?}` → `{sessionId,mode:"reading",total,passages:[{passageId,title,text,level,topic,source,questions:[{seq,questionId,stem,options[]}]}]}` **不含答案** |
| POST | `/api/reading/sessions/:id/answer` | `{seq,choice:0-3,latencyMs?}` → `{seq,isCorrect,answerIndex,answerText,explain,options,chosenIndex}`；同题重复作答 409 |
| POST | `/api/reading/sessions/:id/finish` | `{}` → `{sessionId,total,correct,score,durationMs}` |

### 8.2 题库维护（仅管理员）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/reading/passages?q=&topic=&level=&tag=&needs=0\|1&page=&size=` | `{total,page,size,items:[{id,title,text,level,topic,tags,source,wordCount,needsReview,questionCount,...}]}` |
| GET | `/api/reading/passages/:id` | 单篇 + `questions:[{id,seq,stem,options[],answerIndex,explain}]` |
| POST | `/api/reading/passages` | `{title,text,level?,topic?,tags?,source?,questions:[{seq?,stem,options[4],answerIndex,explain?}]}` |
| PUT | `/api/reading/passages/:id` | 同上（可部分；传 questions 则整体替换） |
| DELETE | `/api/reading/passages/:id` | `{ok:true}` |
| POST | `/api/reading/passages/batch-delete` | `{ids:[]}` → `{deleted}` |
| GET | `/api/reading/template` | 下载导入模板 xlsx |
| GET | `/api/reading/export.xlsx` | 下载题库 xlsx（可再导入） |
| POST | `/api/reading/import` | multipart：`file`,`dryRun`(1/0),`onDuplicate`(skip\|overwrite，按标题),`sheet?`,`headerRow?` → `{stats:{totalRows,validRows,errorRows,warnRows,inserted,updated,skipped,questions},errors,rows,headers,map}` |

导入格式：**一行一道题**，同一「标题」的多行合并成一篇文章（正文填首行即可）。
列：`标题`(必填)、`正文`(首篇行必填)、`等级`、`主题`、`标签`、`来源`、`题号`、`题干`(必填)、`选项A`~`选项D`(4 个都必填)、`正确答案`(A/B/C/D)、`解析`、`备注`。
同一标题重复导入：`skip` 跳过、`overwrite` 覆盖（题目整体替换）。

### 8.3 记录

`GET /api/practice/sessions/:id` 在 `mode==='reading'` 时 `items` 为：
`{seq,stem,options[],chosenIndex,isCorrect,answerText,answerIndex,explain,passageTitle,passageText,latencyMs,answeredAt,questionId}`

## 9 错题集

答错自动入集；答对只累加 `right_count`（不会把没错过的题加进来）；人工可移出/恢复。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/mistakes?type=&q=&page=&size=&removed=0\|1` | `{total,page,size,items:[{id,qtype,qtypeLabel,refId,wrongCount,rightCount,lastWrongAt,lastRightAt,removed,snapshot,...}],summary:{total,byType:[{qtype,label,count,wrongs,rights}]}}` |
| GET | `/api/mistakes/summary` | 单独取 summary |
| GET | `/api/mistakes/:id` | 单条 |
| POST | `/api/mistakes/remove` | `{ids:[]}` → `{removed}`（removed=1，可恢复） |
| POST | `/api/mistakes/restore` | `{ids:[]}` → `{restored}` |

`qtype`：`definition`（释义填空）/ `form`（变形填空）/ `reading`（阅读理解）。
`snapshot` 按题型：
- definition：`{word,stem,defCn,pos,answer}`
- form：`{prompt,base,answer,point,explain,sentenceCn,wordCn}`
- reading：`{passageTitle,passageText,stem,options,answerIndex,answerText,explain}`

## 10 统计与掌握度

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | `/api/stats/overview` | 全部 | `{sessions,itemsAnswered,accuracy,studyMs,todayAnswered,todayAccuracy,wordsPracticed,totalWords,coverage,activeDays,byBand:{new,weak,fuzzy,known,mastered}}` |
| GET | `/api/stats/mastery?bank=&band=&q=&page=&size=` | 全部 | 分页单词列表 `{total,page,size,items:[{wordId,word,topic,defCn,defEn,attempts,correct,score,band,streak,lastAt}]}`（不是档位计数，档位计数在 overview.byBand） |
| GET | `/api/stats/weak-words?bank=&limit=20` | 全部 | `{items:[同上字段]}`，只含 `weak`/`fuzzy` |
| GET | `/api/stats/topic?bank=` | 全部 | `{items:[{topic,words,practiced,avgScore}]}` |
| GET | `/api/stats/daily?days=30` | 全部 | `{items:[{day,answered,correct,accuracy}]}`，补零到连续 N 天 |
| GET | `/api/stats/words/:wordId` | 全部 | `{word:{id,word,bankId,bankName,topic,tags,phoneticUk,phoneticUs},senses:[...],mastery:{attempts,correct,score,band,streak,lastAt}\|null,items:[{seq,given,isCorrect,stem,answeredAt,sessionId,latencyMs}]}` |
| POST | `/api/stats/recompute` | admin | 全量重算掌握度 → `{updated}` |
| GET | `/api/stats/by-type` | 全部 | 分题型统计 `{items:[{type,label,sessions,items,correct,accuracy,lastAt,mistakes}],total:{items,correct,accuracy,mistakes}}`；type 为 definition_fill / form_fill / reading |

`GET /api/practice/sessions` 支持 `?mode=`（definition_fill / form_fill / reading）过滤，返回项含 `mode`。

查询参数统一叫 `bank`（词库 id），不是 `bankId`。
掌握度档位：`new`(未接触) < `weak` < `fuzzy` < `known` < `mastered`；分值 0–100，指数加权。

## 11 前端路由

`/login` `/setup` `/banks` `/banks/:id` `/banks/:id/import` `/batches`
`/practice` `/transform` `/reading` `/records` `/records/:id` `/stats` `/mistakes` `/users`
`/transform/bank` `/reading/bank`（仅管理员：变形题库 / 阅读理解题库维护）

未登录只能进 `/login` `/setup`。侧边栏按角色裁剪。
