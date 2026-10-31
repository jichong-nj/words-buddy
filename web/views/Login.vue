<template>
  <div class="auth-wrap">
    <el-card class="auth-card" shadow="always">
      <div class="brand">📚 单词助手</div>
      <div class="sub">Words Buddy · 一起快乐背单词</div>

      <el-alert
        v-if="auth.needsSetup"
        type="info"
        :closable="false"
        class="setup-alert"
      >
        系统还没有账号，
        <el-link type="primary" @click="$router.push('/setup')">点击这里完成初始化</el-link>
      </el-alert>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="submit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" clearable />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="form.remember">记住我（30 天免登录）</el-checkbox>
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
    </el-card>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useAuth } from '../store';

const auth = useAuth();
const router = useRouter();

const formRef = ref(null);
const loading = ref(false);
const form = reactive({ username: '', password: '', remember: true });
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

async function submit() {
  try {
    await formRef.value.validate();
  } catch (e) {
    return;
  }
  loading.value = true;
  try {
    await auth.login({
      username: form.username.trim(),
      password: form.password,
      remember: !!form.remember,
    });
    ElMessage.success('登录成功');
    router.push('/banks');
  } catch (e) {
    /* api 已提示错误 */
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #6a8dff 0%, #43c6ac 100%);
}

.auth-card {
  width: 380px;
  padding: 10px 14px 20px;
}

.brand {
  text-align: center;
  font-size: 26px;
  font-weight: 700;
  margin-top: 8px;
}

.sub {
  text-align: center;
  color: #909399;
  margin: 6px 0 18px;
}

.setup-alert {
  margin-bottom: 14px;
}

.submit {
  width: 100%;
}
</style>
