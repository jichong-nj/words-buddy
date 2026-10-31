import { POS_PREFIX_RE } from '../../shared/topic-taxonomy.js';

/** 义项分隔：换行 + 全角分号 + 竖线。故意不用半角 ; —— 英文释义里大量出现 */
const SPLIT_RE = /[\r\n]+|[；|｜]/;

export function splitSegments(text) {
  if (text === null || text === undefined) return [];
  return String(text).split(SPLIT_RE).map(s => s.trim()).filter(Boolean);
}

/** 拆出词性前缀，返回 {pos, rest}；没有前缀则 pos=null（绝不猜） */
export function stripPosPrefix(text) {
  const m = String(text).match(POS_PREFIX_RE);
  if (!m) return { pos: null, rest: String(text).trim() };
  return { pos: m[1].toLowerCase(), rest: String(text).slice(m[0].length).trim() };
}

/**
 * 把一行 Excel 数据解析成义项数组。
 * 支持三种写法：①一格内换行且带词性前缀 ②一词多行（由上层 mergeSenses 合并）③用 ；或 | 分隔
 * @param {{pos?:string,def_cn?:string,def_en?:string,example_en?:string,example_cn?:string}} row
 */
export function parseSenses(row) {
  const rowPos = (row.pos || '').trim() || null;
  const cnSegs = splitSegments(row.def_cn);
  const enSegs = splitSegments(row.def_en);
  const exSegs = splitSegments(row.example_en);
  const excSegs = splitSegments(row.example_cn);

  // 以中文释义为主轴；没有中文释义时退化为以英文释义为主轴
  const anchor = cnSegs.length ? cnSegs : enSegs;
  if (!anchor.length) {
    // 什么释义都没有：整行作为一个空义项，由上层决定是否标记待补充
    return [{ pos: rowPos, def_cn: null, def_en: null, example_en: null, example_cn: null }];
  }

  // 英文/例句只有在「段数与主轴一致」时才按位对齐，否则整体挂到第一义项，避免错位
  const alignEn = enSegs.length === anchor.length ? enSegs : null;
  const alignEx = exSegs.length === anchor.length ? exSegs : null;
  const alignExc = excSegs.length === anchor.length ? excSegs : null;

  return anchor.map((seg, i) => {
    const { pos, rest } = stripPosPrefix(seg);
    return {
      pos: pos || rowPos,
      def_cn: cnSegs.length ? rest : null,
      def_en: alignEn ? alignEn[i] : (i === 0 ? enSegs.join(' ') || null : null),
      example_en: alignEx ? alignEx[i] : (i === 0 ? exSegs.join(' ') || null : null),
      example_cn: alignExc ? alignExc[i] : (i === 0 ? excSegs.join(' ') || null : null),
    };
  });
}

export function normWord(w) {
  return String(w ?? '').trim().toLowerCase();
}

export function splitTags(t) {
  if (!t) return [];
  return String(t).split(/[,，、;；]/).map(s => s.trim()).filter(Boolean);
}

export function joinTags(arr) {
  return [...new Set((arr || []).map(s => String(s).trim()).filter(Boolean))].join(',');
}

/** 单词长度是否落在练习区间内 */
export function lengthOk(w, min, max) {
  const n = String(w).replace(/[^A-Za-z]/g, '').length;
  return n >= min && n <= max;
}
