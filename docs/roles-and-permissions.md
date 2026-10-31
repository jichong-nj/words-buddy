# Words Buddy · 用户与权限设计 v0.2

> 状态：主体已确认（2026-10-30），剩 Q4 / Q5 待定。本文档确定角色划分、权限矩阵、登录方案，以及它对词库模块的约束。

---

## 1. 角色划分（已确认：两个角色）

| 角色 | 典型身份 | 职责 |
|---|---|---|
| `admin` 管理员 | 你本人 | 维护词库、创建学生账号、查看全部报表 |
| `student` 学生 | 学习者 | 背单词、做练习与考试、查看自己的进度与报表 |

**已确认**：不引入 `teacher` 角色。管理员一人包干——建词库、建学生、看报表。若将来确实需要老师分工，再作为独立模块扩展，不影响现有表结构（`role` 是 TEXT 枚举，加值无需迁移）。

**核心原则：词库是「教材」，只有 admin 能改；学生只读。** 否则学生误删一个词库，所有人的学习进度都悬空了。

---

## 2. 权限矩阵（已确认）

| 能力 | admin | student |
|---|---|---|
| 词库 新建 / 重命名 / 归档 / 删除 | ✅ | ❌ |
| Excel 导入 / 导出 / 批次回滚 | ✅ | ❌ |
| 单词与义项 增删改 | ✅ | ❌ |
| 词库浏览 | ✅ 全部 | ✅ **全部**（已确认，无需指派） |
| 背单词 / 练习 / 考试 | ✅ | ✅ |
| 错题本 | ✅ 全部 | ✅ 仅自己 |
| 学习报表 | ✅ 全体学生 | ✅ 仅自己 |
| 用户管理（建/禁用/重置密码） | ✅ | ❌ |
| 系统设置 / 数据备份 | ✅ | ❌ |

**接口落地方式（简化决定）**：不单独开 `/api/student/*` 前缀。**GET 类只读接口对 student 开放，所有写接口 `requireRole('admin')`**。少一套路由、少一类漏配权限的 bug。

学生数据隔离靠服务端强制：student 的请求一律注入 `WHERE user_id = session.user.id`，前端传入的 `user_id` 参数对 student 一律忽略。


---

## 3. 数据模型（新增表）

```sql
-- 用户
CREATE TABLE app_user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,           -- scrypt，见 §4
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL,           -- admin / student
  status        TEXT    NOT NULL DEFAULT 'active',  -- active / disabled
  must_change_pw INTEGER NOT NULL DEFAULT 0,        -- 首次登录强制改密
  last_login_at TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  created_by    INTEGER REFERENCES app_user(id)
);

-- 会话（服务端可控，便于禁用账号后立即失效）
CREATE TABLE user_session (
  id         TEXT PRIMARY KEY,             -- 32B 随机 hex
  user_id    INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  ip         TEXT
);
CREATE INDEX idx_session_user ON user_session(user_id);
```

**不建 `bank_assignment` 表**：已确认全部词库对学生可见，无需指派关系。若将来 M7（任务指派）确实要做，再单独加表，不影响现有结构。

学习进度类表（SRS 状态、答题记录）后续设计时统一以 `user_id` 为归属键，因此**用户表必须先落地**，否则背单词模块的表结构要返工。

---

## 4. 登录与鉴权方案

| 项 | 方案 | 理由 |
|---|---|---|
| 密码哈希 | Node 内置 `crypto.scrypt`（N=2^15, r=8, p=1）+ 16B 随机盐，格式 `scrypt$N$r$p$salt$hash` | 零依赖，避免 bcrypt 原生编译；比裸 sha256 抗爆破 |
| 会话 | 服务端 `user_session` 表 + 签名 Cookie（`@fastify/cookie`），`HttpOnly` `SameSite=Lax` `Path=/` | 本地单实例无需 JWT；禁用账号可立即踢出 |
| 会话时长 | 默认 7 天，勾选「记住我」30 天；过期即清 | 本地设备，不必每天登录 |
| 首次启动 | `app_user` 为空 → 全站重定向 `/setup`，引导创建首个 admin 账号 | 无预置弱口令写死在代码里 |
| 学生账号来源 | admin 在「用户管理」页创建，可设初始密码 + `must_change_pw=1` | 受控，避免学生自助注册 |
| 失败保护 | 同一用户名连续失败 5 次锁定 5 分钟（内存计数即可） | 简单够用 |
| CSRF | JSON-only API + 校验 `Content-Type: application/json` + `SameSite=Lax` | 表单式跨站提交打不进来 |
| 密码规则 | 最少 4 位（本地学习工具，不强制复杂度） | 别把使用门槛做高 |

**鉴权实现**：Fastify `onRequest` 钩子解析 Cookie → 查 `user_session` → 挂 `request.user`；路由级 `preHandler: requireRole('admin')`。前端路由守卫与菜单按角色渲染，但**权限判定以后端为准**——前端隐藏按钮只是体验，不是安全。

---

## 5. ⚠️ 对词库模块的约束（已同步进词库文档）

1. **所有词库写操作路由加 `requireRole('admin')`**：`POST/PATCH/DELETE /api/banks*`、单词与义项的 `POST/PUT/DELETE`、导入的 `preview/commit/rollback`。
2. **GET 类接口对 student 开放**（已确认全部词库可见），不单独开只读前缀。但列表接口对 student 隐藏管理性字段（`src_row`、`needs_review`、导入批次信息），避免学生看到「待补充」这类内部标记。
3. **考试场景防作弊（重要，影响后续考试模块设计）**：
   - 考试题目由**服务端生成、服务端判分**，正确答案字段绝不下发到前端；前端只拿到 `questionId + 题干 + 选项`。
   - 考试接口只下发当前题目所需字段，不得一次性下发词表。背单词模块可以看释义（那是学习），这是两回事。
   - 这条规则现在写下来，是为了避免考试模块图省事把整个词库 JSON 丢给前端做本地判分——那样 F12 一看全露。
   - **诚实的边界**：本地学习工具防的是「顺手翻答案」，不是专业作弊。学生另开标签页查词在技术上拦不住，只能靠切屏计数与记录。别在这上面投入过多。
4. **删除词库的连带影响**：删词库会级联删词条，而学习进度引用 `word_id`。因此**有学习记录的词库禁止硬删，只能归档**（`status='archived'`），归档后不出现在学生端但历史报表保留。

---

## 6. 页面与导航（按角色）

```
admin 侧边栏：  词库管理 | 用户管理 | 全部报表 | 系统设置
student 侧边栏：词库 | 背单词 | 练习与考试 | 错题本 | 我的报表
```

未登录只能访问 `/login` 与 `/setup`。admin 登录后也可切到学习模式（默认允许，可在设置里关闭）。

---

## 7. 决策记录与剩余问题

**已确认（2026-10-30）**：

| # | 议题 | 决策 |
|---|---|---|
| Q1 | 角色数量 | **只要 admin + student**，不做 teacher |
| Q2 | 词库可见性 | **全部词库对所有学生可见**，不建指派表 |
| Q3 | 学生账号来源 | **仅 admin 创建**，关闭自助注册；可设初始密码 + 首次登录强制改密 |

**仍待确认**：

- **Q4 登录方式**：用户名 + 密码即可，还是学生端做成「点头像直接进入」（免密，适合低龄儿童或在共用设备上使用）？
  - 若选免密：`app_user` 需支持空 `password_hash`，登录页变成学生头像列表；安全性等同于「没人乱点」，仅适合完全可信的家庭/班级环境。
- **Q5 admin 是否也学习**：admin 自己背单词时，进度记在 admin 账号下，还是单独建个学生账号？
  - 建议**单独建一个学生账号给自己用**，这样报表口径统一（所有学习数据都挂在 `role='student'` 上），避免统计脚本到处特判。
