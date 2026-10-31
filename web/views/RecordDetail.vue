<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">练习记录 #{{ id }}</h2>
        <div class="meta" v-if="session">
          {{ session.bankName || (session.mode === 'form_fill' ? '变形题库'
            : session.mode === 'reading' ? '阅读理解题库'
            : session.mode === 'shadowing' ? '跟读题库' : '') }}
          <template v-if="session.mode === 'form_fill'">[变形填空] </template>
          <template v-else-if="session.mode === 'reading'">[阅读理解] </template>
          <template v-else-if="session.mode === 'shadowing'">[跟读练习] </template>
          <template v-if="session.mode === 'shadowing'">· 平均分 <b>{{ session.score }}</b>（已录音 {{ session.correct }}/{{ session.total }} 句）</template>
          <template v-else>· 得分 <b>{{ session.score }}</b>（{{ session.correct }}/{{ session.total }}）</template>
          · {{ session.startedAt }}
          <template v-if="session.durationMs"> · 用时 {{ fmtSec(session.durationMs) }}</template>
          · {{ session.status === 'finished' ? '已完成' : '进行中' }}
        </div>
      </div>
      <div class="actions">
        <el-button @click="$router.push('/records')">返回列表</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <div v-if="session && session.mode === 'reading'" class="reading-groups">
        <el-empty v-if="!passageGroups.length" description="本次练习没有作答记录" :image-size="60" />
        <div v-for="g in passageGroups" :key="g.title" class="p-group">
          <div class="p-title">{{ g.title }}</div>
          <el-collapse v-if="g.text" class="p-collapse">
            <el-collapse-item title="查看原文" name="t">
              <div class="p-text">{{ g.text }}</div>
            </el-collapse-item>
          </el-collapse>
          <el-table :data="g.items" :row-class-name="rowClass">
            <el-table-column prop="seq" label="#" width="55" />
            <el-table-column prop="stem" label="题干" min-width="240" show-overflow-tooltip />
            <el-table-column label="你的选择" width="220">
              <template #default="{ row }">
                <span :class="row.isCorrect ? 'ok' : 'bad'">{{ chosenText(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="正确答案" width="220">
              <template #default="{ row }">{{ correctText(row) }}</template>
            </el-table-column>
            <el-table-column label="解析" min-width="180" show-overflow-tooltip>
              <template #default="{ row }">{{ row.explain || '—' }}</template>
            </el-table-column>
            <el-table-column label="结果" width="80">
              <template #default="{ row }">
                <el-tag :type="row.isCorrect ? 'success' : 'danger'" size="small">
                  {{ row.isCorrect ? '对' : '错' }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
      <el-table v-else-if="session && session.mode === 'form_fill'" :data="items" :row-class-name="rowClass"
                empty-text="本次练习没有作答记录">
        <el-table-column prop="seq" label="#" width="55" />
        <el-table-column prop="prompt" label="句子" min-width="260" show-overflow-tooltip />
        <el-table-column prop="base" label="原型" width="110" show-overflow-tooltip />
        <el-table-column label="你的答案" width="150">
          <template #default="{ row }">
            <span :class="row.isCorrect ? 'ok' : 'bad'">{{ row.given || '（未作答）' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="answer" label="正确答案" width="150" show-overflow-tooltip />
        <el-table-column label="句子意思" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">{{ row.sentenceCn || '—' }}</template>
        </el-table-column>
        <el-table-column label="词义" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.wordCn || '—' }}</template>
        </el-table-column>
        <el-table-column prop="point" label="考点" width="100">
          <template #default="{ row }">{{ row.point || '—' }}</template>
        </el-table-column>
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag :type="row.isCorrect ? 'success' : 'danger'" size="small">
              {{ row.isCorrect ? '对' : '错' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
      <el-table v-else-if="session && session.mode === 'shadowing'" :data="items" :row-class-name="rowClass"
                empty-text="本次练习没有录音">
        <el-table-column prop="seq" label="#" width="55" />
        <el-table-column prop="sentence" label="原句" min-width="260" show-overflow-tooltip />
        <el-table-column label="中文意思" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.sentenceCn || '—' }}</template>
        </el-table-column>
        <el-table-column label="得分" width="110">
          <template #default="{ row }">
            <template v-if="row.score !== null && row.score !== undefined">
              <b :class="scoreClass(row.score)">{{ row.score }}</b>
              <el-tag v-if="row.offTarget" type="warning" size="small" class="ml6">跑题</el-tag>
            </template>
            <el-tag v-else type="info" size="small">{{ shadowFailText(row.reason) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="分项" min-width="240">
          <template #default="{ row }">
            <span v-if="row.score !== null && row.score !== undefined" class="subs">
              音准 {{ row.pitch }} · 节奏 {{ row.rhythm }} · 流利 {{ row.fluency }} · 完整 {{ row.completeness }}
            </span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="160">
          <template #default="{ row }">
            <span v-if="row.refMs" class="subs">原句 {{ fmtSec(row.refMs) }} / 我 {{ fmtSec(row.stuMs) }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="回听" width="250">
          <template #default="{ row }">
            <audio v-if="row.audioPath" :src="audioUrl(row.seq)" controls preload="none" class="player" />
            <span v-else>—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-table v-else :data="items" :row-class-name="rowClass" empty-text="本次练习没有作答记录">
        <el-table-column prop="seq" label="#" width="55" />
        <el-table-column prop="stem" label="题干" min-width="220" show-overflow-tooltip />
        <el-table-column label="你的答案" width="160">
          <template #default="{ row }">
            <span :class="row.isCorrect ? 'ok' : 'bad'">{{ row.given || '（未作答）' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="answer" label="正确答案" width="160" />
        <el-table-column label="可接受写法" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            {{ row.accepted && row.accepted.length ? row.accepted.join(' / ') : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="对错" width="80">
          <template #default="{ row }">
            <el-tag :type="row.isCorrect ? 'success' : 'danger'" size="small">
              {{ row.isCorrect ? '对' : '错' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ fmtSec(row.latencyMs) }}</template>
        </el-table-column>
        <el-table-column label="词 / 释义" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <b v-if="row.word">{{ row.word }}</b>
            <span v-if="row.pos" class="muted"> {{ row.pos }}</span>
            <span v-if="row.defEn"> · {{ row.defEn }}</span>
            <span v-if="!row.word && !row.defEn">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { fmtSec, shadowFailText } from '../utils.js';

const route = useRoute();
const id = route.params.id;

const loading = ref(false);
const session = ref(null);
const items = ref([]);

// 阅读理解：按文章标题分组（同标题合并）
const passageGroups = computed(() => {
  const map = new Map();
  for (const it of items.value) {
    const key = it.passageTitle || '文章';
    if (!map.has(key)) map.set(key, { title: key, text: it.passageText || '', items: [] });
    const g = map.get(key);
    if (!g.text && it.passageText) g.text = it.passageText;
    g.items.push(it);
  }
  return [...map.values()];
});

function letter(i) {
  return i >= 0 && i < 4 ? 'ABCD'[i] : '';
}
function chosenText(row) {
  if (row.chosenIndex === null || row.chosenIndex === undefined) return '（未作答）';
  const o = (row.options || [])[row.chosenIndex];
  return `${letter(row.chosenIndex)}. ${o ?? ''}`;
}
function correctText(row) {
  if (!row.answerText) return '—';
  const l = letter(row.answerIndex);
  return l ? `${l}. ${row.answerText}` : row.answerText;
}

function scoreClass(v) {
  return v >= 85 ? 'ok' : v >= 70 ? 'warn' : 'bad';
}

// 跟读录音回听（走鉴权接口，浏览器自带 cookie）
function audioUrl(seq) {
  return `/api/shadow/sessions/${id}/audio/${seq}`;
}

function rowClass({ row }) {
  if (session.value?.mode === 'shadowing') return row.score === null ? 'row-bad' : '';
  return row.isCorrect ? '' : 'row-bad';
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/practice/sessions/${id}`);
    session.value = d.session || d;
    items.value = d.items || [];
  } catch { /* 已提示 */ } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.ok { color: #67c23a; font-weight: 600; }
.warn { color: #e6a23c; font-weight: 600; }
.bad { color: #f56c6c; font-weight: 600; }
.subs { font-size: 12px; color: #909399; }
.ml6 { margin-left: 6px; }
.player { height: 30px; width: 230px; vertical-align: middle; }
:deep(.row-bad) { background: #fef0f0; }
.p-group { margin-bottom: 22px; }
.p-group:last-child { margin-bottom: 0; }
.p-title { font-size: 16px; font-weight: 700; margin-bottom: 6px; }
.p-collapse { margin-bottom: 10px; }
.p-collapse :deep(.el-collapse-item__header) { font-size: 13px; color: #409eff; }
.p-text { white-space: pre-wrap; line-height: 1.8; font-size: 14px; color: #606266; max-height: 300px; overflow-y: auto; }
</style>
