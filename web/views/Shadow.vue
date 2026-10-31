<template>
  <div>
    <!-- ── 配置 ── -->
    <template v-if="phase === 'config'">
      <div class="page-head">
        <div>
          <h2 class="page-title">跟读练习</h2>
          <div class="meta">听例句发音 → 跟着朗读 → 系统比对音调与节奏打分（0–100）</div>
        </div>
      </div>

      <el-alert v-if="!micOk" type="warning" show-icon :closable="false" style="margin-bottom: 14px"
                title="当前环境无法录音">
        浏览器未开放麦克风权限。请用 Chrome / Edge 打开，并通过
        <b>localhost</b> 或 <b>HTTPS</b> 访问本页面（HTTP + 局域网 IP 会被浏览器禁止录音）。
      </el-alert>

      <div class="stat-cards" v-if="pools.total > 0">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ pools.total }}</div><div class="label">例句库</div></div>
        <div class="stat-card"><div class="num">{{ pools.byLevel.length }}</div><div class="label">可选等级</div></div>
        <div class="stat-card"><div class="num">{{ pools.wordRange ? pools.wordRange.join('–') : '—' }}</div><div class="label">句长（词）</div></div>
      </div>
      <el-empty v-else v-loading="loadingPools" description="词库里还没有可跟读的例句" />

      <el-card v-if="pools.total > 0" shadow="never" class="cfg-card">
        <el-form label-width="90px">
          <el-form-item label="等级">
            <el-select v-model="cfg.levels" multiple collapse-tags clearable placeholder="不限等级" style="width: 420px">
              <el-option v-for="l in pools.byLevel" :key="l.level" :value="l.level" :label="`${l.level}（${l.count}）`" />
            </el-select>
          </el-form-item>
          <el-form-item label="句数">
            <el-radio-group v-model="cfg.count">
              <el-radio-button :value="5">5 句</el-radio-button>
              <el-radio-button :value="10">10 句</el-radio-button>
              <el-radio-button :value="20">20 句</el-radio-button>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="示范发音">
            <el-radio-group v-model="cfg.voiceSource">
              <el-radio-button value="browser">浏览器语音</el-radio-button>
              <el-radio-button value="server">系统合成</el-radio-button>
            </el-radio-group>
            <span class="muted" style="margin-left: 10px">
              {{ cfg.voiceSource === 'browser' ? (voices.length ? `已就绪：${ttsVoice ? ttsVoice.name : '默认英文语音'}` : '该浏览器没有英文语音，建议改用系统合成') : '服务器合成，音色固定' }}
            </span>
          </el-form-item>
          <el-form-item label="语速">
            <el-slider v-model="cfg.rate" :min="0.6" :max="1.3" :step="0.05" style="width: 260px" />
            <span class="muted" style="margin-left: 10px">{{ cfg.rate.toFixed(2) }}×</span>
          </el-form-item>
          <el-form-item label="排除重做">
            <el-switch v-model="cfg.excludeRecent" />
            <el-select v-if="cfg.excludeRecent" v-model="cfg.excludeRecentDays" style="width: 130px; margin-left: 10px">
              <el-option :value="7" label="最近 7 天" />
              <el-option :value="14" label="最近 14 天" />
              <el-option :value="30" label="最近 30 天" />
            </el-select>
            <span class="muted" style="margin-left: 10px">跳过近期已练过的例句</span>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :disabled="!micOk" :loading="starting" @click="start">开始练习</el-button>
          </el-form-item>
        </el-form>
      </el-card>
    </template>

    <!-- ── 跟读 ── -->
    <template v-else-if="phase === 'quiz'">
      <div class="page-head">
        <div>
          <h2 class="page-title">跟读中</h2>
          <div class="meta">第 {{ idx + 1 }} / {{ questions.length }} 句 · 平均分 {{ avgSoFar }} · 已用时 {{ fmtClock(elapsed) }}</div>
        </div>
        <div class="actions"><el-button text @click="quit">提前结束</el-button></div>
      </div>

      <el-progress :percentage="Math.round(idx / questions.length * 100)" :show-text="false" style="margin-bottom: 18px" />

      <el-card shadow="never" class="quiz-card" v-loading="scoring" element-loading-text="正在分析你的朗读…">
        <template v-if="current">
          <div class="sentence">{{ current.sentence }}</div>
          <div class="sub">
            <el-tag v-if="current.level" size="small">{{ current.level }}</el-tag>
            <span class="mono">{{ current.word }}</span>
            <span class="muted">{{ current.pos }} {{ current.defCn }}</span>
          </div>
          <div v-if="current.sentenceCn" class="cn">{{ current.sentenceCn }}</div>

          <div class="ops">
            <el-button size="large" :type="speaking ? 'warning' : 'default'" @click="playDemo">
              {{ speaking ? '⏹ 停止' : '🔊 听示范' }}
            </el-button>
            <el-button v-if="!recording" size="large" type="primary" :disabled="!micOk || scoring" @click="startRec">
              🎤 开始跟读
            </el-button>
            <el-button v-else size="large" type="danger" @click="stopRec">
              ⏹ 结束录音（{{ recSec.toFixed(1) }}s）
            </el-button>
            <span v-if="recording" class="rec-dot">● 录音中，请朗读这句话</span>
          </div>

          <!-- 评分反馈 -->
          <div v-if="scored" class="feedback">
            <div class="score-row">
              <div class="big-score" :style="{ color: scoreColor(scored.total) }">{{ scored.total }}</div>
              <div class="score-tags">
                <el-tag v-if="scored.offTarget" type="warning">听起来读的不是这句</el-tag>
                <el-tag v-else :type="verdict(scored.total).type">{{ verdict(scored.total).text }}</el-tag>
                <span class="muted">时长比 {{ scored.durationRatio }}×</span>
              </div>
            </div>

            <div class="bars">
              <div v-for="b in bars(scored)" :key="b.k" class="bar-item">
                <div class="bar-label">{{ b.label }}<b>{{ b.v }}</b></div>
                <el-progress :percentage="Math.max(0, Math.min(100, b.v))" :show-text="false" :color="scoreColor(b.v)" />
              </div>
            </div>

            <div class="curves">
              <div class="curve">
                <div class="curve-title">音调曲线 <span class="muted">灰=示范 蓝=你</span></div>
                <svg :viewBox="`0 0 ${CW} ${CH}`" class="svg">
                  <line :x1="0" :y1="CH / 2" :x2="CW" :y2="CH / 2" stroke="#eee" />
                  <polyline :points="poly(scored.curves.refPitch, 3)" fill="none" stroke="#909399" stroke-width="1.6" />
                  <polyline :points="poly(scored.curves.stuPitch, 3)" fill="none" stroke="#409eff" stroke-width="1.8" />
                </svg>
              </div>
              <div class="curve">
                <div class="curve-title">节奏（强弱） <span class="muted">灰=示范 蓝=你</span></div>
                <svg :viewBox="`0 0 ${CW} ${CH}`" class="svg">
                  <polyline :points="env(scored.curves.refEnv)" fill="none" stroke="#909399" stroke-width="1.6" />
                  <polyline :points="env(scored.curves.stuEnv)" fill="none" stroke="#409eff" stroke-width="1.8" />
                </svg>
              </div>
            </div>

            <div class="fb-actions">
              <el-button @click="startRec">↻ 再读一次</el-button>
              <el-button v-if="idx + 1 < questions.length" type="primary" @click="next">下一句（Enter）</el-button>
              <el-button v-else type="primary" @click="finish">完成练习（Enter）</el-button>
            </div>
          </div>
          <div v-else-if="failReason" class="feedback">
            <el-tag type="danger" size="large">{{ failText }}</el-tag>
            <div class="fb-actions">
              <el-button type="primary" @click="startRec">重新录音</el-button>
              <el-button @click="skip">跳过这句</el-button>
            </div>
          </div>
          <div v-else class="feedback muted">先点「听示范」听一遍，再点「开始跟读」，用接近的音调和节奏朗读</div>
        </template>
      </el-card>
    </template>

    <!-- ── 结果 ── -->
    <template v-else>
      <div class="page-head">
        <div><h2 class="page-title">跟读完成 🎉</h2></div>
        <div class="actions">
          <el-button @click="$router.push(`/records/${sessionId}`)">查看记录</el-button>
          <el-button type="primary" @click="again">再练一组</el-button>
        </div>
      </div>

      <div class="stat-cards" v-loading="finishing">
        <div class="stat-card"><div class="num" style="color:#409eff">{{ result ? result.score : '—' }}</div><div class="label">平均分</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ result ? `${result.correct}/${result.total}` : '—' }}</div><div class="label">已录音</div></div>
        <div class="stat-card"><div class="num" style="color:#e6a23c">{{ avgOf('pitch') }}</div><div class="label">音调</div></div>
        <div class="stat-card"><div class="num">{{ avgOf('rhythm') }}</div><div class="label">节奏</div></div>
      </div>

      <el-card shadow="never" style="margin-top: 16px">
        <template #header>逐句明细</template>
        <el-table :data="detail" size="small">
          <el-table-column prop="sentence" label="例句" min-width="260" show-overflow-tooltip />
          <el-table-column label="得分" width="80" sortable :sort-by="r => r.score ?? -1">
            <template #default="{ row }"><b :style="{ color: scoreColor(row.score) }">{{ row.score ?? '—' }}</b></template>
          </el-table-column>
          <el-table-column prop="pitch" label="音调" width="70" />
          <el-table-column prop="rhythm" label="节奏" width="70" />
          <el-table-column prop="fluency" label="流利" width="70" />
          <el-table-column prop="completeness" label="完整" width="70" />
          <el-table-column label="说明" min-width="120">
            <template #default="{ row }">
              <el-tag v-if="row.reason" type="danger" size="small">{{ failTextOf(row.reason) }}</el-tag>
              <el-tag v-else-if="row.offTarget" type="warning" size="small">疑似读错句</el-tag>
              <span v-else class="muted">{{ verdict(row.score).text }}</span>
            </template>
          </el-table-column>
          <el-table-column label="回听" width="200">
            <template #default="{ row }">
              <audio v-if="row.audioPath" controls preload="none" class="player"
                     :src="`/api/shadow/sessions/${sessionId}/audio/${row.seq}`" />
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';
import { fmtSec, fmtClock, shadowFailText as failTextOf } from '../utils.js';

const CW = 300;
const CH = 70;

const phase = ref('config');
const loadingPools = ref(false);
const starting = ref(false);
const scoring = ref(false);
const finishing = ref(false);

const pools = ref({ total: 0, byLevel: [], wordRange: null });
const cfg = reactive({ levels: [], count: 10, excludeRecent: false, excludeRecentDays: 7, voiceSource: 'browser', rate: 0.95 });

const sessionId = ref(null);
const questions = ref([]);
const idx = ref(0);
const scored = ref(null);      // 本句评分结果
const failReason = ref('');
const results = ref([]);       // 每句最终分数（重录覆盖）
const result = ref(null);
const detail = ref([]);
const recording = ref(false);
const recSec = ref(0);
const speaking = ref(false);
const elapsed = ref(0);

const micOk = ref(true);
const voices = ref([]);
const ttsVoice = ref(null);

const current = computed(() => questions.value[idx.value] || null);
const avgSoFar = computed(() => {
  const v = results.value.filter(x => typeof x === 'number');
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '—';
});

let timer = null;
let clock = null;
let rec = null;
let stream = null;
let chunks = [];
let audioEl = null;

onMounted(async () => {
  micOk.value = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
  loadVoices();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
  loadingPools.value = true;
  try { pools.value = await api.get('/api/shadow/pools'); } catch { /* 已提示 */ } finally { loadingPools.value = false; }
});

onBeforeUnmount(() => {
  cleanup();
  stopSpeak();
});

function cleanup() {
  if (timer) { clearInterval(timer); timer = null; }
  if (clock) { clearInterval(clock); clock = null; }
  if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch { /* 已停止 */ } }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (audioEl) { audioEl.pause(); audioEl = null; }
}

function loadVoices() {
  const all = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  voices.value = all.filter(v => /^en/i.test(v.lang));
  ttsVoice.value = voices.value.find(v => /en[-_]gb/i.test(v.lang))
    || voices.value.find(v => /en[-_]us/i.test(v.lang)) || voices.value[0] || null;
  if (cfg.voiceSource === 'browser' && !voices.value.length) cfg.voiceSource = 'server';
}

// ── 示范发音 ──────────────────────────────────────────────
function stopSpeak() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (audioEl) { audioEl.pause(); audioEl = null; }
  speaking.value = false;
}

function playDemo() {
  const text = current.value?.sentence;
  if (!text) return;
  if (speaking.value) { stopSpeak(); return; }
  speaking.value = true;
  if (cfg.voiceSource === 'browser' && window.speechSynthesis && voices.value.length) {
    const u = new SpeechSynthesisUtterance(text);
    if (ttsVoice.value) u.voice = ttsVoice.value;
    u.lang = ttsVoice.value?.lang || 'en-GB';
    u.rate = cfg.rate;
    u.onend = () => { speaking.value = false; };
    u.onerror = () => { speaking.value = false; };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return;
  }
  audioEl = new Audio(`/api/shadow/ref?text=${encodeURIComponent(text)}`);
  audioEl.onended = () => { speaking.value = false; audioEl = null; };
  audioEl.onerror = () => { speaking.value = false; audioEl = null; ElMessage.error('示范音频加载失败'); };
  audioEl.play().catch(() => { speaking.value = false; ElMessage.error('无法播放示范音频'); });
}

// ── 录音 ─────────────────────────────────────────────────
const pickMime = () => {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
};

async function startRec() {
  if (recording.value) return;
  stopSpeak();
  scored.value = null;
  failReason.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    ElMessage.error('麦克风不可用，请检查浏览器地址栏的麦克风权限');
    return;
  }
  const mime = pickMime();
  try {
    rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch {
    rec = new MediaRecorder(stream);
  }
  chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = onRecStop;
  rec.start();
  recording.value = true;
  recSec.value = 0;
  timer = setInterval(() => {
    recSec.value += 0.1;
    if (recSec.value >= 20) stopRec();   // 兜底，防止忘记停止
  }, 100);
}

function stopRec() {
  if (rec && rec.state !== 'inactive') rec.stop();
  recording.value = false;
  if (timer) { clearInterval(timer); timer = null; }
}

async function onRecStop() {
  const type = rec?.mimeType || pickMime() || 'audio/webm';
  const blob = new Blob(chunks, { type });
  chunks = [];
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (recSec.value < 0.6) { failReason.value = 'too_short'; return; }

  scoring.value = true;
  try {
    const fd = new FormData();
    fd.append('seq', String(current.value.seq));
    fd.append('mime', type);
    fd.append('file', blob, 'take.webm');
    const r = await api.upload(`/api/shadow/sessions/${sessionId.value}/attempt`, fd);
    if (!r.ok) { failReason.value = r.reason || 'failed'; return; }
    scored.value = r;
    results.value[idx.value] = r.total;
  } catch {
    failReason.value = 'upload_failed';
  } finally {
    scoring.value = false;
  }
}

// ── 流程 ─────────────────────────────────────────────────
async function start() {
  starting.value = true;
  try {
    const r = await api.post('/api/shadow/sessions', {
      count: cfg.count, levels: cfg.levels.length ? cfg.levels : null,
      excludeRecentDays: cfg.excludeRecent ? cfg.excludeRecentDays : 0,
    });
    sessionId.value = r.sessionId;
    questions.value = r.questions;
    idx.value = 0;
    results.value = [];
    scored.value = null;
    failReason.value = '';
    phase.value = 'quiz';
    elapsed.value = 0;
    clock = setInterval(() => { elapsed.value += 1000; }, 1000);
  } catch { /* 已提示 */ } finally { starting.value = false; }
}

function resetItem() {
  scored.value = null;
  failReason.value = '';
  stopSpeak();
}

function next() {
  if (idx.value + 1 < questions.value.length) { idx.value += 1; resetItem(); } else finish();
}

function skip() {
  results.value[idx.value] = null;
  next();
}

async function quit() {
  try {
    await ElMessageBox.confirm('提前结束会按已录音的句子计算平均分，确定吗？', '提前结束', {
      confirmButtonText: '结束', cancelButtonText: '继续练', type: 'warning',
    });
  } catch { return; }
  await finish(true);
}

async function finish(early = false) {
  cleanup();
  finishing.value = true;
  phase.value = 'result';
  try {
    result.value = await api.post(`/api/shadow/sessions/${sessionId.value}/finish`);
    const d = await api.get(`/api/practice/sessions/${sessionId.value}`);
    detail.value = d.items || [];
  } catch { /* 已提示 */ } finally { finishing.value = false; }
  if (!early) ElMessage.success('本次跟读已完成');
}

function again() {
  phase.value = 'config';
  result.value = null;
  detail.value = [];
}

// ── 展示辅助 ─────────────────────────────────────────────
function scoreColor(v) {
  if (v == null) return '#909399';
  if (v >= 85) return '#67c23a';
  if (v >= 70) return '#409eff';
  if (v >= 55) return '#e6a23c';
  return '#f56c6c';
}

function verdict(v) {
  if (v >= 90) return { text: '非常接近示范', type: 'success' };
  if (v >= 80) return { text: '音调节奏都不错', type: 'success' };
  if (v >= 65) return { text: '还不错，注意起伏', type: 'primary' };
  if (v >= 50) return { text: '差距较大，再听一遍', type: 'warning' };
  return { text: '没太听清，重新录一次', type: 'danger' };
}

function bars(s) {
  return [
    { k: 'p', label: '音调', v: s.pitch },
    { k: 'r', label: '节奏', v: s.rhythm },
    { k: 'f', label: '流利', v: s.fluency },
    { k: 'c', label: '完整', v: s.completeness },
  ];
}

function avgOf(key) {
  const v = detail.value.map(r => r[key]).filter(x => typeof x === 'number');
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : '—';
}

const failText = computed(() => failTextOf(failReason.value));

// 音调曲线：值域约 ±3，居中绘制
function poly(arr, span) {
  if (!arr || !arr.length) return '';
  const n = arr.length;
  return arr.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * CW;
    const y = CH / 2 - Math.max(-span, Math.min(span, v)) / span * (CH / 2 - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

// 能量包络：0–1，从上往下
function env(arr) {
  if (!arr || !arr.length) return '';
  const n = arr.length;
  return arr.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * CW;
    const y = CH - 4 - Math.max(0, Math.min(1, v)) * (CH - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
</script>

<style scoped>
.cfg-card { max-width: 640px; }
.quiz-card { max-width: 760px; margin: 0 auto; text-align: center; }
.sentence { font-size: 26px; font-weight: 700; line-height: 1.5; }
.sub { margin-top: 10px; font-size: 14px; color: #606266; display: flex; gap: 8px; justify-content: center; align-items: center; }
.cn { margin-top: 8px; font-size: 15px; color: #909399; }
.ops { margin-top: 22px; display: flex; gap: 12px; justify-content: center; align-items: center; flex-wrap: wrap; }
.rec-dot { color: #f56c6c; font-size: 14px; animation: blink 1.2s infinite; }
@keyframes blink { 50% { opacity: 0.35; } }
.feedback { margin-top: 24px; }
.score-row { display: flex; gap: 16px; align-items: center; justify-content: center; }
.big-score { font-size: 56px; font-weight: 800; line-height: 1; }
.score-tags { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
.bars { margin: 18px auto 0; max-width: 520px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px 22px; text-align: left; }
.bar-label { font-size: 13px; color: #606266; margin-bottom: 4px; }
.bar-label b { float: right; color: #303133; }
.curves { margin: 18px auto 0; max-width: 620px; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.curve-title { font-size: 13px; color: #606266; margin-bottom: 4px; text-align: left; }
.svg { width: 100%; height: 70px; background: #fafafa; border: 1px solid #ebeef5; border-radius: 4px; }
.fb-actions { margin-top: 20px; }
.player { height: 28px; width: 190px; vertical-align: middle; }
@media (max-width: 900px) { .bars, .curves { grid-template-columns: 1fr; } }
</style>
