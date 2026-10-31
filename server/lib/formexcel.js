/**
 * 变形填空题库的 Excel 读写：导入模板、题库导出。
 * 列定义同时用于「表头自动识别」，与导入解析共用一份，避免两处漂移。
 */
import ExcelJS from 'exceljs';

/** 导入模板列（label 用于表头，field 用于字段映射） */
export const FORM_COLUMNS = [
  { label: '句子', field: 'prompt', required: true, width: 54, hint: '把要填的位置写成 ____，例如 I ____ school yesterday.' },
  { label: '原型', field: 'base', required: true, width: 16, hint: '括号里给出的词，例如 arrive' },
  { label: '答案', field: 'answer', required: true, width: 24, hint: '正确变形，例如 arrived at；多个答案用 | 分隔' },
  { label: '可接受答案', field: 'accepted', width: 32, hint: '其他可判对的写法，用 | 分隔（可选）' },
  { label: '考点', field: 'point', width: 14, hint: '时态 / 词性 / 介词 / 语态 / 比较级…' },
  { label: '等级', field: 'level', width: 10, hint: 'KET / PET / 其它' },
  { label: '主题', field: 'topic', width: 26 },
  { label: '标签', field: 'tags', width: 16 },
  { label: '句子翻译', field: 'sentenceCn', width: 40, hint: '整句中文意思，作答后展示' },
  { label: '词义', field: 'wordCn', width: 24, hint: '原型词的中文意思，作答后展示' },
  { label: '解析', field: 'explain', width: 44, hint: '为什么用这个形式（可选）' },
  { label: '备注', field: 'notes', width: 20 },
];

/** 表头别名 → 字段 */
export const FORM_ALIASES = {
  prompt: ['句子', '题目', '题干', 'sentence', 'prompt', 'question'],
  base: ['原型', '原形', '基础形式', '词根', 'base', 'given'],
  answer: ['答案', '正确答案', 'answer', 'key'],
  accepted: ['可接受答案', '其他答案', '其它答案', '同义答案', 'accepted', 'alternatives'],
  point: ['考点', '语法点', '语法', 'point', 'grammar'],
  level: ['等级', '级别', '难度', 'level'],
  topic: ['主题', '话题', '分类', 'topic'],
  tags: ['标签', '标记', 'tags'],
  explain: ['解析', '说明', '解释', '讲解', 'explain', 'explanation'],
  sentenceCn: ['句子翻译', '翻译', '句意', '中文翻译', '句子意思', 'sentencecn', 'translation'],
  wordCn: ['词义', '单词意思', '词的中文', '单词中文', '原型意思', 'wordcn'],
  notes: ['备注', '注释', 'note', 'notes'],
};

const normHeader = h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 猜列映射：表头 → 字段名 */
export function suggestFormMap(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers) {
    const key = normHeader(h);
    if (!key) continue;
    for (const [field, aliases] of Object.entries(FORM_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some(a => normHeader(a) === key)) { map[h] = field; used.add(field); break; }
    }
  }
  // 兜底：包含关系（例如「句子（带空）」）
  for (const h of headers) {
    if (map[h]) continue;
    const key = normHeader(h);
    for (const [field, aliases] of Object.entries(FORM_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some(a => key.includes(normHeader(a)))) { map[h] = field; used.add(field); break; }
    }
  }
  return map;
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

const POINTS = ['时态', '语态', '词性', '词形变化', '比较级', '介词', '非谓语', '主谓一致', '复数', '固定搭配'];
const LEVELS = ['KET', 'PET'];

/** 生成导入模板（含示例行与考点下拉） */
export async function buildFormTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Words Buddy';
  const ws = wb.addWorksheet('变形填空导入');
  ws.columns = FORM_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);

  const example = {
    prompt: 'I ____ (arrive) school at eight yesterday.（示例行，导入时自动忽略，可删除）',
    base: 'arrive',
    answer: 'arrived at',
    accepted: 'arrived at|arrived',
    point: '时态',
    level: 'PET',
    topic: 'Education',
    tags: '一般过去时',
    sentenceCn: '我昨天八点到了学校。',
    wordCn: 'v. 到达；抵达',
    explain: 'yesterday 表示过去，用一般过去时；arrive at + 地点。',
    notes: '',
  };
  ws.addRow(example);
  ws.addRow({
    prompt: 'This is the ____ (interesting) book I have ever read.',
    base: 'interesting',
    answer: 'most interesting',
    accepted: 'most interesting|the most interesting',
    point: '比较级',
    level: 'PET',
    topic: 'Hobbies and Leisure',
    tags: '最高级',
    sentenceCn: '这是我读过的最有趣的书。',
    wordCn: 'adj. 有趣的',
    explain: 'ever 常与最高级连用。',
    notes: '',
  });

  const dict = wb.addWorksheet('_dict');
  dict.state = 'veryHidden';
  dict.getCell('A1').value = '考点';
  POINTS.forEach((p, i) => { dict.getCell(`A${i + 2}`).value = p; });
  dict.getCell('B1').value = '等级';
  LEVELS.forEach((p, i) => { dict.getCell(`B${i + 2}`).value = p; });
  if (POINTS.length) {
    ws.dataValidations.add('E2:E5000', {
      type: 'list', allowBlank: true, formula1: `=_dict!$A$2:$A$${POINTS.length + 1}`,
      error: '考点不在下拉列表内', errorTitle: '考点', showErrorMessage: false,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 导出题库（列顺序与模板一致，可原样再导入） */
export async function exportFormItems(items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('变形填空题库');
  ws.columns = FORM_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);
  for (const it of items) {
    ws.addRow({
      prompt: it.prompt,
      base: it.base,
      answer: it.answer,
      accepted: (it.accepted || []).filter(a => a !== it.answer).join('|'),
      point: it.point || '',
      level: it.level || '',
      topic: it.topic || '',
      tags: it.tags || '',
      sentenceCn: it.sentenceCn || '',
      wordCn: it.wordCn || '',
      explain: it.explain || '',
      notes: it.notes || '',
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
