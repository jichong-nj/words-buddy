<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2>词库</h2>
        <span class="meta">共 {{ banks.length }} 个词库</span>
      </div>
      <div class="actions" v-if="auth.isAdmin">
        <el-button type="primary" @click="openCreate">新建词库</el-button>
      </div>
    </div>

    <el-empty v-if="!loading && !banks.length" description="还没有词库，先创建一个吧">
      <el-button v-if="auth.isAdmin" type="primary" @click="openCreate">新建词库</el-button>
    </el-empty>

    <el-row :gutter="14">
      <el-col v-for="b in banks" :key="b.id" :xs="24" :sm="12" :md="8" :lg="6" class="col">
        <el-card class="bank-card" shadow="hover" @click="go(b)">
          <div class="title-row">
            <span class="name">{{ b.name }}</span>
            <el-tag v-if="b.level" size="small" effect="plain">{{ b.level }}</el-tag>
            <el-tag v-if="b.status === 'archived'" size="small" type="info">已归档</el-tag>
          </div>
          <div class="desc">{{ b.description || '暂无描述' }}</div>
          <div class="stats">
            <span>单词 <b>{{ b.wordCount ?? 0 }}</b></span>
            <span>义项 <b>{{ b.senseCount ?? 0 }}</b></span>
            <span>英文释义 <b>{{ b.defEnCount ?? 0 }}</b></span>
          </div>
          <div class="foot">
            <span class="muted">更新于 {{ b.updatedAt || '—' }}</span>
            <el-tag v-if="b.practiceable" size="small" type="success" effect="plain">可练习</el-tag>
          </div>
          <div v-if="auth.isAdmin" class="ops" @click.stop>
            <el-button size="small" type="primary" plain @click="goImport(b)">导入</el-button>
            <el-button size="small" plain @click="exportBank(b)">导出</el-button>
            <el-button size="small" type="danger" plain @click="removeBank(b)">删除</el-button>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="createDialog" title="新建词库" width="460px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="比如：KET 核心词汇" />
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="form.level" filterable allow-create default-first-option placeholder="可留空或自定义" clearable style="width: 100%">
            <el-option v-for="l in ['KET', 'PET', 'FCE', '校内']" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="这个词库是干什么用的（可留空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="createBank">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, download } from '../api';
import { useAuth } from '../store';

const auth = useAuth();
const router = useRouter();

const banks = ref([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/api/banks');
    banks.value = d.items || [];
  } catch (e) {
    /* api 已提示 */
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function go(b) {
  router.push(`/banks/${b.id}`);
}
function goImport(b) {
  router.push(`/banks/${b.id}/import`);
}
function exportBank(b) {
  download(`/api/banks/${b.id}/export.xlsx`, `${b.name}.xlsx`);
}

async function removeBank(b) {
  let value;
  try {
    const r = await ElMessageBox.prompt(
      `删除后词库里的单词会一起消失，且无法恢复。请输入词库名称「${b.name}」确认：`,
      `删除词库「${b.name}」`,
      {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning',
        inputValidator: (v) => (v === b.name ? true : '输入的名称不对'),
      }
    );
    value = r.value;
  } catch (e) {
    return;
  }
  try {
    await api.del(`/api/banks/${b.id}`, { confirmName: value });
    ElMessage.success('词库已删除');
    load();
  } catch (e) {
    /* 409（有学习记录）等错误 api 已提示 */
  }
}

const createDialog = ref(false);
const saving = ref(false);
const formRef = ref(null);
const form = reactive({ name: '', level: '', description: '' });
const rules = {
  name: [{ required: true, message: '请输入词库名称', trigger: 'blur' }],
};

function openCreate() {
  form.name = '';
  form.level = '';
  form.description = '';
  createDialog.value = true;
}

async function createBank() {
  try {
    await formRef.value.validate();
  } catch (e) {
    return;
  }
  saving.value = true;
  try {
    const payload = { name: form.name.trim() };
    if (form.level) payload.level = form.level;
    if (form.description.trim()) payload.description = form.description.trim();
    await api.post('/api/banks', payload);
    ElMessage.success('词库已创建');
    createDialog.value = false;
    load();
  } catch (e) {
    /* api 已提示 */
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.col {
  margin-bottom: 14px;
}

.bank-card {
  cursor: pointer;
  height: 100%;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.name {
  font-size: 17px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desc {
  color: #606266;
  font-size: 13px;
  min-height: 34px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.stats {
  display: flex;
  gap: 14px;
  margin: 8px 0;
  font-size: 13px;
  color: #606266;
}

.stats b {
  color: #409eff;
}

.foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.ops {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed #ebeef5;
  display: flex;
  gap: 6px;
}
</style>
