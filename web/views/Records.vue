<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">练习记录</h2>
        <div class="meta">{{ auth.isAdmin ? '可查看词库维度的全部练习场次' : '我的每一次练习' }}</div>
      </div>
      <div class="actions">
        <el-select v-model="bankFilter" placeholder="全部词库" clearable style="width: 200px" @change="reload">
          <el-option v-for="b in banks" :key="b.id" :value="b.id" :label="b.name" />
        </el-select>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="items" empty-text="还没有练习记录，去练一组吧">
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="modeTag(row.mode)" size="small" effect="plain">
              {{ modeLabel(row.mode) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="词库" min-width="140">
          <template #default="{ row }">
            {{ row.bankName || (row.mode === 'form_fill' ? '变形题库' : row.mode === 'reading' ? '阅读理解题库' : '—') }}
          </template>
        </el-table-column>
        <el-table-column v-if="auth.isAdmin" prop="username" label="用户" width="110" />
        <el-table-column label="得分" width="110">
          <template #default="{ row }">
            <b>{{ row.score }}</b>
            <span class="muted">（{{ row.correct }}/{{ row.total }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'finished' ? 'success' : 'info'" size="small">
              {{ row.status === 'finished' ? '已完成' : '进行中' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="startedAt" label="开始时间" width="160" />
        <el-table-column prop="finishedAt" label="结束时间" width="160">
          <template #default="{ row }">{{ row.finishedAt || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="$router.push(`/records/${row.id}`)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination class="pager" layout="total, prev, pager, next" :total="total"
                     v-model:current-page="page" :page-size="size" @current-change="load" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { useAuth } from '../store.js';
import { qs } from '../utils.js';

const auth = useAuth();
const loading = ref(false);
const items = ref([]);
const banks = ref([]);
const bankFilter = ref(null);
const page = ref(1);
const size = 20;
const total = ref(0);

function modeLabel(m) {
  return m === 'form_fill' ? '变形填空' : m === 'reading' ? '阅读理解' : '释义填空';
}
function modeTag(m) {
  return m === 'form_fill' ? 'warning' : m === 'reading' ? 'success' : 'primary';
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/practice/sessions${qs({ page: page.value, size, bank: bankFilter.value })}`);
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

onMounted(async () => {
  try {
    const d = await api.get('/api/banks');
    banks.value = d.items || [];
  } catch { /* 已提示 */ }
  load();
});
</script>
