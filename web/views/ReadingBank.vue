<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">阅读理解题库</h2>
        <div class="meta">维护「阅读理解」的文章与单选题：一篇文章带多道四选一题目（仅管理员）</div>
      </div>
      <div class="actions">
        <el-button @click="downloadTemplate">下载模板</el-button>
        <el-button @click="exportXlsx">导出 xlsx</el-button>
        <el-button @click="openImport">导入</el-button>
        <el-button type="primary" @click="openCreate">新增文章</el-button>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent="reload">
        <el-form-item label="搜索">
          <el-input v-model="filters.q" placeholder="标题 / 正文" clearable style="width: 220px"
                    @keyup.enter="reload" @clear="reload" />
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
      <el-table :data="items" @selection-change="selection = $event" empty-text="没有符合条件的文章">
        <el-table-column type="selection" width="45" />
        <el-table-column label="标题" min-width="260">
          <template #default="{ row }">
            <span v-if="row.needsReview" class="review-tag">待复核</span>
            <span>{{ row.title }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="questionCount" label="题数" width="70" />
        <el-table-column prop="level" label="等级" width="70">
          <template #default="{ row }">{{ row.level || '—' }}</template>
        </el-table-column>
        <el-table-column label="主题" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ topicName(row.topic) || '—' }}</template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.source || '—' }}</template>
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
    <el-dialog v-model="dlg.open" :title="dlg.id ? '编辑文章' : '新增文章'" width="720px"
               :close-on-click-modal="false">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="文章标题（重复标题会被拒绝）" />
        </el-form-item>
        <el-form-item label="正文" prop="text">
          <el-input v-model="form.text" type="textarea" :rows="8"
                    placeholder="粘贴文章原文，保留段落换行" />
          <div class="tip muted">字数自动按英文单词统计（当前约 {{ formWordCount }} 词）</div>
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="等级">
              <el-select v-model="form.level" placeholder="不限" clearable style="width: 100%">
                <el-option value="KET" label="KET" />
                <el-option value="PET" label="PET" />
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
          <el-input v-model="form.tags" placeholder="逗号分隔，如 记叙文,常考" />
        </el-form-item>
        <el-form-item label="来源">
          <el-input v-model="form.source" placeholder="如 真题 / 教材单元，选填" />
        </el-form-item>

        <el-divider content-position="left">题目（{{ form.questions.length }} 道）</el-divider>
        <div v-for="(q, i) in form.questions" :key="i" class="q-edit">
          <div class="q-head">
            <b>第 {{ i + 1 }} 题</b>
            <el-button size="small" text type="danger" :disabled="form.questions.length <= 1"
                       @click="removeQuestion(i)">移除</el-button>
          </div>
          <el-input v-model="q.stem" placeholder="题干，如 What is the passage mainly about?" />
          <div class="opt-grid">
            <div v-for="(o, oi) in q.options" :key="oi" class="opt-line">
              <el-radio v-model="q.answerIndex" :value="oi">{{ 'ABCD'[oi] }}</el-radio>
              <el-input v-model="q.options[oi]" :placeholder="`选项 ${'ABCD'[oi]}`" />
            </div>
          </div>
          <div class="tip muted">点左侧单选按钮标记正确答案</div>
          <el-input v-model="q.explain" placeholder="解析（可选，判分后展示给学生）" />
        </div>
        <el-button style="width: 100%" @click="addQuestion">＋ 添加题目</el-button>
      </el-form>
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button type="primary" :loading="dlg.saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入 -->
    <el-dialog v-model="imp.open" title="导入阅读理解题库" width="780px" :close-on-click-modal="false">
      <div class="tip muted" style="margin-bottom: 10px">
        一行一题：同一「标题」的多行会合并为一篇文章，正文只需填在该篇第一行。
      </div>
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
          <el-descriptions-item label="将新增">{{ imp.preview.stats.inserted ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="将更新">{{ imp.preview.stats.updated ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="将跳过">{{ imp.preview.stats.skipped ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="题目数">{{ imp.preview.stats.questions ?? 0 }}</el-descriptions-item>
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
            <el-table-column prop="title" label="标题" width="160" show-overflow-tooltip />
            <el-table-column prop="field" label="字段" width="100" />
            <el-table-column prop="message" label="信息" min-width="220" show-overflow-tooltip />
          </el-table>
        </template>

        <h4>文章预览（前 {{ Math.min(imp.preview.rows.length, 30) }} / {{ imp.preview.rows.length }} 篇）</h4>
        <el-collapse class="imp-rows">
          <el-collapse-item v-for="(r, i) in imp.preview.rows.slice(0, 30)" :key="i" :name="i">
            <template #title>
              <span class="imp-p-title">{{ r.title }}</span>
              <span class="muted">
                {{ r.level || '—' }} · {{ r.topic || '未分类' }} · {{ (r.questions || []).length }} 题 · 约 {{ r.wordCount }} 词
              </span>
            </template>
            <div v-for="(q, qi) in r.questions" :key="qi" class="imp-q">
              <div><b>{{ qi + 1 }}.</b> {{ q.stem }}</div>
              <div class="imp-opts">
                <span v-for="(o, oi) in q.options" :key="oi" :class="{ 'imp-ans': oi === q.answerIndex }">
                  {{ 'ABCD'[oi] }}. {{ o }}
                </span>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
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
    const d = await api.get(`/api/reading/passages${qs({
      q: filters.q, level: filters.level, topic: filters.topic,
      needs: filters.needs, page: page.value, size,
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
  title: '', text: '', level: '', topic: '', tags: '', source: '',
  needsReview: false, questions: [],
});
const rules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  text: [{ required: true, message: '请输入正文', trigger: 'blur' }],
};
const formTopics = computed(() =>
  form.level && topicsByLevel.value[form.level] ? topicsByLevel.value[form.level] : allTopics.value
);
const formWordCount = computed(() =>
  (form.text || '').match(/[A-Za-z][A-Za-z'-]*/g)?.length || 0);

function blankQuestion() {
  return { stem: '', options: ['', '', '', ''], answerIndex: 0, explain: '' };
}

function resetForm() {
  Object.assign(form, {
    title: '', text: '', level: '', topic: '', tags: '', source: '',
    needsReview: false, questions: [blankQuestion()],
  });
}

function openCreate() {
  dlg.id = null;
  resetForm();
  dlg.open = true;
}

async function openEdit(row) {
  try {
    const d = await api.get(`/api/reading/passages/${row.id}`);
    dlg.id = d.id;
    Object.assign(form, {
      title: d.title || '', text: d.text || '', level: d.level || '', topic: d.topic || '',
      tags: d.tags || '', source: d.source || '', needsReview: !!d.needsReview,
      questions: (d.questions || []).map(q => ({
        stem: q.stem || '',
        options: [...(q.options || ['', '', '', ''])],
        answerIndex: q.answerIndex ?? 0,
        explain: q.explain || '',
      })),
    });
    if (!form.questions.length) form.questions = [blankQuestion()];
    dlg.open = true;
  } catch { /* 已提示 */ }
}

function addQuestion() {
  form.questions.push(blankQuestion());
}

function removeQuestion(i) {
  if (form.questions.length > 1) form.questions.splice(i, 1);
}

function validateQuestions() {
  if (!form.questions.length) return '至少需要一道题';
  for (let i = 0; i < form.questions.length; i++) {
    const q = form.questions[i];
    if (!String(q.stem || '').trim()) return `第 ${i + 1} 题题干为空`;
    if (q.options.length !== 4 || q.options.some(o => !String(o || '').trim())) {
      return `第 ${i + 1} 题需要 4 个非空选项`;
    }
  }
  return null;
}

async function save() {
  await formRef.value.validate();
  const err = validateQuestions();
  if (err) return ElMessage.warning(err);
  const body = {
    title: form.title.trim(),
    text: form.text,
    level: form.level || '',
    topic: form.topic || '',
    tags: form.tags || '',
    source: form.source || '',
    needsReview: form.needsReview,
    questions: form.questions.map((q, i) => ({
      seq: i + 1,
      stem: q.stem.trim(),
      options: q.options.map(o => String(o).trim()),
      answerIndex: q.answerIndex,
      explain: q.explain || '',
    })),
  };
  dlg.saving = true;
  try {
    if (dlg.id) await api.put(`/api/reading/passages/${dlg.id}`, body);
    else await api.post('/api/reading/passages', body);
    ElMessage.success(dlg.id ? '已保存' : '已新增');
    dlg.open = false;
    load();
  } catch { /* 已提示（含「同标题的文章已存在」） */ } finally {
    dlg.saving = false;
  }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确定删除文章「${row.title}」及其 ${row.questionCount} 道题目吗？`, '删除', { type: 'warning' });
  } catch { return; }
  try {
    await api.del(`/api/reading/passages/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch { /* 已提示 */ }
}

async function batchDelete() {
  const ids = selection.value.map(r => r.id);
  if (!ids.length) return;
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 篇文章吗？其题目会一并删除。`, '批量删除', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post('/api/reading/passages/batch-delete', { ids });
    ElMessage.success(`已删除 ${d.deleted} 篇`);
    load();
  } catch { /* 已提示 */ }
}

/* ── 模板 / 导出 / 导入 ── */
function downloadTemplate() {
  download('/api/reading/template', '阅读理解导入模板.xlsx');
}
function exportXlsx() {
  download('/api/reading/export.xlsx', '阅读理解题库.xlsx');
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
    imp.preview = await api.upload('/api/reading/import', buildFormData('1'));
  } catch { /* 已提示 */ } finally {
    imp.previewing = false;
  }
}

async function commit() {
  imp.committing = true;
  try {
    const d = await api.upload('/api/reading/import', buildFormData('0'));
    const s = d.stats || {};
    ElMessage.success(`导入完成：新增 ${s.inserted ?? 0} 篇，更新 ${s.updated ?? 0} 篇，跳过 ${s.skipped ?? 0} 篇，共 ${s.questions ?? 0} 题`);
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
.q-edit {
  border: 1px solid #e4e7ed; border-radius: 8px; padding: 12px; margin-bottom: 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.q-head { display: flex; align-items: center; justify-content: space-between; }
.opt-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
.opt-line { display: flex; align-items: center; gap: 6px; }
.opt-line .el-radio { width: 44px; margin-right: 0; }
.imp-stats { margin: 12px 0; }
.imp-stats .err { color: #f56c6c; font-weight: 700; }
.imp-stats .warn { color: #e6a23c; font-weight: 700; }
h4 { margin: 14px 0 8px; }
:deep(.row-err) { color: #f56c6c; }
:deep(.row-warn) { color: #e6a23c; }
.imp-rows { max-height: 320px; overflow-y: auto; }
.imp-p-title { font-weight: 600; margin-right: 10px; }
.imp-q { padding: 6px 8px; border-bottom: 1px dashed #ebeef5; font-size: 13px; }
.imp-opts { display: flex; flex-wrap: wrap; gap: 4px 16px; color: #606266; margin-top: 2px; }
.imp-opts .imp-ans { color: #529b2e; font-weight: 700; }
</style>
