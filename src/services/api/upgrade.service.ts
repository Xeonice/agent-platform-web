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

// Status and reconciliation are small reads from the stable control system.
// A slow business service must not keep its last-known state looking current.
const UPGRADE_STATUS_TIMEOUT_MS = 2_000;
// Preserve the rolling-compatibility budget only for old synchronous commands.
// New controllers persist async acceptance before doing expensive verification.
const UPGRADE_LEGACY_COMMAND_TIMEOUT_MS = 240_000;

async function call(
  path: string,
  init: RequestInit = {},
  timeoutMs = UPGRADE_STATUS_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
  };
  if (init.signal?.aborted === true) controller.abort();
  init.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
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
    await call(
      '/api/system/upgrade/requests',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upgrade-CSRF': csrfToken,
          ...(preferAsync ? { Prefer: 'respond-async' } : {}),
        },
        body: JSON.stringify(UpgradeRequestSchema.parse(body)),
      },
      preferAsync ? UPGRADE_STATUS_TIMEOUT_MS : UPGRADE_LEGACY_COMMAND_TIMEOUT_MS,
    ),
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
    await call(
      '/api/system/upgrade/contracts/requests',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Upgrade-CSRF': csrfToken },
        body: JSON.stringify(UpgradeContractRequestSchema.parse(body)),
      },
      UPGRADE_LEGACY_COMMAND_TIMEOUT_MS,
    ),
  );
}
export async function lookupContractRequest(requestId: string): Promise<UpgradeContractAttempt> {
  return UpgradeContractAttemptSchema.parse(
    await call(`/api/system/upgrade/contracts/requests/${encodeURIComponent(requestId)}`),
  );
}
