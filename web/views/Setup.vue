<template>
  <div class="auth-wrap">
    <el-card class="auth-card" shadow="always">
      <div class="brand">📚 欢迎使用单词助手</div>
      <div class="sub">第一次使用，请先创建管理员账号</div>

      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px" size="large">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="登录用的账号名" />
        </el-form-item>
        <el-form-item label="显示名" prop="displayName">
          <el-input v-model="form.displayName" placeholder="比如：王老师（可留空）" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 4 位" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="form.confirm" type="password" show-password />
        </el-form-item>
        <el-button type="primary" class="submit" :loading="loading" @click="submit">
          创建并开始
        </el-button>
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
const form = reactive({ username: '', displayName: '', password: '', confirm: '' });
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 4, message: '密码至少 4 位', trigger: 'blur' },
  ],
  confirm: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        value === form.password ? cb() : cb(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
};

async function submit() {
  try {
    await formRef.value.validate();
  } catch (e) {
    return;
  }
  loading.value = true;
  try {
    const payload = {
      username: form.username.trim(),
      password: form.password,
    };
    if (form.displayName.trim()) payload.displayName = form.displayName.trim();
    await auth.setup(payload);
    ElMessage.success('初始化完成，欢迎！');
    router.push('/banks');
  } catch (e) {
    /* api 已提示 */
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
  width: 430px;
  padding: 10px 14px 20px;
}

.brand {
  text-align: center;
  font-size: 24px;
  font-weight: 700;
  margin-top: 8px;
}

.sub {
  text-align: center;
  color: #909399;
  margin: 6px 0 18px;
}

.submit {
  width: 100%;
}
</style>
