<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">阅读理解</h2>
        <div class="meta">选篇阅读文章，逐题作答单选题</div>
      </div>
    </div>

    <!-- ① 配置 -->
    <el-card v-if="phase === 'config'" shadow="never" class="cfg-card" v-loading="loadingPools">
      <template #header>练习设置</template>
      <template v-if="pools.passages > 0">
        <div class="stat-cards" style="margin-bottom: 18px">
          <div class="stat-card"><div class="num">{{ pools.passages }}</div><div class="label">文章总数</div></div>
          <div class="stat-card"><div class="num">{{ pools.questions }}</div><div class="label">题目总数</div></div>
          <div class="stat-card"><div class="num">{{ pools.byTopic.length }}</div><div class="label">主题数</div></div>
        </div>
        <el-form label-width="80px">
          <el-form-item label="等级">
            <el-select v-model="cfg.levels" multiple clearable collapse-tags placeholder="全部等级" style="width: 100%">
              <el-option v-for="l in pools.byLevel" :key="l.level" :value="l.level" :label="`${l.level}（${l.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="主题">
            <el-select v-model="cfg.topics" multiple clearable collapse-tags placeholder="全部主题" style="width: 100%">
              <el-option v-for="t in pools.byTopic" :key="t.topic" :value="t.topic" :label="`${t.topic}（${t.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="篇数">
            <el-radio-group v-model="cfg.passages">
              <el-radio-button :value="1">1 篇</el-radio-button>
              <el-radio-button :value="2">2 篇</el-radio-button>
              <el-radio-button :value="3">3 篇</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="排除重做">
            <el-switch v-model="cfg.excludeRecent" />
            <el-select v-if="cfg.excludeRecent" v-model="cfg.excludeRecentDays" style="width: 120px; margin-left: 10px">
              <el-option :value="7" label="近 7 天" />
              <el-option :value="14" label="近 14 天" />
              <el-option :value="30" label="近 30 天" />
            </el-select>
            <span class="muted" style="margin-left: 10px">排除近期做过的文章</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="starting" @click="start">开始练习</el-button>
          </el-form-item>
        </el-form>
      </template>
      <el-empty v-else description="阅读题库还没有文章，请联系管理员导入" :image-size="80" />
    </el-card>

    <!-- ② 答题 -->
    <div v-else-if="phase === 'quiz'">
      <el-card shadow="never" class="quiz-top">
        <div class="qtop-row">
          <span>第 <b>{{ curNo }}</b> / {{ total }} 题</span>
          <span>已答对 <b class="ok">{{ correctCount }}</b></span>
          <span class="muted">第 {{ pIdx + 1 }} / {{ passages.length }} 篇</span>
          <span class="muted">用时 {{ fmtClock(elapsed) }}</span>
          <span class="flex1"></span>
          <el-button link type="danger" @click="quit">提前结束</el-button>
        </div>
        <el-progress :percentage="pct" :show-text="false" :stroke-width="8" />
      </el-card>

      <div class="quiz-layout" v-if="currentPassage">
        <el-card shadow="never" class="passage-card">
          <div class="p-title">{{ currentPassage.title }}</div>
          <div class="p-meta">
            <el-tag v-if="currentPassage.level" size="small">{{ currentPassage.level }}</el-tag>
            <el-tag v-if="currentPassage.topic" size="small" type="info">{{ currentPassage.topic }}</el-tag>
            <span v-if="currentPassage.source" class="muted">来源：{{ currentPassage.source }}</span>
            <span class="muted">约 {{ wordCount }} 词</span>
          </div>
          <div class="p-text">{{ currentPassage.text }}</div>
        </el-card>

        <div class="qs-col">
          <el-card v-for="q in currentPassage.questions" :key="q.seq" shadow="never" class="q-card">
            <div class="q-stem">{{ q.seq }}. {{ q.stem }}</div>
            <div class="opts">
              <div v-for="(o, oi) in q.options" :key="oi" class="opt" :class="optClass(q.seq, oi)"
                   @click="pick(q.seq, oi)">
                <b>{{ 'ABCD'[oi] }}.</b> {{ o }}
              </div>
            </div>
            <div v-if="!answers[q.seq]" class="q-actions">
              <el-button type="primary" size="small" :disabled="sel[q.seq] === undefined"
                         :loading="submittingSeq === q.seq" @click="submit(q)">提交答案</el-button>
            </div>
            <div v-else class="feedback">
              <el-tag :type="answers[q.seq].isCorrect ? 'success' : 'danger'" size="small">
                {{ answers[q.seq].isCorrect ? '✓ 回答正确' : '✗ 回答错误' }}
              </el-tag>
              <div v-if="!answers[q.seq].isCorrect" class="fb-answer">
                正确答案：<b class="mono">{{ 'ABCD'[answers[q.seq].answerIndex] }}. {{ answers[q.seq].answerText }}</b>
              </div>
              <div v-if="answers[q.seq].explain" class="explain">解析：{{ answers[q.seq].explain }}</div>
            </div>
          </el-card>

          <div v-if="passageDone" class="next-p">
            <el-button type="primary" size="large" @click="nextPassage">
              {{ pIdx + 1 < passages.length ? '进入下一篇 →' : '完成练习' }}
            </el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- ③ 结果 -->
    <div v-else-if="phase === 'result'">
      <div class="stat-cards" v-loading="finishing">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ result ? result.score : '—' }}</div><div class="label">得分</div></div>
        <div class="stat-card"><div class="num">{{ result ? `${result.correct} / ${result.total}` : '—' }}</div><div class="label">答对 / 总题数</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ result ? fmtPct(result.score) : '—' }}</div><div class="label">正确率</div></div>
        <div class="stat-card"><div class="num">{{ result ? fmtSec(result.durationMs) : fmtSec(elapsed * 1000) }}</div><div class="label">用时</div></div>
      </div>

      <el-card v-for="p in passages" :key="p.passageId" shadow="never" class="block">
        <template #header>{{ p.title }}</template>
        <el-table :data="p.questions" empty-text="本篇没有题目">
          <el-table-column prop="stem" label="题干" min-width="220" show-overflow-tooltip />
          <el-table-column label="你的选择" min-width="160">
            <template #default="{ row }">
              <span :class="answers[row.seq] && !answers[row.seq].isCorrect ? 'bad' : ''">{{ chosenText(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="正确答案" min-width="160">
            <template #default="{ row }">
              <span class="mono">{{ answers[row.seq] ? 'ABCD'[answers[row.seq].answerIndex] + '. ' + answers[row.seq].answerText : '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag v-if="answers[row.seq]" :type="answers[row.seq].isCorrect ? 'success' : 'danger'" size="small">
                {{ answers[row.seq].isCorrect ? '正确' : '错误' }}
              </el-tag>
              <span v-else class="muted">未作答</span>
            </template>
          </el-table-column>
          <el-table-column label="解析" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ (answers[row.seq] && answers[row.seq].explain) || '—' }}</template>
          </el-table-column>
        </el-table>
      </el-card>

      <div class="result-actions">
        <el-button type="primary" size="large" @click="again">再来一组</el-button>
        <el-button size="large" @click="viewRecord">查看记录</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { fmtPct, fmtSec, fmtClock } from '../utils.js';

const router = useRouter();
const phase = ref('config'); // config | quiz | result
const loadingPools = ref(false);
const starting = ref(false);
const submittingSeq = ref(null);
const finishing = ref(false);

const pools = ref({ passages: 0, questions: 0, byTopic: [], byLevel: [], byTag: [] });
const cfg = reactive({ passages: 2, levels: [], topics: [], excludeRecent: false, excludeRecentDays: 7 });

const sessionId = ref(null);
const passages = ref([]);
const total = ref(0);
const pIdx = ref(0);
const sel = reactive({});      // seq -> 选中的选项下标（未提交前）
const answers = reactive({});  // seq -> 后端判分结果
const correctCount = ref(0);
const result = ref(null);

const currentPassage = computed(() => passages.value[pIdx.value] || null);
const passageDone = computed(() =>
  !!currentPassage.value && currentPassage.value.questions.every(q => answers[q.seq]));
const answeredCount = computed(() => Object.keys(answers).length);
const curNo = computed(() => Math.min(answeredCount.value + 1, total.value));
const pct = computed(() => (total.value ? Math.round((answeredCount.value / total.value) * 100) : 0));
const wordCount = computed(() =>
  ((currentPassage.value && currentPassage.value.text) || '').match(/[A-Za-z][A-Za-z'-]*/g)?.length || 0);

/* 计时 */
const elapsed = ref(0);
let timer = null;
let shownAt = 0; // 当前篇开始作答时间（用于 latencyMs）
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
    pools.value = await api.get('/api/reading/pools');
  } catch { /* 已提示 */ } finally {
    loadingPools.value = false;
  }
}
onMounted(loadPools);

function clearMaps() {
  for (const k of Object.keys(sel)) delete sel[k];
  for (const k of Object.keys(answers)) delete answers[k];
}

async function start() {
  starting.value = true;
  try {
    const d = await api.post('/api/reading/sessions', {
      passages: cfg.passages,
      levels: cfg.levels.length ? cfg.levels : undefined,
      topics: cfg.topics.length ? cfg.topics : undefined,
      excludeRecentDays: cfg.excludeRecent ? cfg.excludeRecentDays : undefined,
    });
    sessionId.value = d.sessionId;
    passages.value = d.passages || [];
    total.value = d.total || 0;
    pIdx.value = 0;
    clearMaps();
    correctCount.value = 0;
    result.value = null;
    phase.value = 'quiz';
    startTimer();
    shownAt = Date.now();
  } catch { /* 已提示 */ } finally {
    starting.value = false;
  }
}

function pick(seq, oi) {
  if (answers[seq] !== undefined) return;
  sel[seq] = oi;
}

function optClass(seq, oi) {
  const a = answers[seq];
  if (!a) return sel[seq] === oi ? 'sel' : '';
  if (oi === a.answerIndex) return 'right';
  if (oi === a.chosenIndex) return 'wrong';
  return 'dim';
}

async function submit(q) {
  if (answers[q.seq] !== undefined) return;
  if (sel[q.seq] === undefined) return ElMessage.warning('请先选择一个选项');
  submittingSeq.value = q.seq;
  try {
    const d = await api.post(`/api/reading/sessions/${sessionId.value}/answer`, {
      seq: q.seq,
      choice: sel[q.seq],
      latencyMs: Date.now() - shownAt,
    });
    answers[q.seq] = d;
    if (d.isCorrect) correctCount.value++;
  } catch { /* 已提示 */ } finally {
    submittingSeq.value = null;
  }
}

function nextPassage() {
  if (pIdx.value + 1 < passages.value.length) {
    pIdx.value++;
    shownAt = Date.now();
  } else {
    finish();
  }
}

async function finish() {
  phase.value = 'result';
  stopTimer();
  finishing.value = true;
  try {
    result.value = await api.post(`/api/reading/sessions/${sessionId.value}/finish`, {});
  } catch { /* 已提示 */ } finally {
    finishing.value = false;
  }
}

async function quit() {
  try {
    await ElMessageBox.confirm('还有未答完的题目，确定提前结束吗？', '结束练习', { type: 'warning' });
  } catch { return; }
  finish();
}

function chosenText(row) {
  const a = answers[row.seq];
  if (!a || a.chosenIndex === null || a.chosenIndex === undefined) return '（未作答）';
  return 'ABCD'[a.chosenIndex] + '. ' + row.options[a.chosenIndex];
}

function again() {
  phase.value = 'config';
  loadPools();
}

function viewRecord() {
  if (sessionId.value) router.push('/records/' + sessionId.value);
}
</script>

<style scoped>
.cfg-card { max-width: 640px; }
.quiz-top { margin-bottom: 14px; }
.qtop-row { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; }
.flex1 { flex: 1; }
.ok { color: #67c23a; }
.bad { color: #f56c6c; }
.muted { color: #909399; font-size: 13px; }

.quiz-layout { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.passage-card { flex: 1.25; min-width: 380px; }
.qs-col { flex: 1; min-width: 340px; display: flex; flex-direction: column; gap: 12px; }

.p-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.p-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.p-text { white-space: pre-wrap; line-height: 1.9; font-size: 15px; }

.q-stem { font-weight: 600; margin-bottom: 10px; }
.opts { display: flex; flex-direction: column; gap: 8px; }
.opt {
  border: 1px solid #dcdfe6; border-radius: 6px; padding: 8px 12px;
  cursor: pointer; transition: all .15s; font-size: 14px;
}
.opt:hover { border-color: #409eff; }
.opt.sel { border-color: #409eff; background: #ecf5ff; }
.opt.right { border-color: #67c23a; background: #f0f9eb; color: #529b2e; font-weight: 600; }
.opt.wrong { border-color: #f56c6c; background: #fef0f0; color: #c45656; }
.opt.dim { opacity: .55; }
.q-actions { margin-top: 10px; }
.feedback { margin-top: 10px; }
.fb-answer { margin-top: 6px; }
.fb-answer .mono { color: #409eff; font-weight: 700; }
.explain { margin-top: 6px; color: #606266; font-size: 13px; background: #f5f7fa; border-radius: 6px; padding: 8px 10px; }
.next-p { text-align: center; margin: 6px 0 10px; }

.block { margin-top: 16px; }
.result-actions { text-align: center; margin: 22px 0; display: flex; gap: 14px; justify-content: center; }
</style>
