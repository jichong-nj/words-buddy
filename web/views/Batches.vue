<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">导入批次</h2>
        <div class="meta">已提交的批次可回滚：删除本批新建的词，还原被覆盖的词</div>
      </div>
      <div class="actions">
        <el-select v-model="bankFilter" placeholder="全部词库" clearable style="width: 200px" @change="load">
          <el-option v-for="b in banks" :key="b.id" :value="b.id" :label="b.name" />
        </el-select>
        <el-button @click="load">刷新</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="items" empty-text="还没有导入记录">
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="filename" label="文件" min-width="200" show-overflow-tooltip />
        <el-table-column label="词库" width="140">
          <template #default="{ row }">{{ bankName(row.bankId) }}</template>
        </el-table-column>
        <el-table-column prop="totalRows" label="总行数" width="80" />
        <el-table-column prop="inserted" label="新增" width="70" />
        <el-table-column prop="updated" label="更新" width="70" />
        <el-table-column prop="skipped" label="跳过" width="70" />
        <el-table-column prop="failed" label="失败" width="70" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="上传时间" width="160" />
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="downloadErrors(row)">错误报告</el-button>
            <el-button v-if="row.status === 'committed'" size="small" text type="danger"
                       @click="rollback(row)">回滚</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, download } from '../api.js';
import { qs } from '../utils.js';

const loading = ref(false);
const items = ref([]);
const banks = ref([]);
const bankFilter = ref(null);

function statusLabel(s) {
  return { pending: '待提交', committed: '已提交', rolled_back: '已回滚', failed: '失败' }[s] || s;
}
function statusType(s) {
  return { pending: 'info', committed: 'success', rolled_back: 'warning', failed: 'danger' }[s] || 'info';
}
function bankName(id) {
  const b = banks.value.find(x => x.id === id);
  return b ? b.name : `#${id}`;
}

async function load() {
  loading.value = true;
  try {
    const d = await api.get(`/api/batches${qs({ bank: bankFilter.value })}`);
    items.value = d.items || [];
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}

function downloadErrors(row) {
  download(`/api/import/${row.id}/errors.xlsx`, `导入校验报告-批次${row.id}.xlsx`);
}

async function rollback(row) {
  try {
    await ElMessageBox.confirm(
      `回滚批次 #${row.id}「${row.filename}」：将删除本批新建的单词，并还原被覆盖的单词。确定吗？`,
      '回滚确认', { type: 'warning' });
  } catch { return; }
  try {
    const d = await api.post(`/api/import/${row.id}/rollback`);
    ElMessage.success(`回滚完成：删除 ${d.removed} 个，还原 ${d.restored} 个`);
    load();
  } catch { /* 已提示 */ }
}

onMounted(async () => {
  try {
    const d = await api.get('/api/banks');
    banks.value = d.items || [];
  } catch { /* 已提示 */ }
  load();
});
</script>
