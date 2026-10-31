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
