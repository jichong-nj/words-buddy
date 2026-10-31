import { ElMessage } from 'element-plus';

async function request(method, path, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (e) {
    ElMessage.error('网络异常，请检查服务是否启动');
    throw e;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 无 JSON 响应体 */
  }
  if (!res.ok) {
    const msg = (data && data.message) || `请求失败（${res.status}）`;
    ElMessage.error(msg);
    const err = new Error(msg);
    err.status = res.status;
    err.code = data && data.code;
    err.details = data && data.details;
    // 会话过期：跳回登录页（登录/初始化接口自身的 401 除外）
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.assign('/login');
    }
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  put: (path, body = {}) => request('PUT', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),
  // multipart 上传（导入文件）
  upload: async (path, formData) => {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      });
    } catch (e) {
      ElMessage.error('网络异常，请检查服务是否启动');
      throw e;
    }
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* ignore */
    }
    if (!res.ok) {
      const msg = (data && data.message) || `上传失败（${res.status}）`;
      ElMessage.error(msg);
      const err = new Error(msg);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  },
};

// 下载二进制文件（错误报告 / 模板 / 词库导出）
export async function download(path, filename) {
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin' });
  } catch (e) {
    ElMessage.error('网络异常，下载失败');
    throw e;
  }
  if (!res.ok) {
    let msg = `下载失败（${res.status}）`;
    try {
      const data = await res.json();
      if (data && data.message) msg = data.message;
    } catch (e) {
      /* ignore */
    }
    ElMessage.error(msg);
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
