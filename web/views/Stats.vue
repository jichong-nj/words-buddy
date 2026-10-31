<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">学习统计</h2>
        <div class="meta">{{ auth.isAdmin ? '管理员可切换词库查看整体数据' : '我的学习数据' }}</div>
      </div>
      <div class="actions">
        <el-select v-model="bankFilter" placeholder="全部词库" clearable style="width: 200px" @change="reloadAll">
          <el-option v-for="b in banks" :key="b.id" :value="b.id" :label="b.name" />
        </el-select>
        <el-button v-if="auth.isAdmin" :loading="recomputing" @click="recompute">重算掌握度</el-button>
      </div>
    </div>

    <div class="stat-cards" v-if="ov">
      <div class="stat-card"><div class="num">{{ ov.totalWords }}</div><div class="label">总词数</div></div>
      <div class="stat-card"><div class="num">{{ ov.wordsPracticed }}<span class="sub">/ {{ fmtPct(ov.coverage) }}</span></div><div class="label">已练词数 / 覆盖率</div></div>
      <div class="stat-card"><div class="num">{{ ov.sessions }}</div><div class="label">练习场次</div></div>
      <div class="stat-card"><div class="num">{{ ov.itemsAnswered }}</div><div class="label">累计答题</div></div>
      <div class="stat-card"><div class="num" style="color:#67c23a">{{ fmtPct(ov.accuracy) }}</div><div class="label">总正确率</div></div>
      <div class="stat-card"><div class="num">{{ ov.todayAnswered }}<span class="sub">/ {{ fmtPct(ov.todayAccuracy) }}</span></div><div class="label">今日答题 / 正确率</div></div>
      <div class="stat-card"><div class="num">{{ fmtSec(ov.studyMs) }}</div><div class="label">学习时长</div></div>
      <div class="stat-card"><div class="num">{{ ov.activeDays }}</div><div class="label">活跃天数</div></div>
    </div>

    <el-card shadow="never" class="block">
      <template #header>分题型正确率</template>
      <div v-if="byType.length" class="type-rows">
        <div v-for="t in byType" :key="t.type" class="type-row">
          <span class="type-label">{{ t.label }}</span>
          <div class="band-track">
            <div class="band-fill" :style="{ width: accWidth(t.accuracy) + '%', background: accColor(t.accuracy) }"></div>
          </div>
          <span class="type-acc" :style="{ color: accColor(t.accuracy) }">{{ fmtPct(t.accuracy) }}</span>
          <span class="type-sub muted">练 {{ t.sessions }} 场 · 答 {{ t.items }} 题 · 对 {{ t.correct }} · 错题 {{ t.mistakes }}</span>
        </div>
        <div v-if="byTypeTotal" class="type-row total-row">
          <span class="type-label">合计</span>
          <div class="band-track">
            <div class="band-fill" :style="{ width: accWidth(byTypeTotal.accuracy) + '%', background: accColor(byTypeTotal.accuracy) }"></div>
          </div>
          <span class="type-acc" :style="{ color: accColor(byTypeTotal.accuracy) }">{{ fmtPct(byTypeTotal.accuracy) }}</span>
          <span class="type-sub muted">答 {{ byTypeTotal.items }} 题 · 对 {{ byTypeTotal.correct }} · 错题 {{ byTypeTotal.mistakes }}</span>
        </div>
      </div>
      <el-empty v-else description="还没有答题数据" :image-size="60" />
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>最近练习</template>
      <el-table :data="recent" size="small" empty-text="还没有练习记录">
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="modeTag(row.mode)">{{ modeLabel(row.mode) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.bankName || modeLabel(row.mode) }}</template>
        </el-table-column>
        <el-table-column prop="total" label="题数" width="80" />
        <el-table-column label="正确率" width="100">
          <template #default="{ row }">
            <span :style="{ color: accColor(row.score) }">{{ fmtPct(row.score) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="startedAt" label="时间" width="170" />
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="$router.push(`/records/${row.id}`)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>掌握度分布</template>
      <div class="band-bars">
        <div v-for="b in bandRows" :key="b.key" class="band-row">
          <span class="band-label">{{ BAND_LABELS[b.key] }}</span>
          <div class="band-track">
            <div class="band-fill" :style="{ width: b.pct + '%', background: BAND_COLORS[b.key] }"></div>
          </div>
          <span class="band-num">{{ b.count }}<span class="muted">（{{ b.pct.toFixed(1) }}%）</span></span>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>近 30 天答题趋势（柱高=答题数，颜色=正确率）</template>
      <div v-if="daily.length" class="daily-chart">
        <div v-for="d in daily" :key="d.day" class="daily-col" :title="`${d.day}：答 ${d.answered} 题，正确率 ${fmtPct(d.accuracy)}`">
          <div class="daily-bar" :style="{ height: barHeight(d) + 'px', background: accColor(d.accuracy) }"></div>
          <div class="daily-day">{{ d.day.slice(5) }}</div>
        </div>
      </div>
      <el-empty v-else description="近 30 天还没有练习记录" :image-size="60" />
    </el-card>

    <el-card shadow="never" class="block">
      <el-tabs v-model="tab">
        <el-tab-pane label="掌握度明细" name="mastery">
          <el-form inline @submit.prevent>
            <el-form-item>
              <el-input v-model="mQuery" placeholder="搜索单词 / 释义" clearable style="width: 200px"
                        @keyup.enter="mPage = 1; loadMastery()" @clear="mPage = 1; loadMastery()" />
            </el-form-item>
            <el-form-item>
              <el-select v-model="mBand" placeholder="全部档位" clearable style="width: 140px"
                         @change="mPage = 1; loadMastery()">
                <el-option v-for="(label, b) in BAND_LABELS" :key="b" :value="b" :label="label" />
              </el-select>
            </el-form-item>
            <el-form-item><el-button @click="mPage = 1; loadMastery()">查询</el-button></el-form-item>
          </el-form>
          <el-table :data="mastery.items" v-loading="mLoading" empty-text="还没有掌握度数据，先练一组吧">
            <el-table-column prop="word" label="单词" min-width="130" />
            <el-table-column label="释义" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.defCn || row.defEn || '—' }}</template>
            </el-table-column>
            <el-table-column prop="attempts" label="答题" width="70" />
            <el-table-column prop="correct" label="答对" width="70" />
            <el-table-column prop="score" label="得分" width="70" />
            <el-table-column label="档位" width="90">
              <template #default="{ row }">
                <el-tag size="small" :color="BAND_COLORS[row.band]" style="color:#fff;border:none">
                  {{ BAND_LABELS[row.band] || row.band }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="streak" label="连对" width="70" />
            <el-table-column prop="lastAt" label="最近练习" width="160" />
          </el-table>
          <el-pagination class="pager" layout="total, prev, pager, next" :total="mastery.total"
                         v-model:current-page="mPage" :page-size="20" @current-change="loadMastery" />
        </el-tab-pane>

        <el-tab-pane label="主题统计" name="topic">
          <el-table :data="topicRows" v-loading="tLoading" empty-text="暂无主题数据">
            <el-table-column label="主题" min-width="140">
              <template #default="{ row }">{{ topicName(row.topic) }}</template>
            </el-table-column>
            <el-table-column prop="words" label="单词数" width="90" />
            <el-table-column prop="practiced" label="已练" width="90" />
            <el-table-column label="练习进度" min-width="220">
              <template #default="{ row }">
                <div class="band-track">
                  <div class="band-fill"
                       :style="{ width: (row.words ? row.practiced / row.words * 100 : 0) + '%', background: '#409eff' }"></div>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="平均分" width="90">
              <template #default="{ row }">{{ row.avgScore ?? '—' }}</template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="薄弱词 Top20" name="weak">
          <el-table :data="weakRows" v-loading="wLoading" empty-text="暂无薄弱词，保持！">
            <el-table-column prop="word" label="单词" min-width="130" />
            <el-table-column label="释义" min-width="220" show-overflow-tooltip>
              <template #default="{ row }">{{ row.defCn || row.defEn || '—' }}</template>
            </el-table-column>
            <el-table-column prop="attempts" label="答题" width="70" />
            <el-table-column prop="correct" label="答对" width="70" />
            <el-table-column prop="score" label="得分" width="70" />
            <el-table-column label="档位" width="90">
              <template #default="{ row }">
                <el-tag size="small" :color="BAND_COLORS[row.band]" style="color:#fff;border:none">
                  {{ BAND_LABELS[row.band] || row.band }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="lastAt" label="最近练习" width="160" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api.js';
import { useAuth } from '../store.js';
import { BAND_LABELS, BAND_COLORS, fmtPct, fmtSec, qs } from '../utils.js';

const auth = useAuth();
const loading = ref(false);
const recomputing = ref(false);
const banks = ref([]);
const bankFilter = ref(null);

const ov = ref(null);
const daily = ref([]);
const topicRows = ref([]);
const weakRows = ref([]);
const topics = ref([]);
const topicMap = computed(() => Object.fromEntries(topics.value.map(t => [t.key, t.cn])));
function topicName(k) { return topicMap.value[k] || k || '（未分类）'; }

const tab = ref('mastery');
const mastery = ref({ total: 0, items: [] });
const mQuery = ref('');
const mBand = ref(null);
const mPage = ref(1);
const mLoading = ref(false);
const tLoading = ref(false);
const wLoading = ref(false);
const byType = ref([]);
const byTypeTotal = ref(null);
const recent = ref([]);

const bandRows = computed(() => {
  const by = (ov.value && ov.value.byBand) || {};
  const total = Object.values(by).reduce((a, b) => a + (b || 0), 0) || 1;
  return Object.keys(BAND_LABELS).map(k => ({
    key: k, count: by[k] || 0, pct: (by[k] || 0) / total * 100,
  }));
});

function barHeight(d) {
  const max = Math.max(...daily.value.map(x => x.answered || 0), 1);
  return Math.max(4, Math.round((d.answered || 0) / max * 120));
}
function accColor(acc) {
  if (acc === null || acc === undefined) return '#c0c4cc';
  const a = acc > 0 && acc < 1 ? acc * 100 : acc;
  if (a >= 85) return '#67c23a';
  if (a >= 60) return '#e6a23c';
  return '#f56c6c';
}
function accWidth(acc) {
  if (acc === null || acc === undefined) return 0;
  const a = acc > 0 && acc < 1 ? acc * 100 : acc;
  return Math.max(0, Math.min(100, a));
}
function modeLabel(m) {
  return m === 'form_fill' ? '变形填空' : m === 'reading' ? '阅读理解' : '释义填空';
}
function modeTag(m) {
  return m === 'form_fill' ? 'warning' : m === 'reading' ? 'success' : 'primary';
}

const bankQs = () => qs({ bank: bankFilter.value });

async function loadOverview() {
  try { ov.value = await api.get(`/api/stats/overview${bankQs()}`); } catch { /* 已提示 */ }
}
async function loadDaily() {
  try {
    const d = await api.get('/api/stats/daily?days=30');
    daily.value = d.items || [];
  } catch { daily.value = []; }
}
async function loadTopic() {
  tLoading.value = true;
  try {
    const d = await api.get(`/api/stats/topic${bankQs()}`);
    topicRows.value = d.items || [];
  } catch { topicRows.value = []; } finally { tLoading.value = false; }
}
async function loadWeak() {
  wLoading.value = true;
  try {
    const d = await api.get(`/api/stats/weak-words${qs({ bank: bankFilter.value, limit: 20 })}`);
    weakRows.value = d.items || [];
  } catch { weakRows.value = []; } finally { wLoading.value = false; }
}
async function loadMastery() {
  mLoading.value = true;
  try {
    const d = await api.get(`/api/stats/mastery${qs({
      bank: bankFilter.value, band: mBand.value, q: mQuery.value.trim(), page: mPage.value, size: 20,
    })}`);
    mastery.value = { total: d.total || 0, items: d.items || [] };
  } catch { mastery.value = { total: 0, items: [] }; } finally { mLoading.value = false; }
}
async function loadTopicsMeta() {
  try {
    const d = await api.get(`/api/meta/topics${bankFilter.value ? `?bank=${bankFilter.value}` : ''}`);
    topics.value = d.items || [];
  } catch { topics.value = []; }
}
async function loadByType() {
  try {
    const d = await api.get('/api/stats/by-type');
    byType.value = d.items || [];
    byTypeTotal.value = d.total || null;
  } catch {
    byType.value = [];
    byTypeTotal.value = null;
  }
}
async function loadRecent() {
  try {
    const d = await api.get('/api/practice/sessions?size=10');
    recent.value = d.items || [];
  } catch { recent.value = []; }
}

function reloadAll() {
  loadOverview(); loadTopic(); loadWeak(); loadTopicsMeta(); loadByType(); loadRecent();
  mPage.value = 1; loadMastery();
}

async function recompute() {
  recomputing.value = true;
  try {
    const d = await api.post('/api/stats/recompute');
    ElMessage.success(`已重算 ${d.updated} 条掌握度`);
    reloadAll();
  } catch { /* 已提示 */ } finally {
    recomputing.value = false;
  }
}

onMounted(async () => {
  try {
    const d = await api.get('/api/banks');
    banks.value = d.items || [];
  } catch { /* 已提示 */ }
  loadOverview(); loadDaily(); loadTopic(); loadWeak(); loadTopicsMeta(); loadMastery();
  loadByType(); loadRecent();
});
</script>

<style scoped>
.block { margin-top: 16px; }
.stat-card .sub { font-size: 14px; color: #909399; margin-left: 6px; font-weight: 400; }
.band-bars { display: flex; flex-direction: column; gap: 10px; max-width: 640px; }
.band-row { display: flex; align-items: center; gap: 10px; }
.band-label { width: 60px; text-align: right; color: #606266; }
.band-track { flex: 1; height: 14px; background: #f0f2f5; border-radius: 7px; overflow: hidden; }
.band-fill { height: 100%; border-radius: 7px; transition: width .4s; }
.band-num { width: 120px; }
.daily-chart { display: flex; align-items: flex-end; gap: 4px; height: 150px; overflow-x: auto; padding-top: 6px; }
.daily-col { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; min-width: 26px; }
.daily-bar { width: 16px; border-radius: 3px 3px 0 0; }
.daily-day { font-size: 10px; color: #909399; margin-top: 4px; transform: rotate(-45deg); white-space: nowrap; }
.type-rows { display: flex; flex-direction: column; gap: 10px; max-width: 760px; }
.type-row { display: flex; align-items: center; gap: 10px; }
.type-row.total-row { border-top: 1px solid #ebeef5; padding-top: 10px; }
.type-label { width: 70px; text-align: right; color: #606266; flex: none; }
.type-acc { width: 60px; font-weight: 700; flex: none; }
.type-sub { font-size: 12px; }
.muted { color: #909399; }
</style>
