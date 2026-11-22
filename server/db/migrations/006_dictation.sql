-- ───────────────────────────── 听写练习（dictation） ─────────────────────────────
-- 听写句库：一句英文 + 中文 + 逐词解析（词性/音标/释义）+ 语法标签 + 解析
CREATE TABLE IF NOT EXISTS dictation_item (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence_en   TEXT NOT NULL,
  sentence_cn   TEXT,
  tokens_json   TEXT,                     -- [{w,pos,ipa,cn}]
  grammar_label TEXT,                     -- 如「主语和谓语」
  analysis      TEXT,                     -- 句子解析
  level         TEXT,
  topic         TEXT,
  tags          TEXT,
  source        TEXT,
  needs_review  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (sentence_en)
);
CREATE INDEX IF NOT EXISTS idx_dict_level ON dictation_item(level);
CREATE INDEX IF NOT EXISTS idx_dict_topic ON dictation_item(topic);

-- 听写作答：复用 practice_item（mode='dictation'）
ALTER TABLE practice_item ADD COLUMN dictation_id INTEGER REFERENCES dictation_item(id) ON DELETE SET NULL;
ALTER TABLE practice_item ADD COLUMN diff_json TEXT;            -- 最近一次逐词 diff
ALTER TABLE practice_item ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE practice_item ADD COLUMN first_correct INTEGER;     -- 首次提交对错（统计口径）
