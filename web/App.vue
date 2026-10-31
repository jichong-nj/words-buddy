<template>
  <router-view v-if="!auth.user" />

  <el-container v-else class="layout">
    <el-aside width="210px" class="aside">
      <div class="logo">📚 单词助手</div>
      <el-menu :default-active="activeMenu" router class="menu">
        <el-menu-item index="/banks">词库</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/batches">导入批次</el-menu-item>
        <el-menu-item index="/practice">释义填空</el-menu-item>
        <el-menu-item index="/transform">变形填空</el-menu-item>
        <el-menu-item index="/reading">阅读理解</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/transform/bank">变形题库</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/reading/bank">阅读理解题库</el-menu-item>
        <el-menu-item index="/records">练习记录</el-menu-item>
        <el-menu-item index="/mistakes">错题集</el-menu-item>
        <el-menu-item index="/stats">学习统计</el-menu-item>
        <el-menu-item v-if="auth.isAdmin" index="/users">用户管理</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header" height="52px">
        <div class="flex1"></div>
        <el-tag
          v-if="auth.user.mustChangePw"
          type="warning"
          class="pw-tip"
          @click="pwDialog = true"
        >
          ⚠ 请先修改初始密码
        </el-tag>
        <span class="username">{{ auth.user.displayName || auth.user.username }}</span>
        <el-button link type="primary" @click="openPwDialog">改密码</el-button>
        <el-button link type="danger" @click="onLogout">退出</el-button>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>

  <el-dialog
    v-model="pwDialog"
    title="修改密码"
    width="420px"
    :close-on-click-modal="false"
    :close-on-press-escape="!auth.user || !auth.user.mustChangePw"
    :show-close="!auth.user || !auth.user.mustChangePw"
    append-to-body
  >
    <el-form ref="pwFormRef" :model="pwForm" :rules="pwRules" label-width="90px">
      <el-form-item label="当前密码" prop="oldPassword">
        <el-input v-model="pwForm.oldPassword" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码" prop="newPassword">
        <el-input v-model="pwForm.newPassword" type="password" show-password placeholder="至少 4 位" />
      </el-form-item>
      <el-form-item label="确认新密码" prop="confirm">
        <el-input v-model="pwForm.confirm" type="password" show-password />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button v-if="!auth.user || !auth.user.mustChangePw" @click="pwDialog = false">取消</el-button>
      <el-button type="primary" :loading="pwSaving" @click="submitPw">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from './api';
import { useAuth } from './store';

const auth = useAuth();
const route = useRoute();
const router = useRouter();

const activeMenu = computed(() => {
  const p = route.path;
  for (const m of ['/banks', '/batches', '/practice', '/transform/bank', '/transform', '/reading/bank', '/reading', '/mistakes', '/records', '/stats', '/users']) {
    if (p === m || p.startsWith(m + '/')) return m;
  }
  return p;
});

const pwDialog = ref(false);
const pwSaving = ref(false);
const pwFormRef = ref(null);
const pwForm = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const pwRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 4, message: '密码至少 4 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        value === pwForm.newPassword ? cb() : cb(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
};

function openPwDialog() {
  pwForm.oldPassword = '';
  pwForm.newPassword = '';
  pwForm.confirm = '';
  pwDialog.value = true;
}

// 强制改密：登录后自动弹出
watch(
  () => auth.user && auth.user.mustChangePw,
  (v) => {
    if (v) openPwDialog();
  },
  { immediate: true }
);

async function submitPw() {
  await pwFormRef.value.validate();
  pwSaving.value = true;
  try {
    await api.post('/api/auth/change-password', {
      oldPassword: pwForm.oldPassword,
      newPassword: pwForm.newPassword,
    });
    ElMessage.success('密码已修改');
    if (auth.user) auth.user.mustChangePw = false;
    pwDialog.value = false;
  } catch (e) {
    /* api 已提示 */
  } finally {
    pwSaving.value = false;
  }
}

async function onLogout() {
  try {
    await ElMessageBox.confirm('确定要退出登录吗？', '退出', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    });
  } catch (e) {
    return;
  }
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.layout {
  height: 100%;
}

.aside {
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.logo {
  height: 52px;
  line-height: 52px;
  text-align: center;
  font-weight: 700;
  font-size: 17px;
  border-bottom: 1px solid #ebeef5;
}

.menu {
  border-right: none;
  flex: 1;
}

.header {
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pw-tip {
  cursor: pointer;
}

.username {
  font-weight: 600;
}

.main {
  padding: 16px 20px;
  overflow-y: auto;
}
</style>
