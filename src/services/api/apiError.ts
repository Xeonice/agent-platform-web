// ApiError —— 全站错误的唯一形状（07 §2，与 shared/10 §6.8 / §7.5 ErrorEnvelope 同构）。

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  retryable: boolean;
  traceId?: string;
  details?: ErrorDetail[];
}

export class ApiError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly traceId: string | undefined;
  readonly details: ErrorDetail[];
  readonly httpStatus: number;

  constructor(envelope: ErrorEnvelope, httpStatus: number) {
    super(envelope.message);
    this.name = 'ApiError';
    this.code = envelope.code;
    this.retryable = envelope.retryable;
    this.traceId = envelope.traceId;
    this.details = envelope.details ?? [];
    this.httpStatus = httpStatus;
  }
}

/** 运行时判别未知响应体是否为后端统一错误 envelope（10 §6.8）。 */
export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['code'] === 'string' &&
    typeof v['message'] === 'string' &&
    typeof v['retryable'] === 'boolean'
  );
}

/** 把任意非 2xx 响应体归一化为 ApiError。 */
export function toApiError(body: unknown, httpStatus: number): ApiError {
  if (isErrorEnvelope(body)) return new ApiError(body, httpStatus);
  return new ApiError(
    { code: 'UNKNOWN', message: `请求失败（HTTP ${String(httpStatus)}）`, retryable: false },
    httpStatus,
  );
}
