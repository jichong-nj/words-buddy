-- ───────────────────────────── 阅读理解 + 错题集 ─────────────────────────────
-- 阅读题库：一篇文章 + 若干单选题
CREATE TABLE IF NOT EXISTS reading_passage (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  text         TEXT NOT NULL,                    -- 正文，段落之间用空行
  level        TEXT,                             -- KET / PET
  topic        TEXT,
  tags         TEXT,
  source       TEXT,                             -- 来源说明（如 Simple English Wikipedia）
  word_count   INTEGER,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (title)
);

CREATE TABLE IF NOT EXISTS reading_question (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  passage_id   INTEGER NOT NULL REFERENCES reading_passage(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,                 -- 篇内题号，从 1 开始
  stem         TEXT NOT NULL,
  options_json TEXT NOT NULL,                    -- JSON 数组，4 个选项文本
  answer_index INTEGER NOT NULL,                 -- 0–3
  explain      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (passage_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_rq_passage ON reading_question(passage_id, seq);

-- 阅读练习的题目快照（practice_item 复用，word_id/transform_id 为空）
ALTER TABLE practice_item ADD COLUMN reading_question_id INTEGER REFERENCES reading_question(id) ON DELETE SET NULL;
ALTER TABLE practice_item ADD COLUMN options_json TEXT;
ALTER TABLE practice_item ADD COLUMN passage_title TEXT;
ALTER TABLE practice_item ADD COLUMN passage_text TEXT;

-- 错题集：按题型 + 题目引用累计对错次数，人工可移除
CREATE TABLE IF NOT EXISTS mistake (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  qtype        TEXT NOT NULL,                    -- definition | form | reading
  ref_id       INTEGER NOT NULL,                 -- word_id / transform_item.id / reading_question.id
  wrong_count  INTEGER NOT NULL DEFAULT 0,
  right_count  INTEGER NOT NULL DEFAULT 0,
  last_wrong_at TEXT,
  last_right_at TEXT,
  removed      INTEGER NOT NULL DEFAULT 0,       -- 1 = 被人工移出错题集
  snapshot_json TEXT,                            -- 题干/答案快照，题目被删也能回看
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (user_id, qtype, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_mistake_user ON mistake(user_id, qtype, removed);
