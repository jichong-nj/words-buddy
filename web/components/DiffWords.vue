<template>
  <div class="diff-words" :class="{ dark }">
    <template v-for="(d, i) in ops" :key="i">
      <!-- 答对：显示正确答案（绿） -->
      <span v-if="d.status === 'correct'" class="dw ok">{{ d.expected }}</span>
      <!-- 写错：只显示学生自己打的词（红），不泄露正确答案 -->
      <span v-else-if="d.status === 'wrong'" class="dw bad">{{ d.got }}</span>
      <!-- 漏词：留出与正确答案单词等宽的红色空槽 -->
      <span v-else-if="d.status === 'missing'" class="dw slot" :style="{ width: slotWidth(d) }"></span>
      <!-- 多写：显示多出来的词（红） -->
      <span v-else class="dw bad extra" :title="d.expected ? `应为 ${d.expected}` : ''">{{ d.got }}</span>
    </template>
    <span v-if="!ops.length" class="dw empty">（暂无对比数据）</span>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  diff: { type: Array, default: () => [] },
  // 深色（听写答题页）配色；默认浅色（记录详情 / 结果页）
  dark: { type: Boolean, default: false },
});

const ops = computed(() => (Array.isArray(props.diff) ? props.diff : []));

// 空槽宽度按正确答案单词长度（等宽字体 ch 单位）
function slotWidth(d) {
  const n = Math.max(1, String(d.expected || '').length);
  return `${n}ch`;
}
</script>

<style scoped>
.diff-words {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace;
  font-size: 15px;
  line-height: 1.9;
  word-break: break-word;
}

.dw {
  display: inline-block;
  white-space: pre;
}

.dw.ok {
  color: #67c23a;
  font-weight: 600;
}

.dw.bad {
  color: #f56c6c;
  font-weight: 600;
}

.dw.extra {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  text-decoration-color: rgba(245, 108, 108, 0.55);
}

.dw.slot {
  height: 1.35em;
  min-height: 20px;
  border-bottom: 2px solid #f56c6c;
  border-radius: 2px;
  background: rgba(245, 108, 108, 0.12);
  align-self: center;
}

.dw.empty {
  color: #909399;
  font-weight: 400;
  font-family: inherit;
}

/* 深色答题页配色 */
.diff-words.dark {
  font-size: 16px;
}

.diff-words.dark .dw.ok {
  color: #4ade80;
}

.diff-words.dark .dw.bad {
  color: #f87171;
}

.diff-words.dark .dw.slot {
  border-bottom-color: #f87171;
  background: rgba(248, 113, 113, 0.18);
}

.diff-words.dark .dw.extra {
  text-decoration-color: rgba(248, 113, 113, 0.6);
}

.diff-words.dark .dw.empty {
  color: #8b98a9;
}
</style>
