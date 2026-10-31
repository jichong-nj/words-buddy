<template>
  <div>
    <!-- 配置阶段 -->
    <template v-if="phase === 'config'">
      <div class="page-head">
        <div>
          <h2 class="page-title">释义填空</h2>
          <div class="meta">看英文释义写单词，答案由后端判定，不记分作弊没有用 😉</div>
        </div>
      </div>

      <div class="stat-cards" v-if="pools.length">
        <div class="stat-card" v-for="p in pools" :key="p.bankId" style="cursor: pointer"
             :class="{ 'pool-active': cfg.bankId === p.bankId }" @click="pickBank(p)">
          <div class="num">{{ p.answerable }}</div>
          <div class="label">{{ p.bankName }}（共 {{ p.total }} 词）</div>
        </div>
      </div>
      <el-empty v-else v-loading="loadingPools" description="暂无可练习的词库，请先导入带英文释义的单词" />

      <el-card v-if="pools.length" shadow="never" class="cfg-card">
        <el-form label-width="90px">
          <el-form-item label="词库">
            <el-select v-model="cfg.bankId" placeholder="选择词库" style="width: 260px" @change="onBankChange">
              <el-option v-for="p in pools" :key="p.bankId" :value="p.bankId"
                         :label="`${p.bankName}（可练 ${p.answerable}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="题数">
            <el-slider v-model="cfg.count" :min="5" :max="100" :step="5" show-input style="width: 320px" />
          </el-form-item>
          <el-form-item label="主题">
            <el-select v-model="cfg.topics" multiple collapse-tags collapse-tags-tooltip filterable
                       :allow-create="!topicTaxonomy" default-first-option clearable
                       placeholder="不限主题" style="width: 420px">
              <el-option v-for="t in topics" :key="t.key" :value="t.key"
                         :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
            </el-select>
          </el-form-item>
          <el-form-item label="掌握档位">
            <el-select v-model="cfg.bands" multiple collapse-tags clearable placeholder="不限档位"
                       style="width: 420px">
              <el-option v-for="(label, b) in BAND_LABELS" :key="b" :value="b" :label="label" />
            </el-select>
          </el-form-item>
          <el-form-item label="单词长度">
            <el-input-number v-model="cfg.minLen" :min="1" :max="30" placeholder="最短" style="width: 120px" />
            <span class="muted" style="margin: 0 8px">至</span>
            <el-input-number v-model="cfg.maxLen" :min="1" :max="30" placeholder="最长" style="width: 120px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="starting" :disabled="!cfg.bankId"
                       @click="start">
              开始练习
            </el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </template>

    <!-- 答题阶段 -->
    <template v-else-if="phase === 'quiz'">
      <div class="page-head">
        <div>
          <h2 class="page-title">释义填空中 · {{ bankName }}</h2>
          <div class="meta">第 {{ idx + 1 }} / {{ questions.length }} 题 · 已用时 {{ fmtClock(elapsed) }}</div>
        </div>
        <div class="actions">
          <el-button text @click="quit">提前结束</el-button>
        </div>
      </div>

      <el-progress :percentage="Math.round(idx / questions.length * 100)" :show-text="false"
                   style="margin-bottom: 18px" />

      <el-card shadow="never" class="quiz-card" v-loading="submitting">
        <template v-if="current">
          <div class="stem">{{ current.stem }}</div>
          <div class="hint">
            <span v-if="current.hint">{{ current.hint }}</span>
            <span class="muted">
              （{{ current.length }} 个字母<template v-if="current.topic"> · 主题 {{ topicName(current.topic) }}</template>）
            </span>
          </div>

          <el-input v-model="given" size="large" :readonly="!!answered" autofocus
                    placeholder="输入单词，回车提交" class="answer-input"
                    :class="{ 'answer-wrong': answered && !answered.isCorrect, 'answer-right': answered && answered.isCorrect }"
                    @keyup.enter="onEnter" ref="inputRef" />

          <div v-if="answered" class="feedback">
            <el-tag v-if="answered.isCorrect" type="success" size="large">✓ 回答正确</el-tag>
            <el-tag v-else type="danger" size="large">✗ 回答错误</el-tag>
            <div class="fb-answer">
              正确答案：<b class="mono">{{ answered.answer }}</b>
              <template v-if="answered.accepted && answered.accepted.length">
                <span class="muted">（也可接受：{{ answered.accepted.join(' / ') }}）</span>
              </template>
            </div>
            <div class="fb-actions">
              <el-button v-if="idx + 1 < questions.length" type="primary" @click="next">下一题（Enter）</el-button>
              <el-button v-else type="primary" @click="finish">完成练习（Enter）</el-button>
            </div>
          </div>
          <div v-else class="feedback muted">
            提示：字母输满 {{ current.length }} 个会自动提交
          </div>
        </template>
      </el-card>
    </template>

    <!-- 结果阶段 -->
    <template v-else>
      <div class="page-head">
        <div><h2 class="page-title">填空完成 🎉</h2></div>
        <div class="actions">
          <el-button @click="$router.push(`/records/${sessionId}`)">查看完整记录</el-button>
          <el-button type="primary" @click="again">再练一轮</el-button>
        </div>
      </div>

      <div class="stat-cards" v-loading="finishing">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ result ? result.score : '—' }}</div><div class="label">得分</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ result ? `${result.correct}/${result.total}` : '—' }}</div><div class="label">答对</div></div>
        <div class="stat-card"><div class="num">{{ result ? fmtSec(result.durationMs) : '—' }}</div><div class="label">用时</div></div>
      </div>

      <el-card v-if="wrongList.length" shadow="never" style="margin-top: 16px">
        <template #header>本次答错的词（{{ wrongList.length }}）</template>
        <el-table :data="wrongList" size="small">
          <el-table-column prop="stem" label="题干" min-width="240" show-overflow-tooltip />
          <el-table-column label="你的答案" width="150">
            <template #default="{ row }"><span class="bad">{{ row.given || '（未作答）' }}</span></template>
          </el-table-column>
          <el-table-column prop="answer" label="正确答案" width="150" />
        </el-table>
      </el-card>
      <el-empty v-else description="全对！太强了 💯" />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { BAND_LABELS, fmtSec, fmtClock } from '../utils.js';

const phase = ref('config');
const loadingPools = ref(false);
const starting = ref(false);
const submitting = ref(false);
const finishing = ref(false);

const pools = ref([]);
const cfg = reactive({ bankId: null, count: 20, topics: [], bands: [], minLen: null, maxLen: null });

const topics = ref([]);
const topicTaxonomy = ref(true);
const topicMap = computed(() => Object.fromEntries(topics.value.map(t => [t.key, t.cn])));
function topicName(k) { return (topicMap.value[k]) || k || ''; }

const sessionId = ref(null);
const questions = ref([]);
const idx = ref(0);
const given = ref('');
const answered = ref(null); // 后端单题判分结果
const wrongList = ref([]);
const result = ref(null);
const inputRef = ref(null);

const current = computed(() => questions.value[idx.value] || null);
const bankName = computed(() => {
  const p = pools.value.find(x => x.bankId === cfg.bankId);
  return p ? p.bankName : '';
});

/* 计时 */
const elapsed = ref(0);
let timer = null;
let shownAt = 0;
function startTimer() {
  stopTimer();
  elapsed.value = 0;
  timer = setInterval(() => { elapsed.value++; }, 1000);
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}
onBeforeUnmount(stopTimer);

async function loadPools() {
  loadingPools.value = true;
  try {
    const d = await api.get('/api/practice/pools');
    pools.value = d.items || [];
    if (!cfg.bankId && pools.value.length) {
      const best = [...pools.value].sort((a, b) => b.answerable - a.answerable)[0];
      cfg.bankId = best.bankId;
      onBankChange();
    }
  } catch { /* 已提示 */ } finally {
    loadingPools.value = false;
  }
}

async function onBankChange() {
  topics.value = [];
  if (!cfg.bankId) return;
  cfg.topics = [];
  try {
    const d = await api.get(`/api/meta/topics?bank=${cfg.bankId}`);
    topics.value = d.items || [];
    topicTaxonomy.value = !(d.taxonomy === false);
  } catch { /* 已提示 */ }
}

function pickBank(p) {
  cfg.bankId = p.bankId;
  onBankChange();
}

async function start() {
  starting.value = true;
  try {
    const d = await api.post('/api/practice/sessions', {
      bankId: cfg.bankId,
      count: cfg.count,
      topics: cfg.topics.length ? cfg.topics : undefined,
      bands: cfg.bands.length ? cfg.bands : undefined,
      minLen: cfg.minLen || undefined,
      maxLen: cfg.maxLen || undefined,
    });
    sessionId.value = d.sessionId;
    questions.value = d.questions || [];
    if (!questions.value.length) {
      ElMessage.warning('没有抽到题目，请调整筛选条件');
      return;
    }
    idx.value = 0;
    wrongList.value = [];
    result.value = null;
    given.value = '';
    answered.value = null;
    phase.value = 'quiz';
    startTimer();
    shownAt = Date.now();
    focusInput();
  } catch { /* 已提示 */ } finally {
    starting.value = false;
  }
}

function focusInput() {
  nextTick(() => inputRef.value && inputRef.value.focus());
}

// 输入长度等于答案长度时自动提交
watch(given, v => {
  if (!answered.value && current.value && v.trim().length === current.value.length && v.trim().length > 0) {
    submit();
  }
});

async function submit() {
  if (answered.value || !current.value) return;
  const text = given.value.trim();
  if (!text) return ElMessage.warning('请输入答案');
  submitting.value = true;
  try {
    const d = await api.post(`/api/practice/sessions/${sessionId.value}/answer`, {
      seq: current.value.seq,
      given: text,
      latencyMs: Date.now() - shownAt,
    });
    answered.value = d;
    if (!d.isCorrect) {
      wrongList.value.push({ stem: current.value.stem, given: text, answer: d.answer });
    }
  } catch { /* 已提示 */ } finally {
    submitting.value = false;
  }
}

function onEnter() {
  if (!answered.value) submit();
  else if (idx.value + 1 < questions.value.length) next();
  else finish();
}

function next() {
  idx.value++;
  given.value = '';
  answered.value = null;
  shownAt = Date.now();
  focusInput();
}

async function finish() {
  finishing.value = true;
  phase.value = 'result';
  stopTimer();
  try {
    result.value = await api.post(`/api/practice/sessions/${sessionId.value}/finish`);
  } catch { /* 已提示 */ } finally {
    finishing.value = false;
  }
}

async function quit() {
  try {
    await ElMessageBox.confirm('还有未答完的题目，确定提前结束吗？', '结束练习', { type: 'warning' });
  } catch { return; }
  await finish();
}

function again() {
  phase.value = 'config';
  result.value = null;
  loadPools();
}

onMounted(loadPools);
</script>

<style scoped>
.pool-active { border-color: #409eff; box-shadow: 0 0 0 2px rgba(64, 158, 255, .2); }
.cfg-card { max-width: 640px; }
.quiz-card { max-width: 720px; margin: 0 auto; text-align: center; padding: 12px 0; }
.stem {
  font-size: 30px; font-weight: 700; line-height: 1.5; margin: 18px 0 10px;
  word-break: break-word;
}
.hint { font-size: 16px; color: #606266; margin-bottom: 22px; }
.answer-input { max-width: 380px; margin: 0 auto; }
.answer-input :deep(input) { text-align: center; font-size: 22px; letter-spacing: 2px; }
.answer-right :deep(input) { color: #67c23a; border-color: #67c23a; }
.answer-wrong :deep(input) { color: #f56c6c; border-color: #f56c6c; }
.feedback { margin-top: 22px; }
.fb-answer { font-size: 18px; margin-top: 12px; }
.fb-answer .mono { font-size: 22px; color: #409eff; }
.fb-actions { margin-top: 18px; }
.bad { color: #f56c6c; font-weight: 600; }
</style>
