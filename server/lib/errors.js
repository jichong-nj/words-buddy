export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, msg, details) => new ApiError(400, code, msg, details);
export const unauthorized = (msg = '请先登录') => new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg = '没有权限') => new ApiError(403, 'forbidden', msg);
export const notFound = (msg = '资源不存在') => new ApiError(404, 'not_found', msg);
export const conflict = (code, msg, details) => new ApiError(409, code, msg, details);
