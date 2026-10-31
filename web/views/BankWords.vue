<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">
          {{ bank ? bank.name : '词库' }}
          <el-tag v-if="bank && bank.level" size="small" effect="plain">{{ bank.level }}</el-tag>
        </h2>
        <div class="meta" v-if="bank">
          共 {{ bank.wordCount }} 个单词 · {{ bank.senseCount }} 个义项 ·
          {{ bank.defEnCount }} 个英文释义
          <template v-if="bank.description"> · {{ bank.description }}</template>
        </div>
      </div>
      <div class="actions">
        <el-button v-if="auth.isAdmin" type="primary" @click="openCreate">新建单词</el-button>
        <el-button v-if="auth.isAdmin" @click="$router.push(`/banks/${bankId}/import`)">导入</el-button>
        <el-button v-if="auth.isAdmin" @click="exportBank">导出 Excel</el-button>
      </div>
    </div>

    <el-card shadow="never" class="filter-card">
      <el-form inline @submit.prevent>
        <el-form-item>
          <el-input v-model="filters.q" placeholder="搜索单词 / 释义" clearable style="width: 220px"
                    @keyup.enter="reload" @clear="reload" />
        </el-form-item>
        <el-form-item>
          <el-select v-model="filters.topic" placeholder="主题" clearable filterable
                     :allow-create="!topicTaxonomy" default-first-option style="width: 200px"
                     @change="reload">
            <el-option v-for="t in topics" :key="t.key" :value="t.key"
                       :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-select v-model="filters.tag" placeholder="标签" clearable filterable allow-create
                     default-first-option style="width: 160px" @change="reload">
            <el-option v-for="t in tags" :key="t.tag" :value="t.tag" :label="`${t.tag}（${t.count}）`" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="auth.isAdmin">
          <el-switch v-model="filters.needs" active-text="只看待完善" @change="reload" />
        </el-form-item>
        <el-form-item>
          <el-button @click="reload">查询</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never">
      <div v-if="auth.isAdmin && selection.length" class="batch-bar">
        已选 {{ selection.length }} 个
        <el-button size="small" @click="openBatchTag">批量打标签</el-button>
        <el-button size="small" type="danger" @click="batchDelete">批量删除</el-button>
        <el-button size="small" text @click="tableRef && tableRef.clearSelection()">取消选择</el-button>
      </div>

      <el-table ref="tableRef" :data="items" row-key="id" @selection-change="s => selection = s"
                empty-text="没有符合条件的单词">
        <el-table-column v-if="auth.isAdmin" type="selection" width="42" reserve-selection />
        <el-table-column label="单词" min-width="180">
          <template #default="{ row }">
            <b>{{ row.word }}</b>
            <el-tag v-if="row.senseCount > 1" size="small" effect="plain" class="mini-tag">
              {{ row.senseCount }} 义项
            </el-tag>
            <el-tag v-if="row.needsReview" size="small" type="warning" class="mini-tag">待完善</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="phoneticUk" label="音标" width="130">
          <template #default="{ row }"><span class="mono">{{ row.phoneticUk || '—' }}</span></template>
        </el-table-column>
        <el-table-column label="词性" width="110">
          <template #default="{ row }">
            {{ (row.posList && row.posList.length ? row.posList.join('/') : row.mainPos) || '—' }}
          </template>
        </el-table-column>
        <el-table-column prop="mainDef" label="中文释义" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mainDef || '—' }}</template>
        </el-table-column>
        <el-table-column prop="mainDefEn" label="英文释义" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.mainDefEn || '—' }}</template>
        </el-table-column>
        <el-table-column label="主题" width="120">
          <template #default="{ row }">{{ topicName(row.topic) }}</template>
        </el-table-column>
        <el-table-column v-if="auth.isAdmin" label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text type="danger" @click="removeWord(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination class="pager" layout="total, sizes, prev, pager, next" :total="total"
                     v-model:current-page="page" v-model:page-size="size" :page-sizes="[20, 50, 100]"
                     @current-change="load" @size-change="page = 1; load()" />
    </el-card>

    <el-drawer v-model="drawer" :title="editing ? '编辑单词' : '新建单词'" size="640px" destroy-on-close>
      <el-form :model="form" label-width="80px" v-loading="drawerLoading">
        <el-form-item label="单词" required>
          <el-input v-model="form.word" placeholder="如 picture" />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="英式音标">
              <el-input v-model="form.phoneticUk" placeholder="/ˈpɪktʃə(r)/" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="美式音标">
              <el-input v-model="form.phoneticUs" placeholder="/ˈpɪktʃər/" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="主题">
              <el-select v-model="form.topic" placeholder="选择或输入主题" clearable filterable
                         :allow-create="!topicTaxonomy" default-first-option style="width: 100%">
                <el-option v-for="t in topics" :key="t.key" :value="t.key"
                           :label="t.cn ? `${t.cn}（${t.key}）` : t.key" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="等级">
              <el-select v-model="form.level" placeholder="可留空" clearable filterable allow-create
                         default-first-option style="width: 100%">
                <el-option v-for="l in ['KET', 'PET', 'FCE', '校内']" :key="l" :value="l" :label="l" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="标签">
          <el-input v-model="form.tags" placeholder="逗号分隔，如：高频,真题" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.notes" type="textarea" :rows="2" />
        </el-form-item>

        <el-divider>义项（第一条为主义项，练习出题用第一条的英文释义）</el-divider>
        <div v-for="(s, i) in form.senses" :key="i" class="sense-row">
          <div class="sense-head">
            <span class="sense-no">{{ i === 0 ? '主义项' : `义项 ${i + 1}` }}</span>
            <span class="flex1"></span>
            <el-button size="small" text :disabled="i === 0" @click="moveSense(i, -1)">上移</el-button>
            <el-button size="small" text :disabled="i === form.senses.length - 1" @click="moveSense(i, 1)">下移</el-button>
            <el-button size="small" text type="danger" :disabled="form.senses.length <= 1"
                       @click="form.senses.splice(i, 1)">删除</el-button>
          </div>
          <el-row :gutter="8">
            <el-col :span="7">
              <el-select v-model="s.pos" placeholder="词性" clearable filterable allow-create
                         default-first-option style="width: 100%">
                <el-option v-for="p in POS_OPTIONS" :key="p" :value="p" :label="p" />
              </el-select>
            </el-col>
            <el-col :span="17">
              <el-input v-model="s.defCn" placeholder="中文释义，如：n. 图片；照片" />
            </el-col>
          </el-row>
          <el-input v-model="s.defEn" placeholder="英文释义（练习出题依据），如：a drawing or photograph"
                    class="sense-gap" />
          <el-input v-model="s.exampleEn" placeholder="英文例句，如：Take a picture of the cat." class="sense-gap" />
          <el-input v-model="s.exampleCn" placeholder="例句中文翻译，如：给猫拍张照片。" class="sense-gap" />
        </div>
        <el-button style="width: 100%" @click="addSense">+ 添加义项</el-button>

        <div class="drawer-footer">
          <el-button @click="drawer = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">保存</el-button>
        </div>
      </el-form>
    </el-drawer>

    <el-dialog v-model="tagDialog" title="批量打标签" width="420px">
      <el-select v-model="tagAdd" multiple filterable allow-create default-first-option
                 placeholder="选择或输入要添加的标签" style="width: 100%">
        <el-option v-for="t in tags" :key="t.tag" :value="t.tag" :label="`${t.tag}（${t.count}）`" />
      </el-select>
      <template #footer>
        <el-button @click="tagDialog = false">取消</el-button>
        <el-button type="primary" :loading="tagSaving" @click="doBatchTag">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, download } from '../api.js';
import { useAuth } from '../store.js';
import { POS_OPTIONS, qs } from '../utils.js';

const route = useRoute();
const auth = useAuth();
const bankId = Number(route.params.id);

const loading = ref(false);
const bank = ref(null);
const items = ref([]);
const total = ref(0);
const page = ref(1);
const size = ref(20);
const selection = ref([]);
const tableRef = ref(null);

const topics = ref([]);
const tags = ref([]);
const topicTaxonomy = ref(true);

const filters = reactive({ q: '', topic: '', tag: '', needs: false });

const topicMap = computed(() => Object.fromEntries(topics.value.map(t => [t.key, t.cn])));
function topicName(key) {
  if (!key) return '—';
  return topicMap.value[key] ? `${topicMap.value[key]}` : key;
}

async function loadMeta() {
  try {
    const d = await api.get(`/api/meta/topics?bank=${bankId}`);
    topics.value = d.items || [];
    topicTaxonomy.value = !(d.taxonomy === false);
  } catch { /* 已提示 */ }
  try {
    const d = await api.get(`/api/meta/tags?bank=${bankId}`);
    tags.value = d.items || [];
  } catch { /* 已提示 */ }
}

async function loadBank() {
  try {
    const d = await api.get(`/api/banks/${bankId}`);
    bank.value = d.bank || d;
  } catch { /* 已提示 */ }
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/banks/${bankId}/words${qs({
      q: filters.q.trim(), topic: filters.topic, tag: filters.tag,
      needs: auth.isAdmin && filters.needs ? 1 : '',
      page: page.value, size: size.value,
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

function exportBank() {
  download(`/api/banks/${bankId}/export.xlsx`, `${(bank.value && bank.value.name) || '词库'}.xlsx`);
}

/* ---------- 编辑抽屉 ---------- */
const drawer = ref(false);
const drawerLoading = ref(false);
const saving = ref(false);
const editing = ref(null); // 编辑时存单词 id
const form = reactive({
  word: '', phoneticUk: '', phoneticUs: '', topic: '', tags: '', level: '', notes: '',
  senses: [],
});

function emptySense() {
  return { pos: '', defCn: '', defEn: '', exampleEn: '', exampleCn: '' };
}
function addSense() {
  form.senses.push(emptySense());
}
function moveSense(i, dir) {
  const j = i + dir;
  const arr = form.senses;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

function resetForm(data) {
  Object.assign(form, {
    word: '', phoneticUk: '', phoneticUs: '', topic: '', tags: '', level: '', notes: '',
    senses: [emptySense()],
  }, data || {});
  if (!form.senses.length) form.senses.push(emptySense());
}

function openCreate() {
  editing.value = null;
  resetForm();
  drawer.value = true;
}

async function openEdit(row) {
  editing.value = row.id;
  resetForm();
  drawer.value = true;
  drawerLoading.value = true;
  try {
    const d = await api.get(`/api/words/${row.id}`);
    const w = d.word || d;
    const senses = (d.senses || w.senses || []).map(s => ({
      pos: s.pos || '', defCn: s.defCn || '', defEn: s.defEn || '',
      exampleEn: s.exampleEn || '', exampleCn: s.exampleCn || '',
    }));
    resetForm({
      word: w.word || '', phoneticUk: w.phoneticUk || '', phoneticUs: w.phoneticUs || '',
      topic: w.topic || '', tags: w.tags || '', level: w.level || '', notes: w.notes || '',
      senses,
    });
  } catch {
    drawer.value = false;
  } finally {
    drawerLoading.value = false;
  }
}

async function save() {
  if (!form.word.trim()) return ElMessage.warning('请填写单词');
  const senses = form.senses
    .map(s => ({
      pos: s.pos.trim(), defCn: s.defCn.trim(), defEn: s.defEn.trim(),
      exampleEn: s.exampleEn.trim(), exampleCn: s.exampleCn.trim(),
    }))
    .filter(s => s.pos || s.defCn || s.defEn || s.exampleEn || s.exampleCn)
    .map((s, i) => ({ ...s, sort: i + 1 }));
  const body = {
    word: form.word.trim(), phoneticUk: form.phoneticUk.trim(), phoneticUs: form.phoneticUs.trim(),
    topic: form.topic, tags: form.tags, level: form.level, notes: form.notes, senses,
  };
  saving.value = true;
  try {
    if (editing.value) {
      await api.put(`/api/words/${editing.value}`, body);
      ElMessage.success('已保存');
    } else {
      await api.post(`/api/banks/${bankId}/words`, body);
      ElMessage.success('已添加');
    }
    drawer.value = false;
    load();
    loadBank();
    loadMeta();
  } catch { /* 已提示 */ } finally {
    saving.value = false;
  }
}

/* ---------- 删除 / 批量 ---------- */
async function removeWord(row) {
  try {
    await ElMessageBox.confirm(`确定删除单词「${row.word}」吗？`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await api.del(`/api/words/${row.id}`);
    ElMessage.success('已删除');
    load();
    loadBank();
  } catch { /* 已提示 */ }
}

async function batchDelete() {
  const ids = selection.value.map(r => r.id);
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${ids.length} 个单词吗？`, '批量删除', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post(`/api/banks/${bankId}/words/batch-delete`, { ids });
    ElMessage.success(`已删除 ${d.deleted} 个${d.skipped ? `，${d.skipped} 个因有练习记录被跳过` : ''}`);
    tableRef.value && tableRef.value.clearSelection();
    load();
    loadBank();
  } catch { /* 已提示 */ }
}

const tagDialog = ref(false);
const tagAdd = ref([]);
const tagSaving = ref(false);
function openBatchTag() {
  tagAdd.value = [];
  tagDialog.value = true;
}
async function doBatchTag() {
  if (!tagAdd.value.length) return ElMessage.warning('请选择或输入标签');
  tagSaving.value = true;
  try {
    const d = await api.post(`/api/banks/${bankId}/words/batch-tag`, {
      ids: selection.value.map(r => r.id), add: tagAdd.value, remove: [],
    });
    ElMessage.success(`已更新 ${d.updated} 个单词的标签`);
    tagDialog.value = false;
    tableRef.value && tableRef.value.clearSelection();
    load();
    loadMeta();
  } catch { /* 已提示 */ } finally {
    tagSaving.value = false;
  }
}

onMounted(() => {
  loadBank();
  loadMeta();
  load();
});
</script>

<style scoped>
.batch-bar {
  margin-bottom: 10px;
  padding: 8px 12px;
  background: #ecf5ff;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.mini-tag { margin-left: 6px; }
.sense-row {
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 12px;
}
.sense-head { display: flex; align-items: center; margin-bottom: 8px; }
.sense-no { font-weight: 600; color: #409eff; }
.sense-gap { margin-top: 8px; }
.drawer-footer { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; }
</style>
