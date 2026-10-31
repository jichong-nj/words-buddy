<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">变形题库</h2>
        <div class="meta">维护「变形填空」的题目：带空句子 + 原型 + 正确变形（仅管理员）</div>
      </div>
      <div class="actions">
        <el-button @click="downloadTemplate">下载模板</el-button>
        <el-button @click="exportXlsx">导出 xlsx</el-button>
        <el-button @click="openImport">导入</el-button>
        <el-button type="primary" @click="openCreate">新增题目</el-button>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="reload">
        <el-form-item label="搜索">
          <el-input v-model="filters.q" placeholder="句子 / 原型 / 答案 / 解析" clearable style="width: 240px"
                    @keyup.enter="reload" @clear="reload" />
        </el-form-item>
        <el-form-item label="考点">
          <el-select v-model="filters.point" placeholder="全部" clearable filterable allow-create
                     default-first-option style="width: 150px" @change="reload">
            <el-option v-for="p in POINT_OPTIONS" :key="p" :value="p" :label="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="filters.level" placeholder="全部" clearable style="width: 110px" @change="reload">
            <el-option value="KET" label="KET" />
            <el-option value="PET" label="PET" />
          </el-select>
        </el-form-item>
        <el-form-item label="主题">
          <el-select v-model="filters.topic" placeholder="全部" clearable filterable style="width: 170px"
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
      <el-table :data="items" @selection-change="selection = $event" empty-text="没有符合条件的题目">
        <el-table-column type="selection" width="45" />
        <el-table-column label="句子" min-width="280">
          <template #default="{ row }">
            <span v-if="row.needsReview" class="review-tag">待复核</span>
            <span>{{ row.prompt }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="base" label="原型" width="110" show-overflow-tooltip />
        <el-table-column prop="answer" label="答案" width="130" show-overflow-tooltip />
        <el-table-column prop="point" label="考点" width="100">
          <template #default="{ row }">{{ row.point || '—' }}</template>
        </el-table-column>
        <el-table-column prop="wordCn" label="词义" width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.wordCn || '—' }}</template>
        </el-table-column>
        <el-table-column prop="level" label="等级" width="70">
          <template #default="{ row }">{{ row.level || '—' }}</template>
        </el-table-column>
        <el-table-column label="主题" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ topicName(row.topic) || '—' }}</template>
        </el-table-column>
        <el-table-column prop="updatedAt" label="更新时间" width="160" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination class="pager" layout="total, prev, pager, next" :total="total"
                     v-model:current-page="page" :page-size="size" @current-change="load" />
    </el-card>

    <!-- 新增 / 编辑 -->
    <el-dialog v-model="dlg.open" :title="dlg.id ? '编辑题目' : '新增题目'" width="640px"
               :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="句子" prop="prompt">
          <el-input v-model="form.prompt" type="textarea" :rows="2"
                    placeholder="I ____ school at eight yesterday.（必须包含 ____）" />
        </el-form-item>
        <el-form-item label="原型" prop="base">
          <el-input v-model="form.base" placeholder="如 arrive" style="width: 240px" />
        </el-form-item>
        <el-form-item label="答案" prop="answer">
          <el-input v-model="form.answer" placeholder="如 arrived at" style="width: 240px" />
        </el-form-item>
        <el-form-item label="可接受答案">
          <el-input v-model="form.acceptedStr" placeholder="多个用 | 分隔，如 arrived at|arrivedAt" />
          <div class="tip muted">判分时忽略大小写与首尾空格，主答案自动算可接受</div>
        </el-form-item>
        <el-form-item label="考点">
          <el-select v-model="form.point" placeholder="如 时态" clearable filterable allow-create
                     default-first-option style="width: 200px">
            <el-option v-for="p in POINT_OPTIONS" :key="p" :value="p" :label="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="form.level" placeholder="不限" clearable style="width: 200px">
            <el-option value="KET" label="KET" />
            <el-option value="PET" label="PET" />
          </el-select>
        </el-form-item>
        <el-form-item label="主题">
          <el-select v-model="form.topic" placeholder="不限" clearable filterable allow-create
                     default-first-option style="width: 240px">
            <el-option v-for="t in formTopics" :key="t.key" :value="t.key"
                       :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-input v-model="form.tags" placeholder="逗号分隔，如 过去时,常考" />
        </el-form-item>
        <el-form-item label="解析">
          <el-input v-model="form.explain" type="textarea" :rows="2" placeholder="判分后展示给学生" />
        </el-form-item>
        <el-form-item label="句子翻译">
          <el-input v-model="form.sentenceCn" type="textarea" :rows="2" placeholder="整句中文意思，判分后展示给学生" />
        </el-form-item>
        <el-form-item label="词义">
          <el-input v-model="form.wordCn" placeholder="原型词的中文意思，如 到达；抵达" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="2" placeholder="仅管理员可见" />
        </el-form-item>
        <el-form-item label="待复核">
          <el-switch v-model="form.needsReview" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="imp.open" title="导入变形题库" width="760px" :close-on-click-modal="false">
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

      <div class="tip muted">导入模板新增「句子翻译」「词义」两列：作答后学生会看到填好答案的完整句子、句子中文意思与原型词义。</div>

      <template v-if="imp.preview">
        <el-descriptions :column="4" border size="small" class="imp-stats">
          <el-descriptions-item label="总行数">{{ imp.preview.stats.totalRows }}</el-descriptions-item>
          <el-descriptions-item label="有效行">{{ imp.preview.stats.validRows }}</el-descriptions-item>
          <el-descriptions-item label="错误行">
            <span class="err">{{ imp.preview.stats.errorRows }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="警告行">
            <span class="warn">{{ imp.preview.stats.warnRows }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <template v-if="imp.preview.errors.length">
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
            <el-table-column prop="base" label="原型" width="110" show-overflow-tooltip />
            <el-table-column prop="field" label="字段" width="100" />
            <el-table-column prop="message" label="信息" min-width="220" show-overflow-tooltip />
          </el-table>
        </template>

        <h4>数据预览（前 {{ Math.min(imp.preview.rows.length, 50) }} 行）</h4>
        <el-table :data="imp.preview.rows.slice(0, 50)" size="small" max-height="260">
          <el-table-column prop="rowNo" label="行号" width="65" />
          <el-table-column prop="prompt" label="句子" min-width="220" show-overflow-tooltip />
          <el-table-column prop="base" label="原型" width="100" show-overflow-tooltip />
          <el-table-column prop="answer" label="答案" width="110" show-overflow-tooltip />
          <el-table-column prop="point" label="考点" width="90" />
          <el-table-column prop="level" label="等级" width="65" />
          <el-table-column prop="topic" label="主题" width="100" show-overflow-tooltip />
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

const POINT_OPTIONS = ['时态', '语态', '词性', '词形变化', '比较级', '介词', '非谓语', '主谓一致', '复数', '固定搭配'];

const loading = ref(false);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = 20;
const selection = ref([]);
const filters = reactive({ q: '', point: null, level: null, topic: null, needs: null });

/* 主题下拉：合并 KET / PET 两套主题体系 */
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
    const d = await api.get(`/api/form/items${qs({
      q: filters.q, point: filters.point, level: filters.level,
      topic: filters.topic, needs: filters.needs, page: page.value, size,
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
const dlg = reactive({ open: false, saving: false, id: null });
const form = reactive({
  prompt: '', base: '', answer: '', acceptedStr: '', point: '', level: '',
  topic: '', tags: '', explain: '', sentenceCn: '', wordCn: '', notes: '', needsReview: false,
});
const rules = {
  prompt: [
    { required: true, message: '请输入句子', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        String(value || '').includes('____') ? cb() : cb(new Error('句子必须包含空位 ____')),
      trigger: 'blur',
    },
  ],
  base: [{ required: true, message: '请输入原型', trigger: 'blur' }],
  answer: [{ required: true, message: '请输入答案', trigger: 'blur' }],
};
const formTopics = computed(() =>
  form.level && topicsByLevel.value[form.level] ? topicsByLevel.value[form.level] : allTopics.value
);

function resetForm(row) {
  Object.assign(form, {
    prompt: '', base: '', answer: '', acceptedStr: '', point: '', level: '',
    topic: '', tags: '', explain: '', sentenceCn: '', wordCn: '', notes: '', needsReview: false,
  }, row ? {
    prompt: row.prompt || '', base: row.base || '', answer: row.answer || '',
    acceptedStr: (row.accepted || []).join(' | '), point: row.point || '', level: row.level || '',
    topic: row.topic || '', tags: row.tags || '', explain: row.explain || '',
    sentenceCn: row.sentenceCn || '', wordCn: row.wordCn || '', notes: row.notes || '',
    needsReview: !!row.needsReview,
  } : {});
}

function openCreate() {
  dlg.id = null;
  resetForm(null);
  dlg.open = true;
}

function openEdit(row) {
  dlg.id = row.id;
  resetForm(row);
  dlg.open = true;
}

async function save() {
  await formRef.value.validate();
  const body = {
    prompt: form.prompt.trim(),
    base: form.base.trim(),
    answer: form.answer.trim(),
    accepted: form.acceptedStr.split('|').map(s => s.trim()).filter(Boolean),
    point: form.point || '', level: form.level || '', topic: form.topic || '',
    tags: form.tags || '', explain: form.explain || '', notes: form.notes || '',
    sentenceCn: form.sentenceCn || '', wordCn: form.wordCn || '',
    needsReview: form.needsReview,
  };
  dlg.saving = true;
  try {
    if (dlg.id) await api.put(`/api/form/items/${dlg.id}`, body);
    else await api.post('/api/form/items', body);
    ElMessage.success(dlg.id ? '已保存' : '已新增');
    dlg.open = false;
    load();
  } catch { /* 已提示（含「同一句子 + 原型已存在」） */ } finally {
    dlg.saving = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除题目「${row.base}」吗？`, '删除', { type: 'warning' });
  } catch { return; }
  try {
    await api.del(`/api/form/items/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch { /* 已提示 */ }
}

async function batchDelete() {
  const ids = selection.value.map(r => r.id);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 道题目吗？`, '批量删除', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post('/api/form/items/batch-delete', { ids });
    ElMessage.success(`已删除 ${d.deleted} 条`);
    load();
  } catch { /* 已提示 */ }
}

/* ── 模板 / 导出 / 导入 ── */
function downloadTemplate() {
  download('/api/form/template', '变形填空导入模板.xlsx');
}
function exportXlsx() {
  download('/api/form/export.xlsx', '变形填空题库.xlsx');
}

const imp = reactive({ open: false, file: null, onDuplicate: 'skip', headerRow: 1, previewing: false, committing: false, preview: null });

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
    imp.preview = await api.upload('/api/form/import', buildFormData('1'));
  } catch { /* 已提示 */ } finally {
    imp.previewing = false;
  }
}

async function commit() {
  imp.committing = true;
  try {
    const d = await api.upload('/api/form/import', buildFormData('0'));
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
.imp-stats { margin: 12px 0; }
.imp-stats .err { color: #f56c6c; font-weight: 700; }
.imp-stats .warn { color: #e6a23c; font-weight: 700; }
h4 { margin: 14px 0 8px; }
:deep(.row-err) { color: #f56c6c; }
:deep(.row-warn) { color: #e6a23c; }
</style>
