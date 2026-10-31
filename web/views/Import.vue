<template>
  <div v-loading="busy">
    <div class="page-head">
      <div>
        <h2 class="page-title">导入词库</h2>
        <div class="meta">上传 Excel / CSV，映射列 → 校验 → 提交，全程可回滚</div>
      </div>
      <div class="actions">
        <el-button @click="downloadTemplate">下载导入模板</el-button>
      </div>
    </div>

    <el-steps :active="step" finish-status="success" align-center class="steps">
      <el-step title="上传文件" />
      <el-step title="列映射" />
      <el-step title="校验预览" />
      <el-step title="提交结果" />
    </el-steps>

    <!-- 第一步：上传 -->
    <el-card v-if="step === 0" shadow="never" class="step-card">
      <el-form label-width="90px" style="max-width: 560px">
        <el-form-item label="目标词库" required>
          <el-select v-model="bankId" placeholder="选择要导入到的词库" style="width: 100%">
            <el-option v-for="b in banks" :key="b.id" :value="b.id"
                       :label="`${b.name}${b.level ? '（' + b.level + '）' : ''}`" />
          </el-select>
        </el-form-item>
        <el-form-item label="文件">
          <el-upload drag :auto-upload="false" :limit="1" accept=".xlsx,.xls,.csv"
                     :on-change="onFileChange" :on-remove="() => (file = null)" :file-list="fileList">
            <div style="padding: 24px 0">
              将文件拖到此处，或<em>点击选择</em><br />
              <span class="muted">支持 .xlsx / .xls / .csv</span>
            </div>
          </el-upload>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :disabled="!file || !bankId" :loading="busy" @click="upload">
            上传并解析
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 第二步：列映射 -->
    <el-card v-if="step === 1" shadow="never" class="step-card">
      <el-form inline @submit.prevent>
        <el-form-item label="工作表">
          <el-select v-model="sheet" style="width: 180px" @change="reparse">
            <el-option v-for="s in sheets" :key="s" :value="s" :label="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="表头行号">
          <el-input-number v-model="headerRow" :min="1" :max="50" @change="reparse" />
        </el-form-item>
      </el-form>

      <el-table :data="headerList" size="small" empty-text="未识别到表头">
        <el-table-column prop="header" label="Excel 列名" min-width="180" />
        <el-table-column label="映射到字段" min-width="220">
          <template #default="{ row }">
            <el-select v-model="map[row.header]" placeholder="不导入" clearable style="width: 100%">
              <el-option v-for="f in IMPORT_FIELDS" :key="f.key" :value="f.key" :label="f.label" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>

      <div class="step-actions">
        <el-button @click="step = 0">上一步</el-button>
        <el-button :loading="busy" @click="reparse">按当前映射重新解析</el-button>
        <el-button type="primary" @click="step = 2">下一步：校验预览</el-button>
      </div>
    </el-card>

    <!-- 第三步：校验预览 -->
    <el-card v-if="step === 2" shadow="never" class="step-card">
      <div class="stat-cards" v-if="stats">
        <div class="stat-card"><div class="num">{{ stats.totalRows }}</div><div class="label">总行数</div></div>
        <div class="stat-card"><div class="num" style="color:#67c23a">{{ stats.validRows }}</div><div class="label">有效行</div></div>
        <div class="stat-card"><div class="num" style="color:#f56c6c">{{ stats.errorRows }}</div><div class="label">错误行</div></div>
        <div class="stat-card"><div class="num" style="color:#e6a23c">{{ stats.warnRows }}</div><div class="label">警告行</div></div>
        <div class="stat-card"><div class="num">{{ stats.newWords ?? '—' }}</div><div class="label">新单词</div></div>
        <div class="stat-card"><div class="num">{{ stats.existingWords ?? '—' }}</div><div class="label">词库已有</div></div>
      </div>

      <el-form inline @submit.prevent class="dup-form">
        <el-form-item label="文件内重复">
          <el-select v-model="dupInFile" style="width: 170px" @change="reparse">
            <el-option value="merge_senses" label="合并义项（默认）" />
            <el-option value="keep_first" label="保留第一条" />
            <el-option value="keep_last" label="保留最后一条" />
            <el-option value="error" label="报错" />
          </el-select>
        </el-form-item>
        <el-form-item label="词库已存在">
          <el-select v-model="dupInBank" style="width: 170px" @change="reparse">
            <el-option value="overwrite" label="覆盖（默认）" />
            <el-option value="skip" label="跳过" />
            <el-option value="abort" label="整批中止" />
          </el-select>
        </el-form-item>
      </el-form>

      <template v-if="errorGroups.length">
        <h4>校验问题（{{ errors.length }} 条，最多显示 500 条）</h4>
        <el-table :data="errorGroups" size="small">
          <el-table-column label="级别" width="80">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'error' ? 'danger' : 'warning'" size="small">
                {{ row.severity === 'error' ? '错误' : '警告' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="code" label="代码" width="200" />
          <el-table-column prop="message" label="说明" min-width="220" show-overflow-tooltip />
          <el-table-column prop="count" label="次数" width="80" />
          <el-table-column label="涉及行号（前 5）" min-width="200">
            <template #default="{ row }">{{ row.sample.join(', ') }}</template>
          </el-table-column>
        </el-table>
      </template>
      <el-empty v-else description="没有发现校验问题" :image-size="60" />

      <h4>数据预览（前 {{ previewRows.length }} 行）</h4>
      <el-table :data="previewRows" size="small" max-height="320">
        <el-table-column prop="rowNo" label="行号" width="70" />
        <el-table-column prop="word" label="单词" width="140" />
        <el-table-column label="义项" min-width="300">
          <template #default="{ row }">
            <div v-for="(s, i) in row.senses" :key="i" class="preview-sense">
              <span v-if="s.pos" class="muted">{{ s.pos }}</span> {{ s.def_cn || '' }}
              <span v-if="s.def_en" class="muted"> | {{ s.def_en }}</span>
            </div>
          </template>
        </el-table-column>
      </el-table>

      <div class="step-actions">
        <el-button @click="step = 1">上一步</el-button>
        <el-button type="primary" :disabled="!stats || !stats.validRows" :loading="busy" @click="commit">
          确认导入（{{ stats ? stats.validRows : 0 }} 行）
        </el-button>
      </div>
    </el-card>

    <!-- 第四步：结果 -->
    <el-card v-if="step === 3" shadow="never" class="step-card">
      <el-result :icon="commitFailed ? 'error' : 'success'"
                 :title="commitFailed ? '导入失败' : '导入完成'"
                 :sub-title="commitMsg">
        <template #extra>
          <div class="stat-cards" v-if="commitResult">
            <div class="stat-card"><div class="num" style="color:#67c23a">{{ commitResult.inserted }}</div><div class="label">新增</div></div>
            <div class="stat-card"><div class="num" style="color:#409eff">{{ commitResult.updated }}</div><div class="label">更新</div></div>
            <div class="stat-card"><div class="num">{{ commitResult.skipped }}</div><div class="label">跳过</div></div>
            <div class="stat-card"><div class="num" style="color:#f56c6c">{{ commitResult.failed }}</div><div class="label">失败</div></div>
          </div>
          <div class="step-actions" style="justify-content: center">
            <el-button @click="$router.push(`/banks/${bankId}`)">查看词库</el-button>
            <el-button @click="$router.push('/batches')">导入批次列表</el-button>
            <el-button type="primary" @click="reset">再导入一个文件</el-button>
          </div>
        </template>
      </el-result>
    </el-card>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api, download } from '../api.js';
import { IMPORT_FIELDS } from '../utils.js';

const step = ref(0);
const busy = ref(false);

const banks = ref([]);
const bankId = ref(null);

const file = ref(null);
const fileList = ref([]);

const batchId = ref(null);
const sheets = ref([]);
const sheet = ref('');
const headerRow = ref(1);
const headers = ref([]);
const map = ref({});
const errors = ref([]);
const stats = ref(null);
const previewRows = ref([]);

const dupInFile = ref('merge_senses');
const dupInBank = ref('overwrite');

const commitResult = ref(null);
const commitFailed = ref(false);
const commitMsg = ref('');

const headerList = computed(() => headers.value.map(h => ({ header: h })));

const errorGroups = computed(() => {
  const g = new Map();
  for (const e of errors.value) {
    const key = `${e.severity}|${e.code}|${e.message}`;
    if (!g.has(key)) g.set(key, { severity: e.severity, code: e.code, message: e.message, count: 0, sample: [] });
    const item = g.get(key);
    item.count++;
    if (item.sample.length < 5 && e.rowNo && !item.sample.includes(e.rowNo)) item.sample.push(e.rowNo);
  }
  return [...g.values()].sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || b.count - a.count);
});

function onFileChange(f) {
  file.value = f.raw || f;
  fileList.value = [f];
}

function applyResp(d) {
  batchId.value = d.batchId ?? batchId.value;
  sheets.value = d.sheets || sheets.value;
  sheet.value = d.sheet ?? sheet.value;
  headerRow.value = d.headerRow ?? headerRow.value;
  headers.value = d.headers || [];
  map.value = { ...(d.map || d.suggestedMap || {}) };
  errors.value = d.errors || [];
  stats.value = d.stats || null;
  previewRows.value = d.rows || [];
}

async function upload() {
  const fd = new FormData();
  fd.append('file', file.value);
  fd.append('bankId', String(bankId.value));
  if (headerRow.value) fd.append('headerRow', String(headerRow.value));
  busy.value = true;
  try {
    const d = await api.upload('/api/import/preview', fd);
    applyResp(d);
    step.value = 1;
  } catch { /* 已提示 */ } finally {
    busy.value = false;
  }
}

async function reparse() {
  if (!batchId.value) return;
  const body = {
    sheet: sheet.value || undefined,
    headerRow: headerRow.value || undefined,
    columnMap: map.value,
    dupInFile: dupInFile.value,
    dupInBank: dupInBank.value,
  };
  busy.value = true;
  try {
    const d = await api.patch(`/api/import/${batchId.value}`, body);
    applyResp(d);
    ElMessage.success('已按当前设置重新解析');
  } catch { /* 已提示 */ } finally {
    busy.value = false;
  }
}

async function commit() {
  busy.value = true;
  try {
    const d = await api.post(`/api/import/${batchId.value}/commit`);
    commitResult.value = d;
    commitFailed.value = false;
    commitMsg.value = `批次 #${batchId.value}：新增 ${d.inserted}，更新 ${d.updated}，跳过 ${d.skipped}，失败 ${d.failed}`;
    step.value = 3;
  } catch (err) {
    commitFailed.value = true;
    commitMsg.value = (err && err.message) || '提交失败，数据未变更';
    commitResult.value = null;
    step.value = 3;
  } finally {
    busy.value = false;
  }
}

function reset() {
  step.value = 0;
  file.value = null;
  fileList.value = [];
  batchId.value = null;
  sheets.value = [];
  headers.value = [];
  map.value = {};
  errors.value = [];
  stats.value = null;
  previewRows.value = [];
  commitResult.value = null;
  loadBanks();
}

function downloadTemplate() {
  const b = banks.value.find(x => x.id === bankId.value);
  download(`/api/import/template?level=${encodeURIComponent(b && b.level ? b.level : 'KET')}`, '导入模板.xlsx');
}

async function loadBanks() {
  try {
    const d = await api.get('/api/banks');
    banks.value = d.items || [];
    if (!bankId.value && banks.value.length) bankId.value = banks.value[0].id;
  } catch { /* 已提示 */ }
}

onMounted(loadBanks);
</script>

<style scoped>
.steps { margin-bottom: 20px; }
.step-card { min-height: 300px; }
.step-actions { margin-top: 20px; display: flex; gap: 8px; justify-content: flex-end; }
.dup-form { margin: 14px 0; }
.preview-sense { line-height: 1.6; }
h4 { margin: 18px 0 10px; }
</style>
