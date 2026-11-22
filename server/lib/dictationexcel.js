/** 听写句库导入模板与导出 */
import ExcelJS from 'exceljs';

export const DICTATION_COLUMNS = [
  { label: '句子', field: 'sentenceEn', required: true, width: 56, hint: '英文原句，如 She has a nice camera.' },
  { label: '中文', field: 'sentenceCn', required: true, width: 34, hint: '整句中文意思' },
  { label: '等级', field: 'level', width: 10 },
  { label: '主题', field: 'topic', width: 24 },
  { label: '标签', field: 'tags', width: 18 },
  { label: '来源', field: 'source', width: 26 },
  { label: '语法', field: 'grammarLabel', width: 16, hint: '如「主语和谓语」' },
  { label: '解析', field: 'analysis', width: 44 },
  { label: '逐词', field: 'tokens', width: 50, hint: '可选：JSON，如 [{"w":"She","pos":"代词","ipa":"/ʃi/","cn":"她"}]' },
];

export const DICTATION_ALIASES = {
  sentenceEn: ['句子', '英文', '原句', '英文句子', 'sentence', 'english'],
  sentenceCn: ['中文', '中文意思', '翻译', '句意', 'chinese', 'translation'],
  level: ['等级', '级别', 'level'],
  topic: ['主题', '话题', 'topic'],
  tags: ['标签', 'tags'],
  source: ['来源', '出处', 'source'],
  grammarLabel: ['语法', '语法标签', '成分', 'grammar', 'structure'],
  analysis: ['解析', '分析', '讲解', 'analysis'],
  tokens: ['逐词', '逐词解析', '单词解析', 'tokens'],
};

const norm = h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[：:]/g, '');

export function suggestDictationMap(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers) {
    const key = norm(h);
    if (!key) continue;
    for (const [field, aliases] of Object.entries(DICTATION_ALIASES)) {
      if (used.has(field)) continue;
      if (aliases.some(a => norm(a) === key)) { map[h] = field; used.add(field); break; }
    }
  }
  for (const h of headers) {
    if (map[h]) continue;
    const key = norm(h);
    for (const [field, aliases] of Object.entries(DICTATION_ALIASES)) {
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

export async function buildDictationTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Words Buddy';
  const ws = wb.addWorksheet('听写句库导入');
  ws.columns = DICTATION_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);
  ws.addRow({
    sentenceEn: 'She has a nice camera.（示例行，导入时自动忽略，可删除）',
    sentenceCn: '她有一台好看的相机。',
    level: 'PET', topic: 'Hobbies and Leisure', tags: '日常', source: '示例',
    grammarLabel: '主语和谓语',
    analysis: '主语 She + 谓语 has + 宾语 a nice camera。',
    tokens: JSON.stringify([
      { w: 'She', pos: '代词', ipa: '/ʃi/', cn: '她' },
      { w: 'has', pos: '动词', ipa: '/hæz/', cn: '有' },
      { w: 'a', pos: '限定词', ipa: '/ə/', cn: '一个' },
      { w: 'nice', pos: '形容词', ipa: '/naɪs/', cn: '好看的' },
      { w: 'camera', pos: '名词', ipa: '/ˈkæmərə/', cn: '相机' },
    ]),
  });
  ws.addRow({
    sentenceEn: 'I can swim.', sentenceCn: '我会游泳。', level: 'KET', topic: 'Sport', tags: '能力',
    source: '', grammarLabel: '主语和谓语',
    analysis: '主语 I + 谓语 can swim。',
    tokens: JSON.stringify([
      { w: 'I', pos: '代词', ipa: '/aɪ/', cn: '我' },
      { w: 'can', pos: '助动词', ipa: '/kæn/', cn: '能够' },
      { w: 'swim', pos: '动词', ipa: '/swɪm/', cn: '游泳' },
    ]),
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportDictation(items) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('听写句库');
  ws.columns = DICTATION_COLUMNS.map(c => ({ header: c.label, key: c.field, width: c.width }));
  styleHeader(ws);
  for (const it of items) {
    ws.addRow({
      sentenceEn: it.sentenceEn, sentenceCn: it.sentenceCn || '', level: it.level || '',
      topic: it.topic || '', tags: it.tags || '', source: it.source || '',
      grammarLabel: it.grammarLabel || '', analysis: it.analysis || '',
      tokens: (it.tokens && it.tokens.length) ? JSON.stringify(it.tokens) : '',
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
