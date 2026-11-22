<template>
  <div>
    <!-- ───────────── ① 配置阶段 ───────────── -->
    <template v-if="phase === 'config'">
      <div class="page-head">
        <div>
          <h2 class="page-title">听写练习</h2>
          <div class="meta">听音频，写出你听到的完整句子。首次提交决定对错，答错可以重听、修改后重试。</div>
        </div>
        <div class="actions">
          <button class="sound-toggle light" :title="soundOn ? '关闭音效' : '开启音效'" @click="toggleSound">
            {{ soundOn ? '🔊 音效开' : '🔇 音效关' }}
          </button>
        </div>
      </div>

      <div v-if="pools.total > 0" class="stat-cards">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ pools.total }}</div><div class="label">题库总句数</div></div>
        <div class="stat-card"><div class="num">{{ pools.byLevel.length }}</div><div class="label">等级数</div></div>
        <div class="stat-card"><div class="num">{{ analysisAttempts }}</div><div class="label">答错几次解锁逐词解析</div></div>
        <div class="stat-card"><div class="num">{{ pools.byTopic.length }}</div><div class="label">主题数</div></div>
      </div>

      <el-empty v-if="!loadingPools && pools.total === 0"
                description="听写句库为空，请让管理员先在「听写题库」页导入句子" />
      <div v-else-if="loadingPools && pools.total === 0" class="loading-block" v-loading="true"></div>

      <el-card v-if="pools.total > 0" shadow="never" class="cfg-card">
        <el-form label-width="110px">
          <el-form-item label="等级">
            <el-select v-model="cfg.levels" multiple collapse-tags collapse-tags-tooltip clearable
                       placeholder="不限等级，可多选" style="width: 420px">
              <el-option v-for="l in pools.byLevel" :key="l.level" :value="l.level"
                         :label="`${l.level}（${l.count} 句）`" />
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
            <el-select v-if="cfg.excludeRecent" v-model="cfg.excludeRecentDays"
                       style="width: 130px; margin-left: 10px">
              <el-option :value="7" label="最近 7 天" />
              <el-option :value="14" label="最近 14 天" />
              <el-option :value="30" label="最近 30 天" />
            </el-select>
            <span class="muted" style="margin-left: 10px">跳过近期听写过的句子</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="starting" @click="start">开始听写</el-button>
            <span class="muted" style="margin-left: 12px">共 {{ cfg.count }} 题，按首次提交统计正确率</span>
          </el-form-item>
        </el-form>
      </el-card>
    </template>

    <!-- ───────────── ② 答题阶段（深色专注） ───────────── -->
    <div v-else-if="phase === 'quiz'" class="focus">
      <!-- 顶部条：计时 / 进度 / 音效 / 退出 -->
      <div class="focus-top">
        <div class="ft-left">
          <span class="timer">⏱ {{ fmtClock(elapsed) }}</span>
          <span class="ft-sep"></span>
          <span class="progress-text">第 <b>{{ idx + 1 }}</b> / {{ questions.length }} 题</span>
        </div>
        <div class="ft-right">
          <button class="sound-toggle" :title="soundOn ? '关闭音效' : '开启音效'" @click="toggleSound">
            {{ soundOn ? '🔊 音效' : '🔇 静音' }}
          </button>
          <button class="ghost-btn" type="button" @click="quit">退出</button>
        </div>
      </div>
      <div class="focus-progress">
        <div class="focus-progress-fill" :style="{ width: progressPct + '%' }"></div>
      </div>

      <!-- 上一题回顾行 -->
      <div v-if="prevQuestion" class="prev-row">
        <span class="prev-tag">上一题</span>
        <span v-if="prevSentence" class="prev-en">{{ prevSentence }}</span>
        <span v-else class="prev-en prev-hidden">（原句未解锁）</span>
        <span class="prev-mark" :class="prevMarkClass">{{ prevMark }}</span>
        <span class="prev-cn">{{ prevQuestion.prompt || '（无中文提示）' }}</span>
      </div>

      <div v-if="current" class="focus-card" v-loading="submitting" element-loading-background="rgba(11, 18, 32, .6)">
        <!-- 中央大号中文提示 -->
        <div class="cue-label">这句话的意思是</div>
        <div class="cue" :class="{ empty: !current.prompt }">
          {{ current.prompt || '请听音频，写出你听到的句子' }}
        </div>
        <div class="cue-meta">
          <span class="chip">{{ current.wordCount }} 个词</span>
          <span v-if="current.level" class="chip">{{ current.level }}</span>
          <span v-if="current.topic" class="chip">{{ current.topic }}</span>
        </div>

        <!-- 音频播放 + CSS 波形动画 -->
        <div class="audio-row">
          <button class="play-btn" :class="{ playing }" type="button" title="播放 / 重播" @click="playCurrent">
            <span class="play-icon">{{ playing ? '❚❚' : '▶' }}</span>
          </button>
          <div class="wave" :class="{ playing }" aria-hidden="true">
            <span v-for="i in 28" :key="i"
                  :style="{ animationDelay: (i * 0.055).toFixed(3) + 's', animationDuration: (0.65 + (i % 5) * 0.11).toFixed(2) + 's' }"></span>
          </div>
          <span class="audio-hint">{{ audioHint }}</span>
          <button class="loop-btn" :class="{ on: loopOn }" type="button"
                  :title="loopOn ? '自动循环播放中，点击关闭' : '自动循环已关闭，点击开启（间隔 2 秒）'"
                  @click="toggleLoop">🔁 循环{{ loopOn ? '开' : '关' }}</button>
        </div>
        <div v-if="autoplayBlocked" class="autoplay-tip">
          浏览器阻止了自动播放，请点击上方 ▶ 按钮听音频
        </div>
        <audio ref="audioEl" :src="current.audio" preload="auto"
               @play="onAudioPlay" @ended="onAudioEnd" @pause="onAudioPause" @error="onAudioError"></audio>

        <!-- 输入框 -->
        <div class="answer-wrap">
          <input ref="inputEl" v-model="given" class="answer-input" type="text" spellcheck="false"
                 autocomplete="off" autocapitalize="off"
                 :readonly="lockedCorrect"
                 :class="{ 'is-ok': lockedCorrect, 'is-bad': curResult && !curResult.correct }"
                 :placeholder="lockedCorrect ? '本题已答对' : '写下听到的完整句子，按 Enter 提交'" />
        </div>
        <div class="enter-tip" v-if="!curResult || !curResult.unlockedAnswer" :class="{ ok: lockedCorrect }">{{ enterTip }}</div>

        <!-- 判定结果：逐词着色回显 / 答案卡 -->
        <template v-if="curResult">
          <div class="diff-panel" :class="curResult.correct ? 'is-ok' : 'is-bad'">
            <DiffWords :diff="curResult.diff" dark />
          </div>

          <div v-if="!curResult.correct" class="retry-line">
            还有单词需要更正，再听一次后重新输入。已尝试 {{ curResult.attempts }} 次。
          </div>

          <div v-if="curResult.unlockedAnswer && curResult.reveal" class="reveal-card">
            <div class="rv-head">
              <span class="rv-badge" :class="{ ok: curResult.correct }">
                {{ curResult.correct ? '✓ 回答正确' : '参考答案已解锁' }}
              </span>
              <span class="rv-en">{{ curResult.reveal.sentence }}</span>
            </div>
            <div v-if="curResult.reveal.sentenceCn" class="rv-cn">{{ curResult.reveal.sentenceCn }}</div>

            <div v-if="revealTokens.length" class="tokens">
              <span v-for="(t, i) in revealTokens" :key="i" class="token">
                <b class="t-w">{{ t.w }}</b>
                <span v-if="t.pos" class="t-pos">{{ t.pos }}</span>
                <span v-if="t.ipa" class="t-ipa">{{ t.ipa }}</span>
                <span v-if="t.cn" class="t-cn">{{ t.cn }}</span>
              </span>
            </div>

            <div v-if="curResult.reveal.grammarLabel" class="rv-row">
              <span class="rv-k">语法</span>
              <span class="rv-tag">{{ curResult.reveal.grammarLabel }}</span>
            </div>
            <div v-if="curResult.reveal.analysis" class="rv-row rv-analysis">
              <span class="rv-k">解析</span>
              <span class="rv-text">{{ curResult.reveal.analysis }}</span>
            </div>

            <div class="rv-enter">
              {{ curResult.correct ? '回答正确，按 Enter 继续' : '已解锁参考答案：可再听一遍后重新输入，或点「下一题」继续' }}
            </div>
          </div>

          <div v-else-if="curResult.correct" class="correct-line">✓ 回答正确，按 Enter 继续</div>
          <div v-else class="unlock-hint">
            再尝试 {{ unlockLeft }} 次可查看英文原句与逐词解析
          </div>
        </template>
      </div>

      <!-- 底部统计条 + 操作 -->
      <div class="focus-bottom">
        <div class="fb-stats">
          <span class="st ok">已答对 <b>{{ statRight }}</b></span>
          <span class="st bad">已答错 <b>{{ statWrong }}</b></span>
          <span class="st">实时正确率 <b :class="statAccuracy >= 85 ? 'ok-text' : statAccuracy >= 60 ? 'warn-text' : 'bad-text'">{{ statAccuracy }}%</b></span>
          <span class="st-note">按首次提交统计</span>
        </div>
        <div class="fb-btns">
          <button class="fbtn" type="button" :disabled="idx === 0" @click="goPrev">上一题</button>
          <button class="fbtn" type="button" @click="playCurrent">重播</button>
          <button class="fbtn primary" type="button" :disabled="submitting || lockedCorrect" @click="submit">
            {{ submitting ? '提交中…' : curResult ? '重新提交' : '提交' }}
          </button>
          <button class="fbtn" type="button" @click="goNext">
            {{ idx + 1 < questions.length ? '下一题' : '完成练习' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ───────────── ③ 结果阶段 ───────────── -->
    <template v-else>
      <div class="page-head">
        <div>
          <h2 class="page-title">听写练习完成 🎉</h2>
          <div class="meta">首次提交决定对错；答错时逐词对比只显示你的输入与漏词空槽，不泄露原句</div>
        </div>
        <div class="actions">
          <el-button @click="viewRecord">查看记录</el-button>
          <el-button type="primary" @click="again">再练一组</el-button>
        </div>
      </div>

      <div class="stat-cards" v-loading="finishing">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ result ? result.score : '—' }}</div><div class="label">得分</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ result ? `${result.correct} / ${result.total}` : '—' }}</div><div class="label">首次答对 / 总题数</div></div>
        <div class="stat-card"><div class="num" style="color:#e6a23c">{{ result && result.total ? fmtPct(result.correct / result.total * 100) : '—' }}</div><div class="label">正确率</div></div>
        <div class="stat-card"><div class="num">{{ result ? fmtSec(result.durationMs) : fmtSec(elapsed * 1000) }}</div><div class="label">用时</div></div>
      </div>

      <el-card shadow="never">
        <template #header>逐题回顾（{{ reviewItems.length }} 题）</template>
        <el-table v-if="reviewItems.length" :data="reviewItems" size="small"
                  :row-class-name="({ row }) => (row.isCorrect === 0 || row.isCorrect === false ? 'row-bad' : '')">
          <el-table-column prop="seq" label="#" width="55" />
          <el-table-column label="英文原句" min-width="260" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sentence || '—' }}</template>
          </el-table-column>
          <el-table-column label="中文意思" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ row.sentenceCn || '—' }}</template>
          </el-table-column>
          <el-table-column label="你的输入" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              <span :class="row.isCorrect === 0 || row.isCorrect === false ? 'bad' : ''">
                {{ row.given || '（未作答）' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="尝试次数" width="95">
            <template #default="{ row }">{{ row.attempts || '—' }}</template>
          </el-table-column>
          <el-table-column label="结果" width="90">
            <template #default="{ row }">
              <el-tag v-if="row.isCorrect === 1 || row.isCorrect === true" type="success" size="small">对</el-tag>
              <el-tag v-else-if="row.isCorrect === 0 || row.isCorrect === false" type="danger" size="small">错</el-tag>
              <span v-else class="muted">未作答</span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="本次听写没有作答记录" :image-size="60" />
      </el-card>

      <div class="result-actions">
        <el-button type="primary" size="large" @click="again">再练一组</el-button>
        <el-button size="large" @click="viewRecord">查看记录</el-button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { fmtPct, fmtSec, fmtClock } from '../utils.js';
import { celebrate, oops, isSoundEnabled, setSoundEnabled } from '../effects.js';
import DiffWords from '../components/DiffWords.vue';

const router = useRouter();

const phase = ref('config'); // config | quiz | result
const loadingPools = ref(true);
const starting = ref(false);
const finishing = ref(false);
const submitting = ref(false);

const pools = ref({ total: 0, analysisAttempts: 3, byLevel: [], byTopic: [] });
const analysisAttempts = ref(3);
const cfg = reactive({ levels: [], count: 10, excludeRecent: false, excludeRecentDays: 7 });

const sessionId = ref(null);
const questions = ref([]);
const idx = ref(0);
const states = reactive({}); // seq -> { given, result }
const reviewItems = ref([]);
const result = ref(null);

const soundOn = ref(isSoundEnabled());
const elapsed = ref(0);
const playing = ref(false);
const autoplayBlocked = ref(false);
const loopOn = ref(localStorage.getItem('wb.dictation.loop') !== '0');   // 自动循环播放，默认开
const loopPending = ref(false);                                          // 是否已排好下一次重播
const audioEl = ref(null);
const inputEl = ref(null);

const LOOP_GAP_MS = 2000;   // 播完隔 2 秒自动重播

let timer = null;
let loopTimer = null;
let shownAt = 0;
let busy = false; // 弹确认框时阻止 Enter 快捷键

/* ── 当前题状态 ── */
const current = computed(() => questions.value[idx.value] || null);
const currentState = computed(() => (current.value && states[current.value.seq]) || { given: '', result: null });
const curResult = computed(() => currentState.value.result || null);
const lockedCorrect = computed(() => !!(curResult.value && curResult.value.correct));
const audioHint = computed(() => {
  if (playing.value) return '正在播放…';
  if (loopPending.value) return `${LOOP_GAP_MS / 1000} 秒后自动重播…`;
  return '点击播放或重播';
});
const given = computed({
  get: () => currentState.value.given || '',
  set: (v) => {
    if (!current.value) return;
    if (!states[current.value.seq]) states[current.value.seq] = { given: '', result: null };
    states[current.value.seq].given = v;
  },
});

const revealTokens = computed(() => (curResult.value && curResult.value.reveal && curResult.value.reveal.tokens) || []);
const progressPct = computed(() => (questions.value.length ? Math.round(((idx.value + 1) / questions.value.length) * 100) : 0));
const unlockLeft = computed(() => Math.max(0, analysisAttempts.value - ((curResult.value && curResult.value.attempts) || 0)));

const enterTip = computed(() => {
  if (!curResult.value) return '按 Enter 提交 · 首次提交决定对错';
  if (curResult.value.correct) return '回答正确，按 Enter 继续';
  if (curResult.value.unlockedAnswer) return '可重听并修改输入，按 Enter 重新提交';
  return '修改后按 Enter 重新提交';
});

/* ── 上一题回顾 ── */
const prevQuestion = computed(() => (idx.value > 0 ? questions.value[idx.value - 1] : null));
const prevState = computed(() => (prevQuestion.value ? states[prevQuestion.value.seq] || null : null));
const prevSentence = computed(() => {
  const st = prevState.value;
  if (!st || !st.result || !st.result.reveal) return '';
  return st.result.reveal.sentence || '';
});
const prevMark = computed(() => {
  const st = prevState.value;
  if (!st || !st.result) return '—';
  return st.result.correct ? '✓' : '✗';
});
const prevMarkClass = computed(() => {
  const st = prevState.value;
  if (!st || !st.result) return 'none';
  return st.result.correct ? 'ok' : 'bad';
});

/* ── 实时统计（首次提交） ── */
const statRight = computed(() => Object.values(states).filter(s => s.result && s.result.firstCorrect).length);
const statWrong = computed(() => Object.values(states).filter(s => s.result && !s.result.firstCorrect).length);
const statAccuracy = computed(() => {
  const n = statRight.value + statWrong.value;
  return n ? Math.round((statRight.value / n) * 100) : 0;
});

/* ── 计时 ── */
function startTimer() {
  stopTimer();
  elapsed.value = 0;
  timer = setInterval(() => { elapsed.value++; }, 1000);
}
function stopTimer() {
  if (timer) { clearInterval(timer); timer = null; }
}
onBeforeUnmount(() => {
  stopTimer();
  window.removeEventListener('keydown', onWindowKeydown);
  stopAudio();
});

/* ── 题库与开始 ── */
async function loadPools() {
  loadingPools.value = true;
  try {
    pools.value = await api.get('/api/dictation/pools');
    analysisAttempts.value = pools.value.analysisAttempts || 3;
  } catch { /* 已提示 */ } finally {
    loadingPools.value = false;
  }
}
onMounted(() => {
  loadPools();
  window.addEventListener('keydown', onWindowKeydown);
});

async function start() {
  starting.value = true;
  try {
    const d = await api.post('/api/dictation/sessions', {
      count: cfg.count,
      levels: cfg.levels.length ? cfg.levels : undefined,
      excludeRecentDays: cfg.excludeRecent ? cfg.excludeRecentDays : undefined,
    });
    sessionId.value = d.sessionId;
    questions.value = d.questions || [];
    if (!questions.value.length) {
      ElMessage.warning('没有抽到题目，请调整筛选条件');
      return;
    }
    analysisAttempts.value = d.analysisAttempts || analysisAttempts.value || 3;
    for (const k of Object.keys(states)) delete states[k];
    for (const q of questions.value) states[q.seq] = { given: '', result: null };
    idx.value = 0;
    result.value = null;
    reviewItems.value = [];
    autoplayBlocked.value = false;
    phase.value = 'quiz';
    startTimer();
    shownAt = Date.now();
    nextTick(() => {
      focusInput();
      attemptAutoplay();
    });
  } catch { /* 已提示 */ } finally {
    starting.value = false;
  }
}

function focusInput() {
  nextTick(() => { if (inputEl.value) inputEl.value.focus(); });
}

/* ── 音频：进入每题自动播放，播完隔 2 秒循环重播（答对后停止） ── */
function resetAudio() {
  if (!audioEl.value) return;
  try { audioEl.value.currentTime = 0; } catch { /* ignore */ }
}
function clearLoop() {
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  loopPending.value = false;
}
/** 是否还需要循环：答题阶段 + 本题未答对 + 开关打开 */
function loopWanted() {
  return loopOn.value && phase.value === 'quiz' && !!current.value
    && !(curResult.value && curResult.value.correct);
}
function scheduleLoop() {
  clearLoop();
  if (!loopWanted()) return;
  loopPending.value = true;
  loopTimer = setTimeout(() => { loopTimer = null; loopPending.value = false; playCurrent(); }, LOOP_GAP_MS);
}
function toggleLoop() {
  loopOn.value = !loopOn.value;
  localStorage.setItem('wb.dictation.loop', loopOn.value ? '1' : '0');
  if (loopOn.value) scheduleLoop(); else clearLoop();
}
function playCurrent() {
  if (!audioEl.value || !current.value) return;
  clearLoop();
  resetAudio();
  autoplayBlocked.value = false;
  let p = null;
  try { p = audioEl.value.play(); } catch { autoplayBlocked.value = true; }
  if (p && typeof p.catch === 'function') p.catch(() => { autoplayBlocked.value = true; });
}
function attemptAutoplay() { playCurrent(); }
function stopAudio() {
  clearLoop();
  if (!audioEl.value) return;
  try { audioEl.value.pause(); } catch { /* ignore */ }
  playing.value = false;
}
function onAudioPlay() { playing.value = true; autoplayBlocked.value = false; }
function onAudioEnd() { playing.value = false; scheduleLoop(); }
function onAudioPause() {
  playing.value = false;
  // ended 之后浏览器会紧跟一次 pause，此时循环已由 onAudioEnd 排好，不能清掉
  if (audioEl.value && audioEl.value.ended) return;
  clearLoop();
}
function onAudioError() { playing.value = false; clearLoop(); }

function toggleSound() {
  soundOn.value = !soundOn.value;
  setSoundEnabled(soundOn.value);
}

/* ── 提交 / 判分 ── */
async function submit() {
  if (phase.value !== 'quiz' || submitting.value || !current.value) return;
  const st = currentState.value;
  if (st.result && st.result.correct) return;
  const text = String(st.given || '').trim();
  if (!text) { ElMessage.warning('请先输入你听到的句子'); focusInput(); return; }
  submitting.value = true;
  try {
    const d = await api.post(`/api/dictation/sessions/${sessionId.value}/submit`, {
      seq: current.value.seq,
      given: text,
      latencyMs: Math.max(0, Date.now() - shownAt),
    });
    if (!states[current.value.seq]) states[current.value.seq] = { given: text, result: null };
    states[current.value.seq].result = d;
    // 只在判定瞬间触发一次音效/动效（不放在渲染/watch 里）
    if (d.correct) { clearLoop(); celebrate(); }
    else oops();
    focusInput();
  } catch { /* 已提示 */ } finally {
    submitting.value = false;
  }
}

function onEnter() {
  if (phase.value !== 'quiz' || busy) return;
  if (curResult.value && curResult.value.correct) {
    if (idx.value + 1 < questions.value.length) goNext();
    else finish();
  } else {
    submit();
  }
}

function onWindowKeydown(e) {
  if (e.key !== 'Enter' || phase.value !== 'quiz' || busy) return;
  const tag = String((e.target && e.target.tagName) || '').toLowerCase();
  if (tag === 'textarea') return;
  e.preventDefault();
  onEnter();
}

/* ── 导航 ── */
function goPrev() {
  if (idx.value <= 0 || submitting.value) return;
  stopAudio();
  idx.value--;
  shownAt = Date.now();
  autoplayBlocked.value = false;
  focusInput();
}

function goNext() {
  if (submitting.value) return;
  if (idx.value + 1 < questions.value.length) {
    stopAudio();
    idx.value++;
    shownAt = Date.now();
    autoplayBlocked.value = false;
    nextTick(() => {
      focusInput();
      attemptAutoplay();
    });
  } else {
    finish();
  }
}

/* ── 结束 / 结果 ── */
function buildLocalReview() {
  return questions.value.map(q => {
    const st = states[q.seq] || {};
    const r = st.result || null;
    return {
      seq: q.seq,
      sentence: (r && r.reveal && r.reveal.sentence) || '',
      sentenceCn: q.prompt || '',
      given: st.given || '',
      attempts: r ? r.attempts : 0,
      isCorrect: r ? (r.firstCorrect ? 1 : 0) : null,
      diff: (r && r.diff) || [],
    };
  });
}

async function finish() {
  if (!sessionId.value) return;
  const sid = sessionId.value;
  const local = buildLocalReview();
  phase.value = 'result';
  finishing.value = true;
  stopTimer();
  stopAudio();
  busy = true;
  try {
    const [fin, detail] = await Promise.all([
      api.post(`/api/dictation/sessions/${sid}/finish`, {}),
      api.get(`/api/practice/sessions/${sid}`).catch(() => null),
    ]);
    result.value = fin;
    reviewItems.value = (detail && Array.isArray(detail.items) && detail.items.length) ? detail.items : local;
  } catch {
    result.value = null;
    reviewItems.value = local;
  } finally {
    finishing.value = false;
    busy = false;
  }
}

async function quit() {
  busy = true;
  let ok = false;
  try {
    await ElMessageBox.confirm('还有未答完的题目，确定结束本次听写吗？已答的题会按首次提交计入统计。', '结束听写', {
      confirmButtonText: '结束', cancelButtonText: '继续答题', type: 'warning',
    });
    ok = true;
  } catch { ok = false; } finally {
    busy = false;
  }
  if (ok) finish();
}

function again() {
  phase.value = 'config';
  result.value = null;
  reviewItems.value = [];
  loadPools();
}

function viewRecord() {
  if (sessionId.value) router.push(`/records/${sessionId.value}`);
}
</script>

<style scoped>
/* ───────── 配置 / 结果（浅色） ───────── */
.cfg-card { max-width: 680px; }
.loading-block { height: 180px; }
.sound-toggle {
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.08);
  color: #e6edf3;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.sound-toggle:hover { background: rgba(255, 255, 255, 0.16); }
.sound-toggle.light {
  border-color: #dcdfe6;
  background: #fff;
  color: #606266;
}
.sound-toggle.light:hover { border-color: #409eff; color: #409eff; }

.result-actions { text-align: center; margin: 22px 0; display: flex; gap: 14px; justify-content: center; }
:deep(.row-bad) { background: #fef0f0; }
.bad { color: #f56c6c; font-weight: 600; }

/* ───────── 答题（深色专注） ───────── */
.focus {
  margin: -16px -20px;
  min-height: calc(100vh - 52px);
  padding: 16px 26px 30px;
  background:
    radial-gradient(1000px 420px at 50% -80px, rgba(64, 158, 255, 0.16), transparent 70%),
    radial-gradient(700px 380px at 100% 100%, rgba(103, 194, 58, 0.08), transparent 70%),
    #0b1220;
  color: #e6edf3;
  display: flex;
  flex-direction: column;
}

.focus-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px 2px 12px;
}
.ft-left { display: flex; align-items: center; gap: 14px; }
.ft-right { display: flex; align-items: center; gap: 10px; }
.timer {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #7dd3fc;
}
.ft-sep { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.18); }
.progress-text { font-size: 14px; color: #aeb9c9; }
.progress-text b { color: #fff; font-size: 16px; }
.ghost-btn {
  border: 1px solid rgba(255, 255, 255, 0.24);
  background: transparent;
  color: #cbd5e1;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
}
.ghost-btn:hover { border-color: #f56c6c; color: #f87171; }

.focus-progress {
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
}
.focus-progress-fill {
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #409eff, #67e8f9);
  transition: width 0.35s ease;
}

/* 上一题回顾 */
.prev-row {
  margin: 14px auto 0;
  max-width: 860px;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 14px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.035);
  font-size: 13px;
}
.prev-tag {
  flex: none;
  padding: 1px 7px;
  border-radius: 5px;
  background: rgba(64, 158, 255, 0.18);
  color: #93c5fd;
  font-size: 12px;
}
.prev-en { color: #cbd5e1; font-size: 14px; word-break: break-word; }
.prev-hidden { color: #8492a6; font-style: italic; }
.prev-mark { font-weight: 700; font-size: 15px; }
.prev-mark.ok { color: #4ade80; }
.prev-mark.bad { color: #f87171; }
.prev-mark.none { color: #8492a6; }
.prev-cn { color: #8b98a9; margin-left: auto; }

/* 主卡片 */
.focus-card {
  width: 100%;
  max-width: 860px;
  margin: 22px auto 0;
  padding: 22px 30px 26px;
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: linear-gradient(180deg, rgba(23, 34, 54, 0.92), rgba(15, 24, 40, 0.92));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
  text-align: center;
}
.cue-label { font-size: 12px; letter-spacing: 3px; color: #64748b; }
.cue {
  margin-top: 8px;
  font-size: clamp(22px, 3vw, 34px);
  line-height: 1.5;
  font-weight: 700;
  color: #f1f5f9;
  word-break: break-word;
}
.cue.empty { color: #7b8794; font-weight: 500; font-size: 22px; }
.cue-meta { margin-top: 10px; display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; }
.chip {
  font-size: 12px;
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 20px;
  padding: 2px 10px;
}

/* 音频 */
.audio-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin: 22px 0 6px;
}
.play-btn {
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #06121f;
  background: linear-gradient(145deg, #7dd3fc, #409eff);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  box-shadow: 0 0 0 0 rgba(64, 158, 255, 0.55);
  transition: transform 0.15s, box-shadow 0.2s;
  flex: none;
}
.play-btn:hover { transform: scale(1.06); }
.play-btn.playing { box-shadow: 0 0 0 10px rgba(64, 158, 255, 0.14); }
.play-icon { transform: translateX(1px); }
.wave {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 46px;
  width: 210px;
  justify-content: center;
}
.wave span {
  width: 3px;
  height: 34px;
  border-radius: 2px;
  background: linear-gradient(180deg, #67e8f9, #3b82f6);
  transform: scaleY(0.22);
  transform-origin: center;
  opacity: 0.55;
}
.wave.playing span { animation-name: wb-wave; animation-timing-function: ease-in-out; animation-iteration-count: infinite; opacity: 0.95; }
@keyframes wb-wave {
  0%, 100% { transform: scaleY(0.2); }
  50% { transform: scaleY(1); }
}
.audio-hint { font-size: 13px; color: #8b98a9; min-width: 96px; text-align: left; }
.loop-btn {
  flex: none;
  border: 1px solid rgba(125, 211, 252, 0.3);
  background: rgba(15, 32, 51, 0.6);
  color: #8b98a9;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
}
.loop-btn.on { color: #7dd3fc; border-color: rgba(125, 211, 252, 0.6); background: rgba(64, 158, 255, 0.14); }
.loop-btn:hover { color: #bae6fd; }
.autoplay-tip {
  display: inline-block;
  margin-top: 4px;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12px;
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
}

/* 输入 */
.answer-wrap { max-width: 640px; margin: 20px auto 0; }
.answer-input {
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-bottom: 2px solid rgba(148, 163, 184, 0.4);
  background: transparent;
  color: #f8fafc;
  font-size: clamp(20px, 2.4vw, 26px);
  text-align: center;
  letter-spacing: 0.5px;
  outline: none;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace;
  transition: border-color 0.2s;
}
.answer-input::placeholder { color: #64748b; font-size: 16px; font-family: inherit; letter-spacing: 0; }
.answer-input:focus { border-bottom-color: #409eff; }
.answer-input.is-ok { border-bottom-color: #4ade80; color: #86efac; }
.answer-input.is-bad { border-bottom-color: #f87171; }
.enter-tip { margin-top: 8px; font-size: 12px; color: #7b8794; }
.enter-tip.ok { color: #4ade80; }

/* 判定回显 */
.diff-panel {
  margin: 18px auto 0;
  max-width: 720px;
  padding: 12px 18px;
  border-radius: 12px;
  text-align: left;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(2, 6, 23, 0.55);
}
.diff-panel.is-ok { border-color: rgba(74, 222, 128, 0.35); }
.diff-panel.is-bad { border-color: rgba(248, 113, 113, 0.28); }
.retry-line {
  margin-top: 12px;
  font-size: 15px;
  font-weight: 600;
  color: #f87171;
}
.unlock-hint { margin-top: 10px; font-size: 13px; color: #8b98a9; }
.correct-line { margin-top: 12px; font-size: 16px; font-weight: 700; color: #4ade80; }

/* 答案卡 */
.reveal-card {
  margin: 16px auto 0;
  max-width: 760px;
  text-align: left;
  border-radius: 14px;
  border: 1px solid rgba(74, 222, 128, 0.22);
  background: linear-gradient(180deg, rgba(74, 222, 128, 0.075), rgba(56, 189, 248, 0.05));
  padding: 16px 20px 14px;
}
.rv-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.rv-badge {
  flex: none;
  font-size: 12px;
  padding: 2px 9px;
  border-radius: 6px;
  color: #93c5fd;
  background: rgba(64, 158, 255, 0.18);
}
.rv-badge.ok { color: #86efac; background: rgba(74, 222, 128, 0.16); }
.rv-en {
  font-size: 21px;
  font-weight: 700;
  color: #f8fafc;
  line-height: 1.5;
  word-break: break-word;
}
.rv-cn { margin-top: 6px; font-size: 14px; color: #aeb9c9; }
.tokens { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
.token {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}
.t-w { font-size: 15px; color: #f1f5f9; }
.t-pos { color: #93c5fd; }
.t-ipa { color: #94a3b8; font-family: 'JetBrains Mono', Consolas, monospace; }
.t-cn { color: #86efac; }
.rv-row { display: flex; gap: 10px; margin-top: 10px; font-size: 13px; }
.rv-k {
  flex: none;
  color: #7b8794;
  padding-top: 1px;
}
.rv-tag {
  color: #93c5fd;
  border: 1px solid rgba(147, 197, 253, 0.35);
  border-radius: 5px;
  padding: 0 8px;
  font-size: 12px;
}
.rv-text { color: #cbd5e1; line-height: 1.7; }
.rv-enter {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
  font-size: 13px;
  color: #4ade80;
}

/* 底部统计 + 操作 */
.focus-bottom {
  width: 100%;
  max-width: 860px;
  margin: 18px auto 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 24, 40, 0.9);
}
.fb-stats { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; font-size: 13px; color: #94a3b8; }
.fb-stats .st b { font-size: 16px; margin-left: 2px; color: #e2e8f0; }
.fb-stats .st.ok b { color: #4ade80; }
.fb-stats .st.bad b { color: #f87171; }
.st-note { font-size: 11px; color: #64748b; }
.ok-text { color: #4ade80 !important; }
.warn-text { color: #fbbf24 !important; }
.bad-text { color: #f87171 !important; }
.fb-btns { display: flex; gap: 8px; flex-wrap: wrap; }
.fbtn {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #e2e8f0;
  border-radius: 9px;
  padding: 9px 18px;
  font-size: 14px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s;
}
.fbtn:hover:not(:disabled) { border-color: #409eff; color: #93c5fd; }
.fbtn:disabled { opacity: 0.4; cursor: not-allowed; }
.fbtn.primary {
  border-color: transparent;
  background: linear-gradient(135deg, #409eff, #3b82f6);
  color: #fff;
  font-weight: 600;
  min-width: 92px;
}
.fbtn.primary:hover:not(:disabled) { color: #fff; filter: brightness(1.08); }
</style>
