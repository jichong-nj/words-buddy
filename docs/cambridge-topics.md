# 剑桥官方主题体系（Topic Taxonomy）

> 版本 v1.0 ｜ 状态：已确认（2026-10-30）
> 用途：词库导入模板的「主题」下拉、种子数据分类、背单词按主题筛选、报表主题分布统计。

---

## 0. 来源与版本

| 项 | 内容 |
|---|---|
| A2 Key（KET） | *A2 Key and A2 Key for Schools Vocabulary List*，**August 2025** 版，Appendix 2 – Topic Lists |
| B1 Preliminary（PET） | *B1 Preliminary and Preliminary for Schools Vocabulary List*，**August 2025** 版，Appendix 2 – Topic Lists |
| 官方地址 | [A2 Key PDF](https://www.cambridgeenglish.org/images/506886-a2-key-2020-vocabulary-list.pdf) ｜ [B1 Preliminary PDF](https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf) |
| 提取方式 | `pdftotext -layout` 解析 PDF 后按主题标题切分，人工复核 |
| 主题数 | **KET 24 个，PET 22 个** |

官方原文对 Topic Lists 的说明：*"In Appendix 2, words have been grouped together under common Key and/or Key for Schools themes, such as 'Food and Drink', 'House and Home' and 'Sport'."*

⚠️ 两点必须知道的事实：

1. **官方词表只有英文，没有中文释义。** 直接导入只能得到 `word + topic + pos`，`def_cn` 仍需补全（人工或 P2 的词典补全功能）。
2. **官方明确排除敏感话题**（战争、政治等），所以这套主题体系天然适合教学场景，不含不适内容。

---

## 1. KET（A2 Key）主题表 — 24 项

| # | 官方英文名（存储值） | 中文名（显示用） | 例词 |
|---|---|---|---|
| 1 | `Appliances` | 家用电器 | camera, laptop, fridge, washing machine |
| 2 | `Clothes and Accessories` | 服装与配饰 | backpack, jeans, scarf, trainers |
| 3 | `Colours` | 颜色 | black, golden, pale, silver |
| 4 | `Communication and Technology` | 通讯与科技 | address, digital, screen, mobile (phone) |
| 5 | `Documents and Texts` | 文档与文本 | advertisement, diary, magazine, passport |
| 6 | `Education` | 教育 | course, lesson, ruler, beginner |
| 7 | `Entertainment and Media` | 娱乐与媒体 | actor, draw, magazine, practise |
| 8 | `Family and Friends` | 家庭与朋友 | aunt, girl, mum, cousin |
| 9 | `Food and Drink` | 饮食 | apple, chocolate, hungry, pizza |
| 10 | `Health, Medicine and Exercise` | 健康、医疗与锻炼 | accident, ambulance, headache, temperature |
| 11 | `Hobbies and Leisure` | 爱好与休闲 | barbecue, beach, chess, go shopping |
| 12 | `House and Home` | 房屋与家居 | apartment, clock, furniture, oven |
| 13 | `Measurements` | 度量 | centimetre, metre, half, temperature |
| 14 | `Places: Buildings` | 场所：建筑物 | apartment, department store, hotel, bank |
| 15 | `Places: Countryside` | 场所：乡村 | area, forest, ocean, beach |
| 16 | `Places: Town and City` | 场所：城镇与城市 | airport, city centre, petrol station, bridge |
| 17 | `Services` | 服务 | bank, doctor, café, theatre |
| 18 | `Shopping` | 购物 | cheque, expensive, rent, assistant |
| 19 | `Sport` | 运动 | ball, badminton, riding, swimming |
| 20 | `The Natural World` | 自然世界 | air, fire, moon, autumn |
| 21 | `Time` | 时间 | afternoon, morning, tonight, a.m./p.m. |
| 22 | `Travel and Transport` | 旅行与交通 | airport, engine, straight on, wheel |
| 23 | `Weather` | 天气 | cloud, fog, thunderstorm, windy |
| 24 | `Work and Jobs` | 工作与职业 | actor, journalist, mechanic, waiter |

## 2. PET（B1 Preliminary）主题表 — 22 项

| # | 官方英文名（存储值） | 中文名（显示用） | 例词 |
|---|---|---|---|
| 1 | `Clothes and Accessories` | 服装与配饰 | costume, pattern, pullover, tracksuit |
| 2 | `Colours` | 颜色 | gold, silver, dark, pale |
| 3 | `Communications and Technology` | 通讯与科技 | access, chat, equipment, digital |
| 4 | `Education` | 教育 | absent, laboratory, qualification |
| 5 | `Entertainment and Media` | 娱乐与媒体 | bestseller, comic, episode, action |
| 6 | `Environment` | 环境 | bottle bank, recycle, climate change |
| 7 | `Food and Drink` | 饮食 | can, dessert, grill, bake |
| 8 | `Health, Medicine and Exercise` | 健康、医疗与锻炼 | aspirin, ache, appointment, exercise |
| 9 | `Hobbies and Leisure` | 爱好与休闲 | camping, chess, bike, barbecue |
| 10 | `House and Home` | 房屋与家居 | accommodation, heating, remote control |
| 11 | `Language` | 语言 | advanced, elementary, mention, answer |
| 12 | `Places: Buildings` | 场所：建筑物 | apartment block, building, bank |
| 13 | `Places: Countryside` | 场所：乡村 | field, path, bay, cliff |
| 14 | `Places: Town and City` | 场所：城镇与城市 | cashpoint, pavement, station |
| 15 | `Services` | 服务 | museum, tourist, café, chemist |
| 16 | `Shopping` | 购物 | advert, closed, go shopping, rent |
| 17 | `Sport` | 运动 | athlete, contest, athletics, hit |
| 18 | `The Natural World` | 自然世界 | monkey, spring, animal, explore |
| 19 | `Time` | 时间 | appointment, hour, year |
| 20 | `Travel and Transport` | 旅行与交通 | carriage, departure, platform, fare |
| 21 | `Weather` | 天气 | blow, icy, breeze, sunshine |
| 22 | `Work and Jobs` | 工作与职业 | housework, postman, president, profession |

## 3. 两张表的差异（容易踩的坑）

| 差异 | 明细 |
|---|---|
| **KET 独有**（4） | `Appliances`、`Documents and Texts`、`Family and Friends`、`Measurements` |
| **PET 独有**（2） | `Environment`、`Language` |
| **拼写不一致** | KET 是 `Communication and Technology`（单数），PET 是 `Communication**s** and Technology`（复数） |
| **共有** | 18 个 |

> 拼写不一致是官方文件自身的疏漏。**存储时原样保留官方写法**，不做归一化——这样导出的 Excel 拿去和官方 PDF 对得上。UI 上两者都显示「通讯与科技」，用户不会困惑；只有做跨库统计时才需要知道它们是同一类。

---

## 4. 落地方式

### 4.1 存储：代码内置字典，**不建数据库表**

主题是一套**固定枚举**（官方文件定义的，用户不能增删），建表反而多余。放在 `shared/topic-taxonomy.ts` 里作为常量：

```ts
export const TOPICS = {
  KET: [
    { key: 'Appliances',                 cn: '家用电器' },
    { key: 'Clothes and Accessories',    cn: '服装与配饰' },
    // … 共 24 项
  ],
  PET: [
    { key: 'Clothes and Accessories',    cn: '服装与配饰' },
    // … 共 22 项
  ],
} as const;
```

`word.topic` 仍是 **TEXT，存官方英文名原文**（如 `Food and Drink`），不加外键、不建 `topic` 表。理由：

- 存英文原文 → 与官方 PDF / 导出文件一一对应，将来重新导入或跨库合并不会错位；
- 中文名只是显示层的事，改译名不需要动数据；
- 自定义词库（`level` 非 KET/PET）可以填任意主题，枚举约束不了它，TEXT 最灵活。

### 4.2 字段分工：`topic` 单选，`tags` 多选

一个词可能横跨多个主题（`coat` 既是服装又是购物）。分工如下：

| 字段 | 基数 | 约束 | 用途 |
|---|---|---|---|
| `topic` | **单选** | 受当前 level 枚举约束（软约束，见 4.4） | 官方主题，用于筛选与统计 |
| `tags` | 多选，逗号分隔 | 自由填写 | 自定义维度：`不规则动词, 高频, 易混` |

不引入 `word_topic` 多对多表：主题筛选是「按类浏览」，一个主主题足够；真要交叉分类用 `tags`。

### 4.3 按 `word_bank.level` 选表

| `bank.level` | 下拉与校验用的主题集 |
|---|---|
| `KET` | KET 24 项 |
| `PET` | PET 22 项 |
| `KET+PET` | 两表**并集**（26 项，通讯类两个写法都保留） |
| 其它 / 空 | **不校验**，主题列自由填写 |

`GET /api/meta/topics?bank=:id` 返回该库可用主题 `[{key, cn}]`；`GET /api/meta/topics?level=KET` 直接按 level 取。前端下拉 label 显示 `饮食 Food and Drink`，value 存 `Food and Drink`。

### 4.4 导入校验：警告，不阻断

| 情况 | 处理 |
|---|---|
| `topic` 为空 | 不提示（主题本就可选） |
| `topic` 在枚举内 | 通过 |
| `topic` 不在枚举内，且库 level 是 KET/PET | **warn** `topic_not_in_taxonomy`，照常导入 |
| 库 level 非 KET/PET | 不校验 |

为什么不阻断：用户从教材、真题里整理的词表经常自带主题（如「校园生活」），强行拒绝会让导入功能很难用。枚举的作用是**给下拉提供候选 + 提示拼写可能不对**，不是闸门。

### 4.5 Excel 模板里的下拉（技术细节）

Excel 内联数据验证列表有 **255 字符上限**，24 个英文主题名拼起来远超此数。做法：把主题清单写到隐藏工作表 `_dict`，主表下拉用区域引用：

```
dataValidation: { type: 'list', formula1: "=_dict!$A$2:$A$25" }
```

`_dict` 表 A 列放主题、B 列放中文对照，导出时 `worksheet.state = 'hidden'`。词性下拉（13 项，短）可继续用内联列表。

---

## 5. 对种子数据的影响（§12 修订）

`server/seed/demo-words.csv` 的 60 个 KET 词按官方主题分配，**覆盖全部 24 个主题，每主题 2–3 词**，这样示例库里每个主题筛选都有内容，报表的主题分布图也不会只有一两根柱子。

示例（节选）：

| word | pos | def_cn | topic |
|---|---|---|---|
| apple | n. | 苹果 | Food and Drink |
| trainers | n.pl. | 运动鞋 | Clothes and Accessories |
| laptop | n. | 笔记本电脑 | Appliances |
| passport | n. | 护照 | Documents and Texts |
| headache | n. | 头痛 | Health, Medicine and Exercise |
| platform | n. | 站台 | Travel and Transport |
| thunderstorm | n. | 雷雨 | Weather |
| mechanic | n. | 机械师 | Work and Jobs |

3 条脏数据保持不变（1 空单词、1 超长、1 同词不同词性），主题列照常填写。

---

## 6. 与后续模块的关系

| 模块 | 用法 |
|---|---|
| M3 背单词 | 学习计划可限定主题（「只背 Food and Drink」）；卡片上显示主题标签 |
| M4 练习与考试 | 组卷条件可按主题抽题（单元测按主题出题） |
| M6 报表 | 主题掌握度分布图：横轴 24 个主题，纵轴已掌握词数——**这是这套主题体系最大的价值** |

M6 的图表横轴直接用官方英文名排序（表内顺序即 PDF 顺序），tooltip 显示中文名。

---

## 7. 待办

- [ ] P2 做「PDF→Excel」时，官方 PDF 的 Appendix 2 **已经按主题分好组**，可直接生成带 `topic` 列的 Excel，省掉人工分类。
- [ ] 官方词表无中文释义，导入后 `def_cn` 为空 → 与 P2「词典 API 补全」配合；但本系统要求离线，届时需确认是「联网补全后落库」还是「预置离线词典包」。
