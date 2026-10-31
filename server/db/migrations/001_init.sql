-- Words Buddy · 初始结构
-- 约定（见 docs/roadmap.md §3）：
--   主键 INTEGER PRIMARY KEY AUTOINCREMENT；时间 TEXT 'YYYY-MM-DD HH:MM:SS' localtime；
--   布尔 INTEGER 0/1；枚举 TEXT 不用 CHECK；外键一律 ON DELETE CASCADE。

PRAGMA foreign_keys = ON;

-- ───────────────────────────── M1 用户与权限 ─────────────────────────────

CREATE TABLE app_user (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  display_name   TEXT NOT NULL,
  role           TEXT NOT NULL,                 -- admin | student
  status         TEXT NOT NULL DEFAULT 'active',-- active | disabled
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  created_by     INTEGER REFERENCES app_user(id)
);

CREATE TABLE user_session (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  ip         TEXT
);
CREATE INDEX idx_session_user ON user_session(user_id);

-- ───────────────────────────── M2 词库管理 ─────────────────────────────

CREATE TABLE word_bank (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  level       TEXT,                             -- KET | PET | KET+PET | 其它自由文本
  description TEXT,
  source      TEXT,
  word_count  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE word (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id      INTEGER NOT NULL REFERENCES word_bank(id) ON DELETE CASCADE,
  word         TEXT NOT NULL,
  word_norm    TEXT GENERATED ALWAYS AS (lower(trim(word))) STORED,
  phonetic_uk  TEXT,
  phonetic_us  TEXT,
  topic        TEXT,
  tags         TEXT,
  level        TEXT,
  notes        TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  src_row      INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (bank_id, word_norm)
);
CREATE INDEX idx_word_bank     ON word(bank_id);
CREATE INDEX idx_word_topic    ON word(bank_id, topic);
CREATE INDEX idx_word_norm     ON word(word_norm);

CREATE TABLE word_sense (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id      INTEGER NOT NULL REFERENCES word(id) ON DELETE CASCADE,
  pos          TEXT,
  def_cn       TEXT,
  def_en       TEXT,
  def_en_source TEXT,                          -- manual | wordnet | NULL
  example_en   TEXT,
  example_cn   TEXT,
  phonetic_uk  TEXT,
  phonetic_us  TEXT,
  sort         INTEGER NOT NULL DEFAULT 1,
  src_row      INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_sense_word ON word_sense(word_id, sort);
-- 出题时按 def_en 反查同义答案，需要索引
CREATE INDEX idx_sense_defen ON word_sense(def_en);

-- ───────────────────────────── 导入批次 ─────────────────────────────

CREATE TABLE import_batch (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id      INTEGER NOT NULL REFERENCES word_bank(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  stored_path  TEXT,
  sheet_name   TEXT,
  header_row   INTEGER,
  column_map   TEXT,                            -- JSON
  dup_in_file  TEXT,
  dup_in_bank  TEXT,
  merge_senses INTEGER NOT NULL DEFAULT 1,
  total_rows   INTEGER,
  inserted     INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  skipped      INTEGER NOT NULL DEFAULT 0,
  failed       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'preview', -- preview|committed|rolled_back|failed
  affected_json TEXT,                           -- 提交时写入：新建/覆盖的 word id，供回滚使用
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  committed_at TEXT
);

CREATE TABLE import_error (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  row_no   INTEGER,
  word     TEXT,
  field    TEXT,
  severity TEXT NOT NULL,                       -- error | warn
  code     TEXT NOT NULL,
  message  TEXT NOT NULL
);
CREATE INDEX idx_err_batch ON import_error(batch_id, severity);

-- ─────────────────── M4 练习 / M9 练习记录与掌握度 ───────────────────

CREATE TABLE practice_session (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  bank_id     INTEGER REFERENCES word_bank(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL DEFAULT 'definition_fill',
  scope_json  TEXT,                             -- 抽题范围快照
  total       INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  score       REAL NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  status      TEXT NOT NULL DEFAULT 'in_progress', -- in_progress|finished|abandoned
  started_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  finished_at TEXT
);
CREATE INDEX idx_ps_user ON practice_session(user_id, started_at DESC);
CREATE INDEX idx_ps_bank ON practice_session(bank_id);

CREATE TABLE practice_item (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      INTEGER NOT NULL REFERENCES practice_session(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,
  word_id         INTEGER NOT NULL REFERENCES word(id) ON DELETE CASCADE,
  sense_id        INTEGER REFERENCES word_sense(id) ON DELETE SET NULL,
  question_type   TEXT NOT NULL,
  stem_snapshot   TEXT NOT NULL,                -- 出题当时的题干，管理员日后改释义不影响历史
  answer_snapshot TEXT NOT NULL,                -- 出题当时的正确答案
  accepted_json   TEXT,                         -- 同义可接受答案集
  given           TEXT,
  is_correct      INTEGER,                      -- NULL = 未作答
  latency_ms      INTEGER,
  asked_at        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  answered_at     TEXT
);
CREATE INDEX idx_pi_session ON practice_item(session_id, seq);
CREATE INDEX idx_pi_word    ON practice_item(word_id);

CREATE TABLE word_mastery (
  user_id     INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  word_id     INTEGER NOT NULL REFERENCES word(id) ON DELETE CASCADE,
  attempts    INTEGER NOT NULL DEFAULT 0,
  correct     INTEGER NOT NULL DEFAULT 0,
  streak      INTEGER NOT NULL DEFAULT 0,
  last_result INTEGER,
  last_at     TEXT,
  score       REAL NOT NULL DEFAULT 0,          -- 0..100
  band        TEXT NOT NULL DEFAULT 'new',      -- new|weak|fuzzy|known|mastered
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (user_id, word_id)
);
CREATE INDEX idx_mastery_band ON word_mastery(user_id, band);

-- ───────────────────────────── 应用元数据 ─────────────────────────────

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
