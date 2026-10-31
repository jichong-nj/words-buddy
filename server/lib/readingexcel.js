/**
 * 阅读理解的 Excel 读写：导入模板、题库导出。
 * 导入表格式「一行一道题」，同一「标题」的多行合并成一篇（正文只在首行填写即可）。
 */
import ExcelJS from 'exceljs';

export const READING_COLUMNS = [
  { label: '标题', field: 'title', required: true, width: 28, hint: '同一篇文章的题目用相同标题' },
  { label: '正文', field: 'text', required: true, width: 70, hint: '首行填写整篇正文，段落之间空行' },
  { label: '等级', field: 'level', width: 10, hint: 'KET / PET' },
  { label: '主题', field: 'topic', width: 24 },
  { label: '标签', field: 'tags', width: 16 },
  { label: '来源', field: 'source', width: 26, hint: '如 Simple English Wikipedia（CC BY-SA）' },
  { label: '题号', field: 'seq', width: 8 },
  { label: '题干', field: 'stem', required: true, width: 50 },
  { label: '选项A', field: 'optionA', width: 26 },
  { label: '选项B', field: 'optionB', width: 26 },
  { label: '选项C', field: 'optionC', width: 26 },
  { label: '选项D', field: 'optionD', width: 26 },
  { label: '正确答案', field: 'answer', required: true, width: 10, hint: 'A / B / C / D' },
  { label: '解析', field: 'explain', width: 44 },
  { label: '备注', field: 'notes', width: 20 },
];

export const READING_ALIASES = {
  title: ['标题', '题目', '篇名', 'title'],
  text: ['正文', '文章', '短文', 'passage', 'text'],
  level: ['等级', '级别', '难度', 'level'],
  topic: ['主题', '话题', '分类', 'topic'],
  tags: ['标签', 'tags'],
  source: ['来源', '出处', 'source'],
  seq: ['题号', '序号', 'seq', 'no'],
  stem: ['题干', '问题', '题目问题', 'stem', 'question'],
  optionA: ['选项a', 'a选项', '选项１', 'optiona', 'a'],
  optionB: ['选项b', 'b选项', 'optionb', 'b'],
  optionC: ['选项c', 'c选项', 'optionc', 'c'],
  optionD: ['选项d', 'd选项', 'optiond', 'd'],
  answer: ['正确答案', '答案', 'answer', 'key'],
  explain: ['解析', '说明', 'explain'],
  notes: ['备注', 'notes'],
};

const norm = h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[：:]/g, '');

export function suggestReadingMap(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers) {
    const key = norm(h);
    if (!key) continue;
    for (const [field, aliases] of Object.entries(READING_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some(a => norm(a) === key)) { map[h] = field; used.add(field); break; }
    }
  }
  for (const h of headers) {
    if (map[h]) continue;
    const key = norm(h);
    for (const [field, aliases] of Object.entries(READING_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some(a => key.includes(norm(a)))) { map[h] = field; used.add(field); break; }
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

export async function buildReadingTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Words Buddy';
  const ws = wb.addWorksheet('阅读理解导入');
  ws.columns = READING_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);

  const text = 'Recycling is when people collect used things and make them into new products. Glass, paper, plastic and metal can all be recycled. Recycling saves energy and reduces the amount of rubbish that goes into the ground. In many towns, people have three bins: one for paper, one for plastic and one for food waste. Schools also teach children why recycling is important.';
  ws.addRow({
    title: 'Recycling in Our Town（示例行，导入时自动忽略）',
    text,
    level: 'PET', topic: 'Environment', tags: '环保', source: 'Simple English Wikipedia',
    seq: 1,
    stem: 'What is recycling?',
    optionA: 'Throwing things away', optionB: 'Making used things into new products',
    optionC: 'Burning rubbish', optionD: 'Buying new things',
    answer: 'B', explain: '第一句直接给出定义：collect used things and make them into new products.',
  });
  ws.addRow({
    title: 'Recycling in Our Town（示例行，导入时自动忽略）', text: '', level: 'PET', topic: 'Environment', tags: '环保',
    source: '', seq: 2,
    stem: 'How many bins do people usually have in many towns?',
    optionA: 'One', optionB: 'Two', optionC: 'Three', optionD: 'Four',
    answer: 'C', explain: '原文：people have three bins。',
  });

  const dict = wb.addWorksheet('_dict');
  dict.state = 'veryHidden';
  dict.getCell('A1').value = '等级';
  ['KET', 'PET'].forEach((v, i) => { dict.getCell(`A${i + 2}`).value = v; });
  ws.dataValidations.add('C2:C5000', {
    type: 'list', allowBlank: true, formula1: '=_dict!$A$2:$A$3',
    error: '等级建议填 KET / PET', errorTitle: '等级', showErrorMessage: false,
  });
  ws.dataValidations.add('M2:M5000', {
    type: 'list', allowBlank: false, formula1: '"A,B,C,D"',
    error: '正确答案只能是 A/B/C/D', errorTitle: '正确答案', showErrorMessage: true,
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 导出：一行一题，首行带正文（与模板一致，可再次导入） */
export async function exportReading(passages) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('阅读理解题库');
  ws.columns = READING_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);
  for (const p of passages) {
    (p.questions || []).forEach((q, i) => {
      ws.addRow({
        title: p.title,
        text: i === 0 ? p.text : '',
        level: p.level || '', topic: p.topic || '', tags: p.tags || '', source: p.source || '',
        seq: q.seq,
        stem: q.stem,
        optionA: q.options[0], optionB: q.options[1], optionC: q.options[2], optionD: q.options[3],
        answer: 'ABCD'[q.answerIndex],
        explain: q.explain || '',
        notes: '',
      });
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
