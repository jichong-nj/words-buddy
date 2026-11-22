<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">听写题库</h2>
        <div class="meta">维护「听写练习」的句库：英文原句 + 中文意思 + 逐词解析（仅管理员）</div>
      </div>
      <div class="actions">
        <el-button @click="downloadTemplate">下载模板</el-button>
        <el-button @click="exportXlsx">导出 xlsx</el-button>
        <el-button @click="openImport">导入</el-button>
        <el-button type="primary" @click="openCreate">新增句子</el-button>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="reload">
        <el-form-item label="搜索">
          <el-input v-model="filters.q" placeholder="英文句子 / 中文意思" clearable style="width: 240px"
                    @keyup.enter="reload" @clear="reload" />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="filters.level" placeholder="全部" clearable style="width: 110px" @change="reload">
            <el-option v-for="l in levelOptions" :key="l" :value="l" :label="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="主题">
          <el-select v-model="filters.topic" placeholder="全部" clearable filterable style="width: 190px"
                     @change="reload">
            <el-option v-for="t in allTopics" :key="t.key" :value="t.key"
                       :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="复核">
          <el-select v-model="filters.needs" placeholder="全部" clearable style="width: 130px" @change="reload">
            <el-option value="1" label="仅待复核" />
            <el-option value="0" label="排除待复核" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reload">查询</el-button>
          <el-button :disabled="!selection.length" type="danger" plain @click="batchDelete">
            批量删除（{{ selection.length }}）
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <el-table :data="items" @selection-change="selection = $event" empty-text="没有符合条件的句子">
        <el-table-column type="selection" width="45" />
        <el-table-column label="英文句子" min-width="250">
          <template #default="{ row }">
            <span v-if="row.needsReview" class="review-tag">待复核</span>
            <span>{{ row.sentenceEn }}</span>
          </template>
        </el-table-column>
        <el-table-column label="中文意思" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.sentenceCn || '—' }}</template>
        </el-table-column>
        <el-table-column label="等级" width="70">
          <template #default="{ row }">{{ row.level || '—' }}</template>
        </el-table-column>
        <el-table-column label="主题" width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ topicName(row.topic) || '—' }}</template>
        </el-table-column>
        <el-table-column label="来源" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.source || '—' }}</template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="170" />
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" :loading="dlg.loading && dlg.id === row.id"
                       @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination class="pager" layout="total, prev, pager, next" :total="total"
                     v-model:current-page="page" :page-size="size" @current-change="load" />
    </el-card>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dlg.open" :title="dlg.id ? '编辑句子' : '新增句子'" width="720px"
               :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="英文句子" prop="sentenceEn">
          <el-input v-model="form.sentenceEn" type="textarea" :rows="2"
                    placeholder="如 She has a nice camera.（导入时相同句子会被判重）" />
        </el-form-item>
        <el-form-item label="中文意思" prop="sentenceCn">
          <el-input v-model="form.sentenceCn" type="textarea" :rows="2" placeholder="整句中文意思，练习时作为大号提示展示" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="等级">
              <el-select v-model="form.level" placeholder="不限" clearable filterable allow-create
                         default-first-option style="width: 100%">
                <el-option v-for="l in levelOptions" :key="l" :value="l" :label="l" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="主题">
              <el-select v-model="form.topic" placeholder="不限" clearable filterable allow-create
                         default-first-option style="width: 100%">
                <el-option v-for="t in formTopics" :key="t.key" :value="t.key"
                           :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="待复核">
              <el-switch v-model="form.needsReview" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="标签">
          <el-input v-model="form.tags" placeholder="逗号分隔，如 日常,常考" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.source" placeholder="如 词库例句 · Monday / 人工整理" />
        </el-form-item>
        <el-form-item label="语法标签">
          <el-input v-model="form.grammarLabel" placeholder="如 主语和谓语 / 一般现在时" />
        </el-form-item>
        <el-form-item label="解析">
          <el-input v-model="form.analysis" type="textarea" :rows="3"
                    placeholder="答对或尝试 3 次后展示给学生" />
        </el-form-item>
        <el-form-item label="逐词解析" prop="tokensStr">
          <el-input v-model="form.tokensStr" type="textarea" :rows="6" class="tokens-input"
                    placeholder='可选，JSON 数组；如 [{"w":"She","pos":"代词","ipa":"/ʃi/","cn":"她"}]，留空表示不展示逐词卡片' />
          <div class="tip muted">格式要求：JSON 数组，每一项含 w（单词），可选 pos / ipa / cn；保存前会校验格式。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入向导 -->
    <el-dialog v-model="imp.open" title="导入听写句库" width="820px" :close-on-click-modal="false">
      <el-form inline>
        <el-form-item label="文件">
          <el-upload :auto-upload="false" :limit="1" accept=".xlsx,.xls,.csv"
                     :on-change="onFileChange" :on-remove="() => (imp.file = null)">
            <el-button>选择文件</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="重复时">
          <el-radio-group v-model="imp.onDuplicate">
            <el-radio-button value="skip">跳过</el-radio-button>
            <el-radio-button value="overwrite">覆盖</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="表头行">
          <el-input-number v-model="imp.headerRow" :min="1" :max="20" style="width: 110px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="imp.previewing" :disabled="!imp.file" @click="preview">
            上传预览
          </el-button>
        </el-form-item>
      </el-form>

      <div class="tip muted">
        模板列：句子 / 中文 / 等级 / 主题 / 标签 / 来源 / 语法 / 解析 / 逐词（JSON）。先上传预览，确认统计与错误后再正式导入。
      </div>

      <template v-if="imp.preview">
        <el-descriptions :column="5" border size="small" class="imp-stats">
          <el-descriptions-item label="总行数">{{ imp.preview.stats.totalRows }}</el-descriptions-item>
          <el-descriptions-item label="有效行">{{ imp.preview.stats.validRows }}</el-descriptions-item>
          <el-descriptions-item label="错误行">
            <span class="err">{{ imp.preview.stats.errorRows }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="警告行">
            <span class="warn">{{ imp.preview.stats.warnRows }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="已存在">
            {{ imp.preview.stats.skipped }}
            <span class="muted">（{{ imp.onDuplicate === 'overwrite' ? '覆盖' : '跳过' }}）</span>
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="imp.preview.errors && imp.preview.errors.length">
          <h4>错误与警告（{{ imp.preview.errors.length }}）</h4>
          <el-table :data="imp.preview.errors.slice(0, 100)" size="small" max-height="220"
                    :row-class-name="({ row }) => (row.severity === 'error' ? 'row-err' : 'row-warn')">
            <el-table-column prop="rowNo" label="行号" width="70" />
            <el-table-column label="级别" width="80">
              <template #default="{ row }">
                <el-tag :type="row.severity === 'error' ? 'danger' : 'warning'" size="small">
                  {{ row.severity === 'error' ? '错误' : '警告' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="句子" min-width="200" show-overflow-tooltip />
            <el-table-column prop="field" label="字段" width="100" />
            <el-table-column prop="message" label="信息" min-width="220" show-overflow-tooltip />
          </el-table>
        </template>

        <h4>数据预览（前 {{ Math.min(imp.preview.rows.length, 50) }} 行）</h4>
        <el-table :data="imp.preview.rows.slice(0, 50)" size="small" max-height="260">
          <el-table-column prop="rowNo" label="行号" width="65" />
          <el-table-column prop="sentenceEn" label="英文句子" min-width="260" show-overflow-tooltip />
          <el-table-column prop="sentenceCn" label="中文" min-width="180" show-overflow-tooltip />
          <el-table-column prop="level" label="等级" width="65" />
          <el-table-column prop="topic" label="主题" width="150" show-overflow-tooltip />
        </el-table>
      </template>

      <template #footer>
        <el-button @click="imp.open = false">取消</el-button>
        <el-button type="primary" :loading="imp.committing" :disabled="!imp.preview" @click="commit">
          确认导入
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, download } from '../api.js';
import { qs } from '../utils.js';

const loading = ref(false);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const selection = ref([]);
const filters = reactive({ q: '', level: null, topic: null, needs: null });

/* 等级 / 主题下拉 */
const poolsByLevel = ref([]);
const levelOptions = computed(() => {
  const set = new Set(['KET', 'PET']);
  for (const l of poolsByLevel.value) {
    if (l.level && l.level !== '（未分级）') set.add(l.level);
  }
  return [...set];
});

const topicsByLevel = ref({ KET: [], PET: [] });
const allTopics = computed(() => {
  const map = new Map();
  for (const t of [...topicsByLevel.value.KET, ...topicsByLevel.value.PET]) {
    if (!map.has(t.key)) map.set(t.key, t);
  }
  return [...map.values()];
});
function topicName(key) {
  if (!key) return '';
  const t = allTopics.value.find(x => x.key === key);
  return t && t.cn ? `${t.cn}（${key}）` : key;
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/dictation/items${qs({
      q: filters.q, level: filters.level, topic: filters.topic, needs: filters.needs,
      page: page.value, size,
    })}`);
    items.value = d.items || [];
    total.value = d.total || 0;
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function reload() {
  page.value = 1;
  load();
}

/* ── 新增 / 编辑 ── */
const formRef = ref(null);
const dlg = reactive({ open: false, saving: false, loading: false, id: null });
const form = reactive({
  sentenceEn: '', sentenceCn: '', level: '', topic: '', tags: '', source: '',
  grammarLabel: '', analysis: '', tokensStr: '', needsReview: false,
});

const rules = {
  sentenceEn: [
    { required: true, message: '请输入英文句子', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        /[A-Za-z]/.test(String(value || '')) ? cb() : cb(new Error('英文句子需要包含英文字母')),
      trigger: 'blur',
    },
  ],
  sentenceCn: [{ required: true, message: '请输入中文意思', trigger: 'blur' }],
  tokensStr: [
    {
      validator: (rule, value, cb) => {
        const t = String(value || '').trim();
        if (!t) return cb();
        let arr;
        try { arr = JSON.parse(t); } catch { return cb(new Error('不是合法的 JSON')); }
        if (!Array.isArray(arr)) return cb(new Error('逐词解析应为数组，如 [{"w":"She","pos":"代词"}]'));
        if (arr.some(x => !x || typeof x !== 'object' || Array.isArray(x))) {
          return cb(new Error('数组每一项都必须是对象'));
        }
        if (arr.some(x => !String(x.w ?? x.word ?? '').trim())) {
          return cb(new Error('每个逐词对象都需要 w 字段（单词）'));
        }
        cb();
      },
      trigger: 'blur',
    },
  ],
};

const formTopics = computed(() =>
  form.level && topicsByLevel.value[form.level] ? topicsByLevel.value[form.level] : allTopics.value
);

function formatTokens(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) return '';
  return JSON.stringify(tokens, null, 2);
}

function fillForm(row) {
  Object.assign(form, {
    sentenceEn: row.sentenceEn || '',
    sentenceCn: row.sentenceCn || '',
    level: row.level || '',
    topic: row.topic || '',
    tags: row.tags || '',
    source: row.source || '',
    grammarLabel: row.grammarLabel || '',
    analysis: row.analysis || '',
    tokensStr: formatTokens(row.tokens),
    needsReview: !!row.needsReview,
  });
}

function openCreate() {
  dlg.id = null;
  fillForm({});
  dlg.open = true;
}

async function openEdit(row) {
  dlg.loading = true;
  try {
    const d = await api.get(`/api/dictation/items/${row.id}`);
    dlg.id = row.id;
    fillForm(d);
    dlg.open = true;
  } catch { /* 已提示 */ } finally {
    dlg.loading = false;
  }
}

async function save() {
  try {
    await formRef.value.validate();
  } catch { return; }
  const t = String(form.tokensStr || '').trim();
  const tokens = t ? JSON.parse(t) : [];
  const body = {
    sentenceEn: form.sentenceEn.trim(),
    sentenceCn: form.sentenceCn.trim(),
    level: form.level || '',
    topic: form.topic || '',
    tags: form.tags || '',
    source: form.source || '',
    grammarLabel: form.grammarLabel || '',
    analysis: form.analysis || '',
    tokens,
    needsReview: form.needsReview,
  };
  dlg.saving = true;
  try {
    if (dlg.id) await api.put(`/api/dictation/items/${dlg.id}`, body);
    else await api.post('/api/dictation/items', body);
    ElMessage.success(dlg.id ? '已保存' : '已新增');
    dlg.open = false;
    load();
  } catch { /* 已提示（含「同一英文句子已存在」） */ } finally {
    dlg.saving = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除句子「${row.sentenceEn}」吗？`, '删除', { type: 'warning' });
  } catch { return; }
  try {
    await api.del(`/api/dictation/items/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch { /* 已提示 */ }
}

async function batchDelete() {
  const ids = selection.value.map(r => r.id);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个句子吗？`, '批量删除', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post('/api/dictation/items/batch-delete', { ids });
    ElMessage.success(`已删除 ${d.deleted} 条`);
    load();
  } catch { /* 已提示 */ }
}

/* ── 模板 / 导出 / 导入 ── */
function downloadTemplate() {
  download('/api/dictation/template', '听写句库导入模板.xlsx');
}
function exportXlsx() {
  download('/api/dictation/export.xlsx', '听写句库.xlsx');
}

const imp = reactive({
  open: false, file: null, onDuplicate: 'skip', headerRow: 1,
  previewing: false, committing: false, preview: null,
});

function openImport() {
  imp.file = null;
  imp.preview = null;
  imp.onDuplicate = 'skip';
  imp.headerRow = 1;
  imp.open = true;
}

function onFileChange(file) {
  imp.file = file.raw || null;
  imp.preview = null;
}

function buildFormData(dryRun) {
  const fd = new FormData();
  fd.append('file', imp.file, imp.file.name);
  fd.append('dryRun', dryRun);
  fd.append('onDuplicate', imp.onDuplicate);
  fd.append('headerRow', String(imp.headerRow));
  return fd;
}

async function preview() {
  imp.previewing = true;
  try {
    imp.preview = await api.upload('/api/dictation/import', buildFormData('1'));
  } catch { /* 已提示 */ } finally {
    imp.previewing = false;
  }
}

async function commit() {
  imp.committing = true;
  try {
    const d = await api.upload('/api/dictation/import', buildFormData('0'));
    const s = d.stats || {};
    ElMessage.success(`导入完成：新增 ${s.inserted ?? 0}，更新 ${s.updated ?? 0}，跳过 ${s.skipped ?? 0}`);
    imp.open = false;
    reload();
  } catch { /* 已提示 */ } finally {
    imp.committing = false;
  }
}

onMounted(async () => {
  load();
  try {
    const p = await api.get('/api/dictation/pools');
    poolsByLevel.value = p.byLevel || [];
  } catch { /* 已提示 */ }
  for (const lv of ['KET', 'PET']) {
    try {
      const d = await api.get(`/api/meta/topics${qs({ level: lv })}`);
      topicsByLevel.value[lv] = d.items || [];
    } catch { /* 已提示 */ }
  }
});
</script>

<style scoped>
.filter-card { margin-bottom: 14px; }
.filter-card :deep(.el-form-item) { margin-bottom: 8px; }
.review-tag {
  display: inline-block; font-size: 11px; color: #e6a23c; border: 1px solid #e6a23c;
  border-radius: 3px; padding: 0 4px; margin-right: 6px;
}
.tip { font-size: 12px; line-height: 1.6; }
.tokens-input :deep(textarea) {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
}
.imp-stats { margin: 12px 0; }
.imp-stats .err { color: #f56c6c; font-weight: 700; }
.imp-stats .warn { color: #e6a23c; font-weight: 700; }
h4 { margin: 14px 0 8px; }
:deep(.row-err) { color: #f56c6c; }
:deep(.row-warn) { color: #e6a23c; }
</style>
