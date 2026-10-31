<template>
  <div v-loading="loading">
    <div class="page-head">
      <div>
        <h2 class="page-title">用户管理</h2>
        <div class="meta">管理员可创建学生账号、重置密码、停用账号</div>
      </div>
      <div class="actions">
        <el-button type="primary" @click="openCreate">新建用户</el-button>
      </div>
    </div>

    <el-card shadow="never">
      <el-table :data="items" empty-text="没有用户">
        <el-table-column prop="id" label="#" width="60" />
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="displayName" label="昵称" min-width="120">
          <template #default="{ row }">{{ row.displayName || '—' }}</template>
        </el-table-column>
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'primary'" size="small">
              {{ row.role === 'admin' ? '管理员' : '学生' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '正常' : '已停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="需改密码" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.mustChangePw" type="warning" size="small">是</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="lastLoginAt" label="最近登录" width="160">
          <template #default="{ row }">{{ row.lastLoginAt || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="250" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" text @click="resetPw(row)">重置密码</el-button>
            <el-button size="small" text :type="row.status === 'active' ? 'warning' : 'success'"
                       @click="toggleStatus(row)">
              {{ row.status === 'active' ? '停用' : '启用' }}
            </el-button>
            <el-button size="small" text type="danger" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialog" :title="editing ? '编辑用户' : '新建用户'" width="440px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="!!editing" placeholder="登录账号" />
        </el-form-item>
        <el-form-item label="昵称">
          <el-input v-model="form.displayName" placeholder="显示名称，可留空" />
        </el-form-item>
        <el-form-item v-if="!editing" label="初始密码" required>
          <el-input v-model="form.password" type="password" show-password placeholder="至少 4 位" />
        </el-form-item>
        <el-form-item label="角色">
          <el-radio-group v-model="form.role">
            <el-radio value="student">学生</el-radio>
            <el-radio value="admin">管理员</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="editing" label="强制改密">
          <el-switch v-model="form.mustChangePw" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api.js';

const loading = ref(false);
const items = ref([]);

async function load() {
  loading.value = true;
  try {
    const d = await api.get('/api/users');
    items.value = d.items || [];
  } catch {
    items.value = [];
  } finally {
    loading.value = false;
  }
}

const dialog = ref(false);
const saving = ref(false);
const editing = ref(null);
const form = reactive({ username: '', displayName: '', password: '', role: 'student', mustChangePw: false });

function openCreate() {
  editing.value = null;
  Object.assign(form, { username: '', displayName: '', password: '', role: 'student', mustChangePw: false });
  dialog.value = true;
}

function openEdit(row) {
  editing.value = row;
  Object.assign(form, {
    username: row.username, displayName: row.displayName || '', password: '',
    role: row.role, mustChangePw: !!row.mustChangePw,
  });
  dialog.value = true;
}

async function save() {
  if (!form.username.trim()) return ElMessage.warning('请填写用户名');
  if (!editing.value && (form.password || '').length < 4) return ElMessage.warning('密码至少 4 位');
  saving.value = true;
  try {
    if (editing.value) {
      await api.patch(`/api/users/${editing.value.id}`, {
        displayName: form.displayName, role: form.role, mustChangePw: form.mustChangePw,
      });
      ElMessage.success('已保存');
    } else {
      await api.post('/api/users', {
        username: form.username.trim(), password: form.password,
        displayName: form.displayName, role: form.role,
      });
      ElMessage.success('已创建');
    }
    dialog.value = false;
    load();
  } catch { /* 已提示 */ } finally {
    saving.value = false;
  }
}

async function resetPw(row) {
  let value;
  try {
    ({ value } = await ElMessageBox.prompt(`为「${row.username}」设置新密码（至少 4 位）`, '重置密码', {
      inputValidator: v => (v && v.length >= 4 ? true : '密码至少 4 位'),
    }));
  } catch { return; }
  try {
    await api.patch(`/api/users/${row.id}`, { password: value, mustChangePw: true });
    ElMessage.success('密码已重置，该用户下次登录需修改密码');
    load();
  } catch { /* 已提示 */ }
}

async function toggleStatus(row) {
  const next = row.status === 'active' ? 'disabled' : 'active';
  try {
    await api.patch(`/api/users/${row.id}`, { status: next });
    ElMessage.success(next === 'active' ? '已启用' : '已停用');
    load();
  } catch { /* 已提示 */ }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除用户「${row.username}」吗？有学习记录的用户无法删除，建议改为「停用」。`,
      '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await api.del(`/api/users/${row.id}`);
    ElMessage.success('已删除');
    load();
  } catch { /* 已提示（含 409 说明） */ }
}

onMounted(load);
</script>
