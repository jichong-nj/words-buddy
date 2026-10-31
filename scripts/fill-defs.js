/**
 * 回填英文释义：给词库里「有中文释义但缺 def_en」的义项补上 WordNet 释义。
 *
 * 用法：
 *   node scripts/fill-defs.js                     # 全库预览（不写库）
 *   node scripts/fill-defs.js --bank 4 --write    # 只处理词库 4 并写库
 *   node scripts/fill-defs.js --all --write       # 全库写库
 *   node scripts/fill-defs.js --limit 100         # 只看前 100 条
 *
 * 说明：「看释义写单词」练习要求 def_en 长度 ≥ 8，回填后这些词就能进入练习池。
 * 回填来源标记为 wordnet（手动改过的词不会被覆盖，因为只处理 def_en 为空的义项）。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lookupSmart } from '../server/lib/wordnet.js';
import { openDb } from '../server/db/index.js';
import { config } from '../server/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = name => {
  const eq = argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

const BANK = Number(opt('bank') || 0) || null;
const LIMIT = Number(opt('limit') || 0) || 0;
const WRITE = flag('write');
const MIN_LEN = 8;

const C = { dim: s => `\x1b[2m${s}\x1b[0m`, green: s => `\x1b[32m${s}\x1b[0m`, red: s => `\x1b[31m${s}\x1b[0m`, yellow: s => `\x1b[33m${s}\x1b[0m` };

function collect(db) {
  const where = ["length(trim(coalesce(s.def_en,''))) = 0"];
  const params = [];
  if (BANK) { where.push('w.bank_id = ?'); params.push(BANK); }
  const sql = `
    SELECT s.id AS senseId, w.id AS wordId, w.word, w.topic, w.bank_id AS bankId, b.name AS bankName,
           s.pos, s.def_cn AS defCn, s.def_en AS defEn, s.example_en AS exampleEn
    FROM word_sense s
    JOIN word w ON w.id = s.word_id
    JOIN word_bank b ON b.id = w.bank_id
    WHERE ${where.join(' AND ')}
    ORDER BY b.id, w.word, s.sort`;
  const rows = db.prepare(sql).all(...params);
  return LIMIT ? rows.slice(0, LIMIT) : rows;
}

function main() {
  const db = openDb(config.dbFile);
  try {
    const rows = collect(db);
    if (!rows.length) {
      console.log('没有缺英文释义的义项，无需回填。');
      return;
    }
    console.log(`待回填义项 ${rows.length} 条${BANK ? `（词库 #${BANK}）` : '（全部词库）'}：\n`);

    const uniq = new Map();   // word|pos → 本次解析结果，避免重复查 WordNet
    const updates = [];
    const missing = [];
    for (const r of rows) {
      const key = `${r.word.toLowerCase()}|${r.pos || ''}`;
      let hit = uniq.get(key);
      if (hit === undefined) {
        const res = lookupSmart(r.word, r.pos);
        hit = res.sense ? { def: res.sense.def, example: res.sense.example || '', matched: res.matched } : null;
        uniq.set(key, hit);
      }
      if (!hit || hit.def.length < MIN_LEN) { missing.push(r); continue; }
      updates.push({ ...r, def: hit.def, example: hit.example, matched: hit.matched });
    }

    const byBank = new Map();
    for (const u of updates) byBank.set(u.bankName, (byBank.get(u.bankName) || 0) + 1);

    for (const u of updates) {
      const tag = u.matched && u.matched !== u.word.toLowerCase() ? C.dim(` (${u.word.toLowerCase()}←${u.matched})`) : '';
      console.log(`  ${C.green('✓')} #${u.bankId} ${u.word.padEnd(18)} ${(u.pos || '').padEnd(6)} ${(u.defCn || '').slice(0, 12).padEnd(14)} → ${u.def.slice(0, 70)}${tag}`);
    }
    for (const m of missing) {
      console.log(`  ${C.red('✗')} #${m.bankId} ${m.word.padEnd(18)} ${(m.pos || '').padEnd(6)} ${(m.defCn || '').slice(0, 12).padEnd(14)} → WordNet 查不到，需要手工补 def_en`);
    }

    console.log('');
    for (const [name, n] of byBank) console.log(`  ${C.yellow(name)}：可回填 ${n} 条`);
    console.log(`  合计可回填 ${updates.length} 条，未匹配 ${missing.length} 条`);

    if (!WRITE) {
      console.log('\n预览模式，未写库。确认无误后加 --write 执行回填。');
      return;
    }
    const upd = db.prepare(`UPDATE word_sense SET def_en=?, def_en_source='wordnet',
                              example_en=CASE WHEN length(trim(coalesce(example_en,'')))>0 THEN example_en ELSE ? END,
                              updated_at=datetime('now','localtime')
                            WHERE id=? AND length(trim(coalesce(def_en,''))) = 0`);
    let changed = 0;
    db.transaction(() => {
      for (const u of updates) changed += upd.run(u.def, u.example, u.senseId).changes;
    })();
    console.log(`\n已回填 ${changed} 条英文释义。`);
  } finally {
    db.close();
  }
}

main();
