-- ───────────────────────────── 变形填空 ─────────────────────────────
-- 题库：给一个带空的句子 + 括号里的原型，填正确变形（时态 / 词性 / 介词 / 比较级…）
CREATE TABLE IF NOT EXISTS transform_item (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt       TEXT NOT NULL,                    -- 句子，空位统一写成 ____
  base         TEXT NOT NULL,                    -- 原型，如 arrive
  base_norm    TEXT GENERATED ALWAYS AS (lower(trim(base))) STORED,
  answer       TEXT NOT NULL,                    -- 首选答案，如 arrived at
  accepted_json TEXT,                            -- 可接受答案数组（含首选答案）
  point        TEXT,                             -- 考点：时态 / 词性 / 介词 / 语态 / 比较级…
  level        TEXT,                             -- KET / PET / 其它
  topic        TEXT,
  tags         TEXT,
  explain      TEXT,                             -- 解析
  notes        TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (prompt, base_norm)                     -- 同一句子 + 同一原型只允许一条
);
CREATE INDEX IF NOT EXISTS idx_ti_point ON transform_item(point);
CREATE INDEX IF NOT EXISTS idx_ti_topic ON transform_item(topic);
CREATE INDEX IF NOT EXISTS idx_ti_level ON transform_item(level);

-- practice_item 需要支持变形题：word_id 可空，并快照原型/考点/解析
CREATE TABLE practice_item_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL REFERENCES practice_session(id) ON DELETE CASCADE,
  seq              INTEGER NOT NULL,
  word_id          INTEGER REFERENCES word(id) ON DELETE CASCADE,
  sense_id         INTEGER REFERENCES word_sense(id) ON DELETE SET NULL,
  transform_id     INTEGER REFERENCES transform_item(id) ON DELETE SET NULL,
  question_type    TEXT NOT NULL,
  stem_snapshot    TEXT NOT NULL,
  answer_snapshot  TEXT NOT NULL,
  accepted_json    TEXT,
  base_snapshot    TEXT,
  point_snapshot   TEXT,
  explain_snapshot TEXT,
  given            TEXT,
  is_correct       INTEGER,
  latency_ms       INTEGER,
  asked_at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  answered_at      TEXT
);

INSERT INTO practice_item_new
  (id, session_id, seq, word_id, sense_id, question_type, stem_snapshot, answer_snapshot,
   accepted_json, given, is_correct, latency_ms, asked_at, answered_at)
SELECT id, session_id, seq, word_id, sense_id, question_type, stem_snapshot, answer_snapshot,
       accepted_json, given, is_correct, latency_ms, asked_at, answered_at
FROM practice_item;

DROP TABLE practice_item;
ALTER TABLE practice_item_new RENAME TO practice_item;
CREATE INDEX IF NOT EXISTS idx_pi_session ON practice_item(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_pi_word ON practice_item(word_id);
CREATE INDEX IF NOT EXISTS idx_pi_transform ON practice_item(transform_id);
