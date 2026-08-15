// 口令解锁 REST（唯一网络层，07 §3 规则 5）：POST /api/access/unlock（11 §3.1）。
// 后端校验 passcode 通过 → set 7 天 HttpOnly `ap_session` cookie；前端不读 cookie，只需带凭据收下。
// 该端点尚未进入生成的 openapi.d.ts（后端本轮新增），故此处手写 fetch（不走 typed apiClient）。
// 若后端最终契约（路径/入参）变化，仅需改这一处。
import { API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';

const UNLOCK_PATH = '/api/access/unlock';

/**
 * 提交口令解锁。成功（2xx）后 Set-Cookie 已落地，返回 void；
 * 失败抛 ApiErrorException（承载后端 ErrorEnvelope，含 message 供解锁门展示）。
 * passcode 只在此次请求体内出现，绝不落地/缓存（安全红线）。
 */
export async function submitPasscode(passcode: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}${UNLOCK_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // 收下后端 set 的 HttpOnly ap_session cookie
    body: JSON.stringify({ passcode }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiErrorException(toApiError(body, response.status), response.status);
  }
}
