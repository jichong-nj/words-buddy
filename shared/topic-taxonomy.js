// 剑桥官方 Topic 体系（A2 Key / B1 Preliminary 词汇表 Appendix 2，2025-08 版）
// 存储值 = 官方英文标题原文；界面显示「中文（English）」。
// 这是常量字典，不是数据库表。word.topic 存英文原文。

export const TOPICS = {
  KET: [
    { key: 'Appliances', cn: '家用电器' },
    { key: 'Clothes and Accessories', cn: '服装与配饰' },
    { key: 'Colours', cn: '颜色' },
    { key: 'Communication and Technology', cn: '通讯与科技' },
    { key: 'Documents and Texts', cn: '文档与文本' },
    { key: 'Education', cn: '教育' },
    { key: 'Entertainment and Media', cn: '娱乐与媒体' },
    { key: 'Family and Friends', cn: '家人与朋友' },
    { key: 'Food and Drink', cn: '饮食' },
    { key: 'Health, Medicine and Exercise', cn: '健康、医疗与锻炼' },
    { key: 'Hobbies and Leisure', cn: '爱好与休闲' },
    { key: 'House and Home', cn: '房屋与家' },
    { key: 'Measurements', cn: '度量' },
    { key: 'Places: Buildings', cn: '地点：建筑物' },
    { key: 'Places: Countryside', cn: '地点：乡村' },
    { key: 'Places: Town and City', cn: '地点：城镇与城市' },
    { key: 'Services', cn: '服务' },
    { key: 'Shopping', cn: '购物' },
    { key: 'Sport', cn: '体育运动' },
    { key: 'The Natural World', cn: '自然世界' },
    { key: 'Time', cn: '时间' },
    { key: 'Travel and Transport', cn: '旅行与交通' },
    { key: 'Weather', cn: '天气' },
    { key: 'Work and Jobs', cn: '工作与职业' },
  ],
  PET: [
    { key: 'Clothes and Accessories', cn: '服装与配饰' },
    { key: 'Colours', cn: '颜色' },
    { key: 'Communications and Technology', cn: '通讯与科技' },
    { key: 'Education', cn: '教育' },
    { key: 'Entertainment and Media', cn: '娱乐与媒体' },
    { key: 'Environment', cn: '环境' },
    { key: 'Food and Drink', cn: '饮食' },
    { key: 'Health, Medicine and Exercise', cn: '健康、医疗与锻炼' },
    { key: 'Hobbies and Leisure', cn: '爱好与休闲' },
    { key: 'House and Home', cn: '房屋与家' },
    { key: 'Language', cn: '语言' },
    { key: 'Places: Buildings', cn: '地点：建筑物' },
    { key: 'Places: Countryside', cn: '地点：乡村' },
    { key: 'Places: Town and City', cn: '地点：城镇与城市' },
    { key: 'Services', cn: '服务' },
    { key: 'Shopping', cn: '购物' },
    { key: 'Sport', cn: '体育运动' },
    { key: 'The Natural World', cn: '自然世界' },
    { key: 'Time', cn: '时间' },
    { key: 'Travel and Transport', cn: '旅行与交通' },
    { key: 'Weather', cn: '天气' },
    { key: 'Work and Jobs', cn: '工作与职业' },
  ],
};

/** 取某等级的主题表；未知等级返回空数组（此时不做主题校验） */
export function topicsForLevel(level) {
  const l = String(level || '').trim().toUpperCase();
  if (l === 'KET') return TOPICS.KET;
  if (l === 'PET') return TOPICS.PET;
  if (l === 'KET+PET' || l === 'PET+KET' || l === 'KET&PET') {
    const seen = new Map();
    for (const t of [...TOPICS.KET, ...TOPICS.PET]) if (!seen.has(t.key)) seen.set(t.key, t);
    return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
  return [];
}

/** 该等级是否受官方主题体系约束 */
export function hasTaxonomy(level) {
  return topicsForLevel(level).length > 0;
}

export function topicCn(topic, level = null) {
  const pools = level ? [topicsForLevel(level)] : [TOPICS.KET, TOPICS.PET];
  for (const p of pools) {
    const hit = p.find(t => t.key === topic);
    if (hit) return hit.cn;
  }
  return null;
}

/** 词性枚举（导入校验用，不在枚举内只警告不报错） */
export const POS_SET = new Set([
  'n.', 'v.', 'vt.', 'vi.', 'adj.', 'adv.', 'prep.', 'conj.', 'pron.',
  'num.', 'int.', 'aux.', 'modal', 'art.', 'abbr.', 'pl.', 'det.', 'phr.',
]);

/** 义项拆分用的词性前缀正则：允许 n./v.、n/v. 这类合并写法 */
export const POS_PREFIX_RE =
  /^((?:n|v|vt|vi|adj|adv|prep|conj|pron|num|int|aux|modal|art|abbr|pl|det|phr)\.(?:\/(?:n|v|vt|vi|adj|adv|prep|conj|pron|num|int|aux|modal|art|abbr|pl|det|phr)\.)*)\s*/i;
