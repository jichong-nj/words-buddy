<template>
  <div>
    <!-- 配置阶段 -->
    <template v-if="phase === 'config'">
      <div class="page-head">
        <div>
          <h2 class="page-title">变形填空</h2>
          <div class="meta">根据句子语境，把括号里的原型变成正确形式填进空里（时态、词性、比较级……）</div>
        </div>
      </div>

      <div class="stat-cards" v-if="pools.total > 0">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ pools.total }}</div><div class="label">题库总题量</div></div>
        <div class="stat-card"><div class="num">{{ pools.byPoint.length }}</div><div class="label">考点数</div></div>
        <div class="stat-card"><div class="num">{{ pools.byTopic.length }}</div><div class="label">主题数</div></div>
      </div>
      <el-empty v-else v-loading="loadingPools" description="变形题库为空，请让管理员先在「变形题库」页导入题目" />

      <el-card v-if="pools.total > 0" shadow="never" class="cfg-card">
        <el-form label-width="90px">
          <el-form-item label="考点">
            <el-select v-model="cfg.points" multiple collapse-tags collapse-tags-tooltip clearable
                       placeholder="不限考点" style="width: 420px">
              <el-option v-for="p in pools.byPoint" :key="p.point" :value="p.point"
                         :label="`${p.point}（${p.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="等级">
            <el-select v-model="cfg.levels" multiple collapse-tags clearable placeholder="不限等级"
                       style="width: 420px">
              <el-option v-for="l in pools.byLevel" :key="l.level" :value="l.level"
                         :label="`${l.level}（${l.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="主题">
            <el-select v-model="cfg.topics" multiple collapse-tags collapse-tags-tooltip clearable
                       placeholder="不限主题" style="width: 420px">
              <el-option v-for="t in pools.byTopic" :key="t.topic" :value="t.topic"
                         :label="`${t.topic}（${t.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="题数">
            <el-radio-group v-model="cfg.count">
              <el-radio-button :value="5">5 题</el-radio-button>
              <el-radio-button :value="10">10 题</el-radio-button>
              <el-radio-button :value="20">20 题</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="排除重做">
            <el-switch v-model="cfg.excludeRecent" />
            <el-select v-if="cfg.excludeRecent" v-model="cfg.excludeRecentDays" style="width: 130px; margin-left: 10px">
              <el-option :value="7" label="最近 7 天" />
              <el-option :value="14" label="最近 14 天" />
              <el-option :value="30" label="最近 30 天" />
            </el-select>
            <span class="muted" style="margin-left: 10px">跳过近期已练过的题</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="starting" @click="start">开始练习</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </template>

    <!-- 答题阶段 -->
    <template v-else-if="phase === 'quiz'">
      <div class="page-head">
        <div>
          <h2 class="page-title">变形填空中</h2>
          <div class="meta">第 {{ idx + 1 }} / {{ questions.length }} 题 · 已答对 {{ correctCount }} · 已用时 {{ fmtClock(elapsed) }}</div>
        </div>
        <div class="actions">
          <el-button text @click="quit">提前结束</el-button>
        </div>
      </div>

      <el-progress :percentage="Math.round(idx / questions.length * 100)" :show-text="false"
                   style="margin-bottom: 18px" />

      <el-card shadow="never" class="quiz-card" v-loading="submitting">
        <template v-if="current">
          <div class="stem">
            <template v-for="(seg, i) in stemSegs" :key="i">
              <span>{{ seg }}</span><span v-if="i < stemSegs.length - 1" class="blank">______</span>
            </template>
          </div>
          <div class="hint">
            <span class="base">（原型：{{ current.base }}）</span>
            <span class="muted" style="margin-left: 8px">答案约 {{ current.length }} 个字符</span>
          </div>

          <el-input v-model="given" size="large" :readonly="!!answered" autofocus
                    placeholder="输入正确形式，回车提交" class="answer-input"
                    :class="{ 'answer-wrong': answered && !answered.isCorrect, 'answer-right': answered && answered.isCorrect }"
                    @keyup.enter="onEnter" ref="inputRef" />

          <div v-if="answered" class="feedback">
            <el-tag v-if="answered.isCorrect" type="success" size="large">✓ 回答正确</el-tag>
            <el-tag v-else type="danger" size="large">✗ 回答错误</el-tag>
            <div class="fb-answer">
              正确答案：<b class="mono">{{ answered.answer }}</b>
              <template v-if="otherAccepted.length">
                <span class="muted">（也可接受：{{ otherAccepted.join(' / ') }}）</span>
              </template>
            </div>
            <div v-if="filledSentence" class="fb-sentence">{{ filledSentence }}</div>
            <div class="fb-cn">句子意思：{{ answered.sentenceCn || '—' }}</div>
            <div class="fb-cn">词义：<b class="mono">{{ answered.base }}</b>：{{ answered.wordCn || '—' }}</div>
            <div v-if="answered.point" class="fb-point">考点：<el-tag size="small">{{ answered.point }}</el-tag></div>
            <div v-if="answered.explain" class="fb-explain">{{ answered.explain }}</div>
            <div class="fb-actions">
              <el-button v-if="idx + 1 < questions.length" type="primary" @click="next">下一题（Enter）</el-button>
              <el-button v-else type="primary" @click="finish">完成练习（Enter）</el-button>
            </div>
          </div>
          <div v-else class="feedback muted">提示：输入完成后按回车提交，判分忽略大小写和首尾空格</div>
        </template>
      </el-card>
    </template>

    <!-- 结果阶段 -->
    <template v-else>
      <div class="page-head">
        <div><h2 class="page-title">变形填空完成 🎉</h2></div>
        <div class="actions">
          <el-button @click="$router.push(`/records/${sessionId}`)">查看记录</el-button>
          <el-button type="primary" @click="again">再练一组</el-button>
        </div>
      </div>

      <div class="stat-cards" v-loading="finishing">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ result ? result.score : '—' }}</div><div class="label">得分</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ result ? `${result.correct}/${result.total}` : '—' }}</div><div class="label">答对</div></div>
        <div class="stat-card"><div class="num" style="color:#e6a23c">{{ result && result.total ? fmtPct(result.correct / result.total * 100) : '—' }}</div><div class="label">正确率</div></div>
        <div class="stat-card"><div class="num">{{ result ? fmtSec(result.durationMs) : '—' }}</div><div class="label">用时</div></div>
      </div>

      <el-card v-if="wrongList.length" shadow="never" style="margin-top: 16px">
        <template #header>本次答错的题（{{ wrongList.length }}）</template>
        <el-table :data="wrongList" size="small">
          <el-table-column label="句子" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">{{ row.filled || row.prompt }}</template>
          </el-table-column>
          <el-table-column prop="base" label="原型" width="100" />
          <el-table-column label="你的答案" width="130">
            <template #default="{ row }"><span class="bad">{{ row.given || '（未作答）' }}</span></template>
          </el-table-column>
          <el-table-column prop="answer" label="正确答案" width="130" />
          <el-table-column label="句子意思" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sentenceCn || '—' }}</template>
          </el-table-column>
          <el-table-column label="词义" width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ row.wordCn || '—' }}</template>
          </el-table-column>
          <el-table-column prop="explain" label="解析" min-width="180" show-overflow-tooltip />
        </el-table>
      </el-card>
      <el-empty v-else description="全对！太强了 💯" />
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { fmtSec, fmtClock, fmtPct } from '../utils.js';

const phase = ref('config');
const loadingPools = ref(false);
const starting = ref(false);
const submitting = ref(false);
const finishing = ref(false);

const pools = ref({ total: 0, byPoint: [], byLevel: [], byTopic: [] });
const cfg = reactive({ points: [], levels: [], topics: [], count: 10, excludeRecent: false, excludeRecentDays: 7 });

const sessionId = ref(null);
const questions = ref([]);
const idx = ref(0);
const given = ref('');
const answered = ref(null); // 后端单题判分结果
const wrongList = ref([]);
const result = ref(null);
const inputRef = ref(null);

const current = computed(() => questions.value[idx.value] || null);
const correctCount = ref(0); // 已答对题数（含当前题反馈）
const stemSegs = computed(() => String(current.value?.prompt || '').split(/_{2,}/));
const otherAccepted = computed(() => {
  const a = answered.value;
  if (!a) return [];
  return (a.accepted || []).filter(x => x.toLowerCase() !== String(a.answer || '').toLowerCase());
});
// 填好答案的完整句子：优先用后端返回的 filled，缺失时本地回填兜底
const filledSentence = computed(() => {
  const a = answered.value;
  if (!a) return '';
  if (a.filled) return a.filled;
  const p = String(current.value?.prompt || '');
  return p ? p.replace(/_{2,}/, a.answer || '') : '';
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
    pools.value = await api.get('/api/form/pools');
  } catch { /* 已提示 */ } finally {
    loadingPools.value = false;
  }
}

async function start() {
  starting.value = true;
  try {
    const d = await api.post('/api/form/sessions', {
      count: cfg.count,
      points: cfg.points.length ? cfg.points : undefined,
      levels: cfg.levels.length ? cfg.levels : undefined,
      topics: cfg.topics.length ? cfg.topics : undefined,
      excludeRecentDays: cfg.excludeRecent ? cfg.excludeRecentDays : undefined,
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
    correctCount.value = 0;
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

async function submit() {
  if (answered.value || !current.value) return;
  const text = given.value.trim();
  if (!text) return ElMessage.warning('请输入答案');
  submitting.value = true;
  try {
    const d = await api.post(`/api/form/sessions/${sessionId.value}/answer`, {
      seq: current.value.seq,
      given: text,
      latencyMs: Date.now() - shownAt,
    });
    answered.value = d;
    if (d.isCorrect) correctCount.value++;
    else wrongList.value.push({
      prompt: current.value.prompt, base: current.value.base, given: text,
      answer: d.answer, filled: d.filled, sentenceCn: d.sentenceCn, wordCn: d.wordCn,
      point: d.point, explain: d.explain,
    });
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
    result.value = await api.post(`/api/form/sessions/${sessionId.value}/finish`, {});
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
.cfg-card { max-width: 640px; }
.quiz-card { max-width: 720px; margin: 0 auto; text-align: center; padding: 12px 0; }
.stem {
  font-size: 26px; font-weight: 600; line-height: 1.7; margin: 18px 0 10px;
  word-break: break-word;
}
.blank {
  color: #409eff; font-weight: 700; text-decoration: underline;
  text-underline-offset: 5px; letter-spacing: 1px; margin: 0 4px;
}
.hint { font-size: 16px; color: #606266; margin-bottom: 22px; }
.hint .base { font-weight: 600; }
.answer-input { max-width: 380px; margin: 0 auto; }
.answer-input :deep(input) { text-align: center; font-size: 20px; letter-spacing: 1px; }
.answer-right :deep(input) { color: #67c23a; border-color: #67c23a; }
.answer-wrong :deep(input) { color: #f56c6c; border-color: #f56c6c; }
.feedback { margin-top: 22px; }
.fb-answer { font-size: 18px; margin-top: 12px; }
.fb-answer .mono { font-size: 22px; color: #409eff; }
.fb-sentence { font-size: 18px; font-weight: 600; line-height: 1.6; margin-top: 14px; }
.fb-cn { margin-top: 6px; font-size: 15px; color: #606266; }
.fb-cn .mono { color: #409eff; }
.fb-point { margin-top: 10px; font-size: 14px; color: #606266; }
.fb-explain {
  margin: 12px auto 0; max-width: 520px; font-size: 14px; color: #606266;
  background: #f6f8fa; border-radius: 6px; padding: 10px 14px; text-align: left;
}
.fb-actions { margin-top: 18px; }
.bad { color: #f56c6c; font-weight: 600; }
</style>
