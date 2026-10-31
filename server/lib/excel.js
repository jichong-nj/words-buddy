import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import { topicsForLevel, POS_SET } from '../../shared/topic-taxonomy.js';

/** 模板列定义：Excel 表头 ↔ 字段名 */
export const COLUMNS = [
  { label: '单词',     field: 'word',         required: true,  width: 18 },
  { label: '音标',     field: 'phonetic_uk',  width: 14 },
  { label: '美音',     field: 'phonetic_us',  width: 14 },
  { label: '词性',     field: 'pos',          width: 10 },
  { label: '中文释义', field: 'def_cn',       width: 40 },
  { label: '英文释义', field: 'def_en',       width: 60 },
  { label: '例句',     field: 'example_en',   width: 40 },
  { label: '例句翻译', field: 'example_cn',   width: 40 },
  { label: '主题',     field: 'topic',        width: 26 },
  { label: '标签',     field: 'tags',         width: 18 },
  { label: '等级',     field: 'level',        width: 10 },
  { label: '备注',     field: 'notes',        width: 20 },
];

/** 表头自动匹配用的别名表（全部小写比较，去空格） */
const ALIASES = {
  word: ['word', '单词', '词汇', ' vocabulary', 'vocabulary', 'term'],
  phonetic_uk: ['phonetic_uk', 'phonetic', '音标', '英式音标', 'uk', 'ipa', '音标uk'],
  phonetic_us: ['phonetic_us', '美音', '美式音标', 'us'],
  pos: ['pos', 'part of speech', '词性', '词类'],
  def_cn: ['def_cn', 'chinese', '中文释义', '释义', '中文', '汉语释义', '意思'],
  def_en: ['def_en', 'english definition', 'definition', '英文释义', '英语释义', '英文解释'],
  example_en: ['example_en', 'example', '例句', '英文例句'],
  example_cn: ['example_cn', '例句翻译', '例句中文', '中文例句'],
  topic: ['topic', '主题', '话题', '分类', 'category'],
  tags: ['tags', 'tag', '标签', '标记'],
  level: ['level', '等级', '级别', '难度'],
  notes: ['notes', 'note', '备注', '说明', '注释'],
};

const normHeader = h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** 猜列映射：Excel 表头 → 字段名 */
export function suggestMap(headers) {
  const map = {};
  const used = new Set();
  headers.forEach((h, i) => {
    const key = normHeader(h);
    if (!key) return;
    for (const [field, list] of Object.entries(ALIASES)) {
      if (used.has(field)) continue;
      if (list.some(a => normHeader(a) === key)) { map[h] = field; used.add(field); return; }
    }
    // 兜底：包含关系（例如「英文释义(必填)」）
    for (const [field, list] of Object.entries(ALIASES)) {
      if (used.has(field)) continue;
      if (list.some(a => key.includes(normHeader(a)) || normHeader(a).includes(key))) {
        map[h] = field; used.add(field); return;
      }
    }
  });
  return map;
}

function styleHeader(sheet) {
  const row = sheet.getRow(1);
  row.font = { bold: true };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/** 生成导入模板（含隐藏 _dict 页做下拉，规避内联列表 255 字符上限） */
export async function buildTemplate(level = 'KET') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Words Buddy';
  const ws = wb.addWorksheet('词库导入');
  ws.columns = COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);

  const topics = topicsForLevel(level);
  const example = {
    word: 'apple（示例行，导入时自动忽略，可删除）',
    phonetic_uk: '/ˈæpl/', phonetic_us: '/ˈæpl/', pos: 'n.',
    def_cn: '苹果', def_en: 'a round fruit with smooth green, red or yellow skin',
    example_en: 'I ate an apple after lunch.', example_cn: '我午饭后吃了一个苹果。',
    topic: topics.find(t => t.key === 'Food and Drink')?.key || 'Food and Drink',
    tags: '水果, 食物', level, notes: '这一行是示例',
  };
  const r = ws.addRow(example);
  r.font = { color: { argb: 'FF999999' }, italic: true };

  // 隐藏字典页：词性 + 主题下拉
  const dict = wb.addWorksheet('_dict');
  dict.addRows([['词性', '主题']]);
  [...POS_SET].forEach((p, i) => { dict.getCell(`A${i + 2}`).value = p; });
  topics.forEach((t, i) => { dict.getCell(`B${i + 2}`).value = t.key; });
  dict.state = 'hidden';

  if (POS_SET.size) {
    ws.dataValidations.add(`D2:D5000`, {
      type: 'list', allowBlank: true,
      formula1: `=_dict!$A$2:$A$${POS_SET.size + 1}`,
      error: '词性不在枚举内', errorTitle: '词性', showErrorMessage: false,
    });
  }
  if (topics.length) {
    ws.dataValidations.add(`I2:I5000`, {
      type: 'list', allowBlank: true,
      formula1: `=_dict!$B$2:$B${topics.length + 1}`,
      error: '主题不在官方 Topic 枚举内', errorTitle: '主题', showErrorMessage: false,
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** 极简 RFC4180 CSV 解析（带引号转义） */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

/** 解码上传的文件内容：BOM → utf8；utf8 严格失败 → gbk */
export function decodeCsv(buffer) {
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return buffer.toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, 'gbk');
  }
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    if (v.richText) return String(v.richText);
    if (v instanceof Date) return v.toISOString();
    if (v.hyperlink) return String(v.text || v.hyperlink);
    return String(v.formula ?? '');
  }
  return String(v);
}

/**
 * 读取表格。返回 { sheets, sheet, headerRow, headers, rows }
 * rows 是「原始二维数组」，字段映射在上层做。
 */
export async function readTable(buffer, { filename = '', sheet = null, headerRow = 1 } = {}) {
  const isCsv = /\.csv$/i.test(filename);
  if (isCsv) {
    const grid = parseCsv(decodeCsv(buffer));
    const headers = (grid[headerRow - 1] || []).map((h, i) => String(h ?? '').trim() || `第${i + 1}列`);
    return { sheets: ['CSV'], sheet: 'CSV', headerRow, headers, rows: grid };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const visible = wb.worksheets.filter(w => w.state !== 'hidden').map(w => w.name);
  const ws = (sheet && wb.getWorksheet(sheet)) || wb.worksheets[0];
  if (!ws) throw new Error('工作簿中没有工作表');
  const grid = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const arr = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => { arr[colNumber - 1] = cellText(cell.value); });
    grid[rowNumber - 1] = arr;
  });
  const width = Math.max(0, ...grid.map(r => (r ? r.length : 0)));
  for (let i = 0; i < grid.length; i++) {
    grid[i] = grid[i] || [];
    for (let j = 0; j < width; j++) if (grid[i][j] === undefined) grid[i][j] = '';
  }
  const headerCells = grid[headerRow - 1] || [];
  const headers = [];
  for (let j = 0; j < width; j++) headers[j] = String(headerCells[j] ?? '').trim() || `第${j + 1}列`;
  return { sheets: visible.length ? visible : wb.worksheets.map(w => w.name), sheet: ws.name, headerRow, headers, rows: grid };
}

/** 错误报告 xlsx */
export async function buildErrorReport(errors) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('导入问题');
  ws.columns = [
    { header: '行号', key: 'rowNo', width: 8 },
    { header: '单词', key: 'word', width: 20 },
    { header: '字段', key: 'field', width: 14 },
    { header: '级别', key: 'severity', width: 10 },
    { header: '代码', key: 'code', width: 24 },
    { header: '说明', key: 'message', width: 60 },
  ];
  styleHeader(ws);
  for (const e of errors) {
    ws.addRow({
      rowNo: e.rowNo ?? '', word: e.word ?? '', field: e.field ?? '',
      severity: e.severity === 'error' ? '错误' : '警告', code: e.code, message: e.message,
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 词库导出 xlsx（一词多义拆多行，配合「合并义项」可原样导回） */
export async function exportBank(bank, rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet((bank.name || '词库').slice(0, 28) || '词库');
  ws.columns = COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
