/** 把数据库里的听写句库导出为种子 CSV（合并成单一文件，供首次安装导入） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db/index.js';
import { config } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'server', 'seed', 'dictation-items.csv');
const db = openDb(config.dbFile);
const rows = db.prepare(`
  SELECT sentence_en, sentence_cn, level, topic, tags, source, grammar_label, analysis, tokens_json
  FROM dictation_item ORDER BY id`).all();
db.close();

const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const head = ['句子', '中文', '等级', '主题', '标签', '来源', '语法', '解析', '逐词'];
const lines = rows.map(r => [
  r.sentence_en, r.sentence_cn || '', r.level || '', r.topic || '', r.tags || '',
  r.source || '', r.grammar_label || '', r.analysis || '', r.tokens_json || '',
].map(cell).join(','));
fs.writeFileSync(OUT, [head.map(cell).join(','), ...lines].join('\n') + '\n', 'utf8');
console.log(`导出 ${rows.length} 句 → ${path.relative(path.join(__dirname, '..'), OUT)}`);
