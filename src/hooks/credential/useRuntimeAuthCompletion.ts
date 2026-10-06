import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getRuntimeAuthStatus,
  setAuthMode,
  authMethodToMode,
} from '@/services/api/runtime.service';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/credential/useRuntimes';
import type { AuthSuccess } from '@/hooks/credential/useRuntimeAuthFlow';
import type { RuntimeDto, RuntimeAuthMethod } from '@/types/runtimeCredential';

/** Keep the success panel visible while the authoritative credential state refreshes. */
export function useRuntimeAuthCompletion(
  runtimeId: string,
  method: RuntimeAuthMethod,
  activateOnSuccess: boolean,
  onSuccess?: (result: AuthSuccess) => void,
) {
  const queryClient = useQueryClient();
  const alive = useRef(true);
  const pending = useRef<AuthSuccess | null>(null);
  const inFlight = useRef(false);
  const visibleUntil = useRef<Promise<void>>(Promise.resolve());
  const callback = useRef(onSuccess);
  callback.current = onSuccess;
  const [refreshError, setRefreshError] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    const result = pending.current;
    if (result === null || inFlight.current) return;
    inFlight.current = true;
    setRefreshError(false);
    try {
      if (activateOnSuccess) await setAuthMode(runtimeId, authMethodToMode(method));
      const runtime = await getRuntimeAuthStatus(runtimeId);
      if (!alive.current) return;
      queryClient.setQueryData(runtimeAuthKeys.status(runtimeId), runtime);
      queryClient.setQueryData<RuntimeDto[]>(runtimeKeys.list(), (current) =>
        current?.map((item) => (item.id === runtimeId ? runtime : item)),
      );
      await visibleUntil.current;
      const isMounted = () => alive.current;
      if (isMounted()) callback.current?.(result);
    } catch {
      if (alive.current) setRefreshError(true);
    } finally {
      inFlight.current = false;
    }
  }, [activateOnSuccess, method, queryClient, runtimeId]);
  const complete = useCallback(
    (result: AuthSuccess) => {
      pending.current = result;
      visibleUntil.current = new Promise((resolve) => setTimeout(resolve, 2000));
      queryClient.setQueryData<RuntimeDto[]>(runtimeKeys.list(), (current) =>
        current?.map((runtime) => {
          if (runtime.id !== runtimeId || !['none', 'expired'].includes(runtime.credentialStatus))
            return runtime;
          return {
            ...runtime,
            credentialStatus: 'active',
            maskedIdentifier: result.maskedIdentifier,
            activeAuthMethod: authMethodToMode(method),
          };
        }),
      );
      void refresh();
    },
    [method, queryClient, refresh, runtimeId],
  );
  return {
    complete,
    refreshError,
    retryRefresh: () => {
      void refresh();
    },
  };
}
