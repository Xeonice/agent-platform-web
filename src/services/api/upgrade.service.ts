import { API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import {
  UpgradeStatusSchema,
  UpgradeAttemptSchema,
  UpgradeRequestSchema,
  UpgradeAccessSchema,
} from '@/types/upgrade-contract';
import type { UpgradeStatus, UpgradeRequest, UpgradeAttempt } from '@/types/upgrade';

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
  };
  if (init.signal?.aborted === true) controller.abort();
  init.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, 5_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: 'include',
      cache: 'no-store',
    });
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok)
      throw new ApiErrorException(toApiError(body, response.status), response.status);
    return body;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', onAbort);
  }
}
export async function getUpgradeStatus(signal?: AbortSignal): Promise<UpgradeStatus> {
  return UpgradeStatusSchema.parse(
    await call('/api/system/upgrade/status', signal === undefined ? {} : { signal }),
  );
}
export async function requestInstanceUpgrade(
  body: UpgradeRequest,
  csrfToken: string,
): Promise<UpgradeAttempt> {
  return UpgradeAttemptSchema.parse(
    await call('/api/system/upgrade/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upgrade-CSRF': csrfToken },
      body: JSON.stringify(UpgradeRequestSchema.parse(body)),
    }),
  );
}
export async function lookupUpgradeRequest(
  requestId: string,
  signal?: AbortSignal,
): Promise<UpgradeAttempt> {
  return UpgradeAttemptSchema.parse(
    await call(
      `/api/system/upgrade/requests/${encodeURIComponent(requestId)}`,
      signal === undefined ? {} : { signal },
    ),
  );
}
export async function grantUpgradeAccess(
  upgradeKey: string,
  csrfToken: string,
): Promise<UpgradeStatus> {
  return UpgradeStatusSchema.parse(
    await call('/api/system/upgrade/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upgrade-CSRF': csrfToken },
      body: JSON.stringify(UpgradeAccessSchema.parse({ upgradeKey })),
    }),
  );
}
