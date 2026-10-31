<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">错题集</h2>
        <div class="meta">自动收集练习中答错的题目，定期回顾巩固</div>
      </div>
      <div class="actions">
        <span class="muted">显示已移除</span>
        <el-switch v-model="showRemoved" @change="reload" />
      </div>
    </div>

    <el-tabs v-model="tab" @tab-change="reload">
      <el-tab-pane name="" :label="`全部（${summary.total ?? 0}）`" />
      <el-tab-pane v-for="t in summary.byType" :key="t.qtype" :name="t.qtype"
                   :label="`${t.label}（${t.count}）`" />
    </el-tabs>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="reload">
        <el-form-item label="搜索">
          <el-input v-model="q" placeholder="搜索题目内容" clearable style="width: 260px"
                    @keyup.enter="reload" @clear="reload" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reload">查询</el-button>
          <el-button v-if="!showRemoved" :disabled="!selection.length" type="danger" plain
                     @click="batchRemove">
            批量移出错题集（{{ selection.length }}）
          </el-button>
          <el-button v-else :disabled="!selection.length" type="primary" plain @click="batchRestore">
            批量恢复（{{ selection.length }}）
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table v-if="items.length" :data="items" @selection-change="selection = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="题目" min-width="340">
          <template #default="{ row }">
            <div class="cell">
              <el-tag size="small" type="info" class="type-tag">{{ row.qtypeLabel }}</el-tag>
              <span v-if="row.removed" class="removed-tag">已移除</span>

              <!-- 释义填空 -->
              <template v-if="row.qtype === 'definition'">
                <span class="q-main">{{ row.snapshot.defCn || row.snapshot.stem || row.snapshot.word }}</span>
                <span v-if="row.snapshot.pos" class="muted">（{{ row.snapshot.pos }}）</span>
                <span class="answer">→ <b class="mono">{{ row.snapshot.answer || row.snapshot.word }}</b></span>
              </template>

              <!-- 变形填空 -->
              <template v-else-if="row.qtype === 'form'">
                <span class="q-main">
                  <template v-for="(seg, i) in segs(row.snapshot.prompt)" :key="i">
                    <span v-if="seg.blank" class="blank">______</span><span v-else>{{ seg.text }}</span>
                  </template>
                </span>
                <span class="muted">原型 {{ row.snapshot.base }}</span>
                <span class="answer">→ <b class="mono">{{ row.snapshot.answer }}</b></span>
                <el-tag v-if="row.snapshot.point" size="small" class="point-tag">{{ row.snapshot.point }}</el-tag>
                <span v-if="row.snapshot.sentenceCn" class="cn-line">句意：{{ row.snapshot.sentenceCn }}</span>
                <span v-if="row.snapshot.wordCn" class="cn-line">词义：{{ row.snapshot.wordCn }}</span>
              </template>

              <!-- 阅读理解 -->
              <template v-else-if="row.qtype === 'reading'">
                <span class="q-main">
                  <span class="p-title">【{{ row.snapshot.passageTitle }}】</span>{{ row.snapshot.stem }}
                </span>
                <span class="answer">→ <b class="mono">{{ letter(row.snapshot.answerIndex) }}. {{ row.snapshot.answerText }}</b></span>
              </template>

              <template v-else>
                <span class="q-main">{{ row.snapshot.stem || row.snapshot.prompt || '—' }}</span>
              </template>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="wrongCount" label="错次" width="70" align="center">
          <template #default="{ row }"><span class="bad">{{ row.wrongCount }}</span></template>
        </el-table-column>
        <el-table-column prop="rightCount" label="对次" width="70" align="center">
          <template #default="{ row }"><span class="ok">{{ row.rightCount }}</span></template>
        </el-table-column>
        <el-table-column prop="lastWrongAt" label="最近答错" width="160" />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            <el-button v-if="!row.removed" size="small" text type="danger" @click="removeOne(row)">移出错题集</el-button>
            <el-button v-else size="small" text type="primary" @click="restoreOne(row)">恢复</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else :description="showRemoved ? '没有已移除的错题' : '还没有错题，继续保持！'" :image-size="90" />

      <el-pagination v-if="total > size" class="pager" layout="total, prev, pager, next"
                     :total="total" v-model:current-page="page" :page-size="size"
                     @current-change="load" />
    </el-card>

    <!-- 详情 -->
    <el-dialog v-model="detail.open" title="错题详情" width="640px">
      <template v-if="detail.row">
        <el-tag size="small" type="info">{{ detail.row.qtypeLabel }}</el-tag>
        <span class="muted" style="margin-left: 10px">
          答错 {{ detail.row.wrongCount }} 次 · 之后答对 {{ detail.row.rightCount }} 次
        </span>

        <!-- 释义填空 -->
        <div v-if="detail.row.qtype === 'definition'" class="d-block">
          <div class="d-word mono">{{ detail.row.snapshot.word }}</div>
          <div class="d-line">
            <el-tag v-if="detail.row.snapshot.pos" size="small">{{ detail.row.snapshot.pos }}</el-tag>
            <span style="margin-left: 8px">{{ detail.row.snapshot.defCn }}</span>
          </div>
          <div v-if="detail.row.snapshot.stem" class="d-line muted">{{ detail.row.snapshot.stem }}</div>
          <div class="d-line">正确答案：<b class="mono blue">{{ detail.row.snapshot.answer || detail.row.snapshot.word }}</b></div>
        </div>

        <!-- 变形填空 -->
        <div v-else-if="detail.row.qtype === 'form'" class="d-block">
          <div class="d-sentence">
            <template v-for="(seg, i) in segs(detail.row.snapshot.prompt)" :key="i">
              <span v-if="seg.blank" class="blank">______</span><span v-else>{{ seg.text }}</span>
            </template>
          </div>
          <div class="d-line">原型：<b class="mono">{{ detail.row.snapshot.base }}</b>
            <el-tag v-if="detail.row.snapshot.point" size="small" class="point-tag">{{ detail.row.snapshot.point }}</el-tag>
          </div>
          <div class="d-line">正确答案：<b class="mono blue">{{ detail.row.snapshot.answer }}</b></div>
          <div v-if="detail.row.snapshot.sentenceCn" class="d-line">句子意思：{{ detail.row.snapshot.sentenceCn }}</div>
          <div v-if="detail.row.snapshot.wordCn" class="d-line">词义：<b class="mono">{{ detail.row.snapshot.base }}</b>：{{ detail.row.snapshot.wordCn }}</div>
          <div v-if="detail.row.snapshot.explain" class="explain">解析：{{ detail.row.snapshot.explain }}</div>
        </div>

        <!-- 阅读理解 -->
        <div v-else-if="detail.row.qtype === 'reading'" class="d-block">
          <div class="d-title">{{ detail.row.snapshot.passageTitle }}</div>
          <div class="d-sentence">{{ detail.row.snapshot.stem }}</div>
          <div class="d-opts">
            <div v-for="(o, oi) in detail.row.snapshot.options" :key="oi"
                 class="d-opt" :class="oi === detail.row.snapshot.answerIndex ? 'right' : ''">
              <b>{{ 'ABCD'[oi] }}.</b> {{ o }}
            </div>
          </div>
          <div v-if="detail.row.snapshot.explain" class="explain">解析：{{ detail.row.snapshot.explain }}</div>
          <el-collapse v-if="detail.row.snapshot.passageText" class="origin">
            <el-collapse-item title="查看原文" name="t">
              <div class="p-text">{{ detail.row.snapshot.passageText }}</div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </template>
      <template #footer>
        <el-button @click="detail.open = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { qs } from '../utils.js';

const loading = ref(false);
const tab = ref('');           // '' 全部 | definition | form | reading
const q = ref('');
const showRemoved = ref(false);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const selection = ref([]);
const summary = ref({ total: 0, byType: [] });
const detail = reactive({ open: false, row: null });

function segs(prompt) {
  const parts = String(prompt || '').split(/_{2,}/);
  const out = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push({ blank: true });
    if (p) out.push({ blank: false, text: p });
  });
  return out;
}

function letter(i) {
  return i >= 0 && i < 4 ? 'ABCD'[i] : '—';
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/mistakes${qs({
      type: tab.value || undefined,
      q: q.value || undefined,
      removed: showRemoved.value ? '1' : undefined,
      page: page.value,
      size,
    })}`);
    items.value = d.items || [];
    total.value = d.total || 0;
    if (d.summary) summary.value = d.summary;
  } catch { /* 已提示 */ } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  load();
}

function openDetail(row) {
  detail.row = row;
  detail.open = true;
}

async function doAction(path, ids, confirmText, title, okText) {
  try {
    await ElMessageBox.confirm(confirmText, title, { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post(path, { ids });
    ElMessage.success(okText.replace('{n}', d[path.includes('restore') ? 'restored' : 'removed'] ?? ids.length));
    load();
  } catch { /* 已提示 */ }
}

function removeOne(row) {
  doAction('/api/mistakes/remove', [row.id], '确定将这道题移出错题集吗？', '移出错题集', '已移出错题集（{n}）');
}

function restoreOne(row) {
  doAction('/api/mistakes/restore', [row.id], '确定恢复这道错题吗？', '恢复错题', '已恢复（{n}）');
}

function batchRemove() {
  const ids = selection.value.map(r => r.id);
  if (!ids.length) return;
  doAction('/api/mistakes/remove', ids, `确定将选中的 ${ids.length} 道题移出错题集吗？`, '批量移出', '已移出错题集（{n}）');
}

function batchRestore() {
  const ids = selection.value.map(r => r.id);
  if (!ids.length) return;
  doAction('/api/mistakes/restore', ids, `确定恢复选中的 ${ids.length} 道错题吗？`, '批量恢复', '已恢复（{n}）');
}

onMounted(load);
</script>

<style scoped>
.actions { display: flex; align-items: center; gap: 8px; }
.muted { color: #909399; font-size: 13px; }
.filter-card { margin-bottom: 0; }
.filter-card :deep(.el-form-item) { margin-bottom: 8px; }
.cell { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.type-tag { flex: none; }
.removed-tag {
  flex: none; font-size: 11px; color: #909399; border: 1px solid #c0c4cc;
  border-radius: 3px; padding: 0 4px;
}
.q-main { font-weight: 500; }
.answer .mono { color: #409eff; }
.point-tag { margin-left: 6px; }
.cn-line { font-size: 12px; color: #909399; width: 100%; }
.p-title { font-weight: 600; margin-right: 4px; }
.blank { color: #409eff; font-weight: 700; text-decoration: underline; }
.bad { color: #f56c6c; font-weight: 600; }
.ok { color: #67c23a; font-weight: 600; }
.pager { margin-top: 12px; justify-content: flex-end; }

.d-block { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.d-word { font-size: 22px; font-weight: 700; }
.d-title { font-size: 16px; font-weight: 700; }
.d-line { color: #606266; }
.d-sentence { line-height: 1.8; }
.d-opts { display: flex; flex-direction: column; gap: 6px; }
.d-opt { border: 1px solid #e4e7ed; border-radius: 6px; padding: 6px 10px; font-size: 14px; }
.d-opt.right { border-color: #67c23a; background: #f0f9eb; color: #529b2e; font-weight: 600; }
.explain { color: #606266; font-size: 13px; background: #f5f7fa; border-radius: 6px; padding: 8px 10px; }
.origin :deep(.el-collapse-item__header) { font-size: 13px; color: #409eff; }
.p-text { white-space: pre-wrap; line-height: 1.8; font-size: 14px; max-height: 300px; overflow-y: auto; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
.blue { color: #409eff; }
</style>
