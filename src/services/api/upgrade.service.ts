import { API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import {
  UpgradeStatusSchema,
  UpgradeAttemptSchema,
  UpgradeOperationSchema,
  UpgradeRequestSchema,
  UpgradeContractRequestSchema,
  UpgradeContractAttemptSchema,
} from '@/types/upgrade-contract';
import type {
  UpgradeStatus,
  UpgradeRequest,
  UpgradeCommandResult,
  UpgradeContractRequest,
  UpgradeContractAttempt,
} from '@/types/upgrade';

// Verifying the installed source can take a minute and a command can verify it
// twice. Keep this control-plane wait bounded without changing request health
// deadlines or the freshness required to display upgrade progress.
const UPGRADE_CONTROL_TIMEOUT_MS = 240_000;

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
  };
  if (init.signal?.aborted === true) controller.abort();
  init.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, UPGRADE_CONTROL_TIMEOUT_MS);
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
  preferAsync = false,
): Promise<UpgradeCommandResult> {
  return UpgradeOperationSchema.or(UpgradeAttemptSchema).parse(
    await call('/api/system/upgrade/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Upgrade-CSRF': csrfToken,
        ...(preferAsync ? { Prefer: 'respond-async' } : {}),
      },
      body: JSON.stringify(UpgradeRequestSchema.parse(body)),
    }),
  );
}
export async function lookupUpgradeRequest(
  requestId: string,
  signal?: AbortSignal,
  preferAsync = false,
): Promise<UpgradeCommandResult> {
  return UpgradeOperationSchema.or(UpgradeAttemptSchema).parse(
    await call(`/api/system/upgrade/requests/${encodeURIComponent(requestId)}`, {
      ...(signal === undefined ? {} : { signal }),
      ...(preferAsync ? { headers: { Prefer: 'respond-async' } } : {}),
    }),
  );
}
export async function requestSemanticContract(
  body: UpgradeContractRequest,
  csrfToken: string,
): Promise<UpgradeContractAttempt> {
  return UpgradeContractAttemptSchema.parse(
    await call('/api/system/upgrade/contracts/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upgrade-CSRF': csrfToken },
      body: JSON.stringify(UpgradeContractRequestSchema.parse(body)),
    }),
  );
}
export async function lookupContractRequest(requestId: string): Promise<UpgradeContractAttempt> {
  return UpgradeContractAttemptSchema.parse(
    await call(`/api/system/upgrade/contracts/requests/${encodeURIComponent(requestId)}`),
  );
}
