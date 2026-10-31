// 通用常量与小工具

export const BAND_LABELS = {
  new: '未接触',
  weak: '薄弱',
  fuzzy: '模糊',
  known: '已掌握',
  mastered: '精通',
};

export const BAND_COLORS = {
  new: '#909399',
  weak: '#f56c6c',
  fuzzy: '#e6a23c',
  known: '#67c23a',
  mastered: '#409eff',
};

export const POS_OPTIONS = [
  'n.', 'v.', 'vt.', 'vi.', 'adj.', 'adv.', 'prep.',
  'conj.', 'pron.', 'num.', 'int.', 'aux.', 'modal',
  'art.', 'det.', 'phr.',
];

// 练习模式（practice_session.mode）
export const MODE_LABELS = {
  definition_fill: '释义填空',
  form_fill: '变形填空',
  reading: '阅读理解',
  shadowing: '跟读练习',
};

export const MODE_TAGS = {
  definition_fill: 'primary',
  form_fill: 'warning',
  reading: 'success',
  shadowing: 'info',
};

export function modeLabel(m) {
  return MODE_LABELS[m] || '释义填空';
}

export function modeTag(m) {
  return MODE_TAGS[m] || 'primary';
}

// 跟读评分失败原因（后端 shadow_reason）→ 中文提示
const SHADOW_FAIL_TEXT = {
  no_speech: '没听到声音',
  too_short: '录音太短',
  decode_failed: '录音格式不支持',
  ref_failed: '参考音频生成失败',
  upload_failed: '上传失败',
  failed: '评分失败',
};

export function shadowFailText(r) {
  return SHADOW_FAIL_TEXT[r] || r || '未打分';
}

// 导入列映射的字段清单（对应 wordbank-requirements §3.1）
export const IMPORT_FIELDS = [
  { key: 'word', label: '单词（必填）' },
  { key: 'phonetic_uk', label: '音标' },
  { key: 'phonetic_us', label: '美音' },
  { key: 'pos', label: '词性' },
  { key: 'def_cn', label: '中文释义' },
  { key: 'def_en', label: '英文释义' },
  { key: 'example_en', label: '例句' },
  { key: 'example_cn', label: '例句翻译' },
  { key: 'topic', label: '主题' },
  { key: 'tags', label: '标签' },
  { key: 'level', label: '等级' },
  { key: 'notes', label: '备注' },
];

export function fmtPct(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return '—';
  const pct = n > 0 && n < 1 ? n * 100 : n;
  return `${Math.round(pct * 10) / 10}%`;
}

export function fmtSec(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`;
}

export function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 拼查询串，跳过空值
export function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== '') usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}
