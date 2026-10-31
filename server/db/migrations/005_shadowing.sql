-- ───────────────────────────── 跟读评分（shadowing） ─────────────────────────────
-- 学生听例句发音 → 跟读录音 → 服务端比对韵律（音高轮廓 + 节奏 + 清浊模式）打分 0–100。

-- 参考音频缓存：同一句话只合成一次，按 音色|语速|归一化文本 的哈希落盘。
-- 不预生成全库（约 130KB/句 × 3087 句 ≈ 400MB），按需惰性生成。
CREATE TABLE IF NOT EXISTS shadow_audio (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  text_hash    TEXT NOT NULL UNIQUE,             -- sha256(voice|wpm|归一化文本) 前 32 位
  text         TEXT NOT NULL,
  voice        TEXT NOT NULL,
  wpm          INTEGER NOT NULL,
  file_path    TEXT NOT NULL,                    -- 相对 dataDir，便于整体搬迁 data/
  sample_rate  INTEGER,
  duration_ms  INTEGER,
  bytes        INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 跟读作答：复用 practice_item（mode='shadowing'）。
-- is_correct 恒为 NULL —— 跟读没有对错，不进错题集、不进正确率统计。
ALTER TABLE practice_item ADD COLUMN shadow_score REAL;          -- 总分 0–100
ALTER TABLE practice_item ADD COLUMN shadow_pitch REAL;          -- 音高轮廓分
ALTER TABLE practice_item ADD COLUMN shadow_rhythm REAL;         -- 节奏（能量包络）分
ALTER TABLE practice_item ADD COLUMN shadow_fluency REAL;        -- 清浊模式分（内容一致性代理）
ALTER TABLE practice_item ADD COLUMN shadow_completeness REAL;   -- 完整度（时长比）分
ALTER TABLE practice_item ADD COLUMN shadow_audio_path TEXT;     -- 学生录音，相对 dataDir
ALTER TABLE practice_item ADD COLUMN shadow_ref_ms INTEGER;      -- 参考音频时长
ALTER TABLE practice_item ADD COLUMN shadow_stu_ms INTEGER;      -- 学生录音时长
ALTER TABLE practice_item ADD COLUMN shadow_off_target INTEGER NOT NULL DEFAULT 0; -- 1 = 疑似没读这句
ALTER TABLE practice_item ADD COLUMN shadow_reason TEXT;         -- 拒评原因：no_speech / too_short

CREATE INDEX IF NOT EXISTS idx_pi_shadow ON practice_item(session_id, seq);
