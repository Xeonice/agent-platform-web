// 错误信封类型来自后端生成物，前端不手写（frontend/28 §6；shared/10 §6.8 / §7.5）。
// 改后端 zod → openapi.json → generate:api，此处类型随之变化并在编译期报红。
import type { components } from '@/types/generated/openapi';

/** 全站错误的唯一形状 = 后端生成的 ErrorEnvelope（{code,message,retryable,traceId?,details?}）。 */
export type ApiError = components['schemas']['ErrorEnvelope'];
/** 语义别名（与 shared/10 §7.5 命名一致）。 */
export type ErrorEnvelope = ApiError;

/** 运行时判别未知响应体是否为后端统一错误信封（10 §6.8）。用 in/typeof 收窄，不用断言。 */
export function isErrorEnvelope(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'code' in value &&
    typeof value.code === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'retryable' in value &&
    typeof value.retryable === 'boolean'
  );
}

/** 把任意非 2xx 响应体归一化为 ApiError 信封。 */
export function toApiError(body: unknown, httpStatus: number): ApiError {
  if (isErrorEnvelope(body)) return body;
  return { code: 'UNKNOWN', message: `请求失败（HTTP ${String(httpStatus)}）`, retryable: false };
}

/**
 * 可抛出的异常：携带信封 + HTTP 状态。
 * `throw` 需要 Error 实例（@typescript-eslint/only-throw-error），故信封类型与抛出载体分离——
 * 类型仍是生成的 ErrorEnvelope，这个类只是运输壳。
 */
export class ApiErrorException extends Error {
  readonly envelope: ApiError;
  readonly httpStatus: number;

  constructor(envelope: ApiError, httpStatus: number) {
    super(envelope.message);
    this.name = 'ApiErrorException';
    this.envelope = envelope;
    this.httpStatus = httpStatus;
  }
}
