import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  getUpgradeStatus,
  lookupUpgradeRequest,
  requestInstanceUpgrade,
} from '@/services/api/upgrade.service';
import { loadedWebBuild } from '@/services/system/loadedWebBuild';
import { ApiErrorException } from '@/services/api/apiError';
import {
  deriveUpgradeModel,
  receiveUpgradeStatus,
  unknownUpgradeObservation,
} from '@/lib/system/upgradeModel';
import {
  newUpgradeRequestId,
  readPendingRequest,
  upgradePendingKey,
} from '@/lib/system/upgradeRequestIdentity';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useUpgradeReminder } from '@/hooks/system/useUpgradeReminder';
import { useUpgradeLeaveGuard } from '@/hooks/system/useUpgradeLeaveGuard';
import type { UpgradeDisplayModel, UpgradeObservation } from '@/types/upgrade';

export const UPGRADE_STATUS_KEY = ['system', 'upgrade-status'] as const;
interface PendingRequest {
  requestId: string;
  storageKey: string;
  phase: 'submitting' | 'lookup' | 'accepted';
}
export interface InstanceUpgradeController {
  model: UpgradeDisplayModel;
  observation: UpgradeObservation | null;
  busy: boolean;
  isChecking: boolean;
  commandMessage: string | null;
  showNotice: boolean;
  check: () => Promise<boolean>;
  upgrade: () => void;
  refreshPage: () => void;
  later: () => void;
  openDetails: () => void;
  detailsRequested: boolean;
  consumeDetailsRequest: () => void;
}
export const InstanceIdentityContext = createContext<
  { instanceId: string; userScope: string } | null | undefined
>(undefined);
export function useInstanceIdentity() {
  return useContext(InstanceIdentityContext);
}
export const InstanceUpgradeContext = createContext<InstanceUpgradeController | null>(null);
export function useInstanceUpgradeContext() {
  return useContext(InstanceUpgradeContext);
}

function savePending(pending: PendingRequest | null, previousKey?: string) {
  try {
    if (pending === null) {
      if (previousKey !== undefined) localStorage.removeItem(previousKey);
    } else
      localStorage.setItem(
        pending.storageKey,
        JSON.stringify({ version: 1, requestId: pending.requestId }),
      );
  } catch {
    /* Storage failure never becomes permission or a second upgrade. */
  }
}

/** One owner in AppFrame. All cards and headers consume its context, not duplicate pollers. */
export function useInstanceUpgrade(): InstanceUpgradeController {
  const client = useQueryClient();
  const router = useRouter();
  const { reportRestError } = useReportUnauthorized();
  const query = useQuery({
    queryKey: UPGRADE_STATUS_KEY,
    queryFn: async ({ signal }): Promise<UpgradeObservation> => {
      const snapshot = await getUpgradeStatus(signal);
      return receiveUpgradeStatus(
        client.getQueryData<UpgradeObservation>(UPGRADE_STATUS_KEY) ?? null,
        snapshot,
        Date.now(),
      );
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (query.error !== null) reportRestError(query.error);
  }, [query.error, reportRestError]);
  const observation = query.isError
    ? unknownUpgradeObservation(query.data ?? null)
    : (query.data ?? null);
  const model = useMemo(
    () => deriveUpgradeModel(observation, loadedWebBuild, now),
    [observation, now],
  );
  const snapshot = observation?.snapshot ?? null;
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [detailsRequested, setDetailsRequested] = useState(false);
  const leaveGuard = useUpgradeLeaveGuard();
  const check = useCallback(async () => {
    try {
      await client.fetchQuery({ queryKey: UPGRADE_STATUS_KEY });
      setNow(Date.now());
      return true;
    } catch {
      return false;
    }
  }, [client]);
  const reminder = useUpgradeReminder(
    snapshot?.instanceId ?? null,
    snapshot?.userScope ?? null,
    check,
  );
  const storageKey =
    snapshot === null ? null : upgradePendingKey(snapshot.instanceId, snapshot.userScope);
  const updatePending = useCallback((next: PendingRequest | null) => {
    const previous = pendingRef.current;
    pendingRef.current = next;
    setPending(next);
    savePending(next, previous?.storageKey);
  }, []);
  useEffect(() => {
    if (storageKey === null) return;
    if (pendingRef.current?.storageKey === storageKey) return;
    let requestId: string | null = null;
    try {
      requestId = readPendingRequest(localStorage.getItem(storageKey));
    } catch {
      /* optional persistence */
    }
    const restored: PendingRequest | null =
      requestId === null ? null : { requestId, storageKey, phase: 'lookup' };
    pendingRef.current = restored;
    setPending(restored);
    setCommandMessage(restored === null ? null : '升级请求结果待确认，正在查询原请求');
  }, [storageKey]);
  useEffect(() => {
    if (pending === null || pending.phase === 'submitting') return;
    if (snapshot?.attempt?.requestId === pending.requestId) {
      updatePending(null);
      setCommandMessage(null);
      return;
    }
    let live = true;
    let querying = false;
    const lookup = async () => {
      if (querying) return;
      querying = true;
      try {
        const result = await lookupUpgradeRequest(pending.requestId);
        if (!live || result.requestId !== pending.requestId) return;
        setCommandMessage('升级请求已受理，等待确认实例进度');
        await check();
      } catch (error) {
        if (!live) return;
        reportRestError(error);
        if (error instanceof ApiErrorException && error.httpStatus === 404) {
          updatePending(null);
          setCommandMessage('已确认尚未受理该请求。检查版本后，可自行决定是否重新升级。');
        } else setCommandMessage('升级请求结果暂时无法确认，只查询原请求，不重复提交');
      } finally {
        querying = false;
      }
    };
    void lookup();
    const timer = setInterval(() => {
      void lookup();
    }, 2_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pending, snapshot?.attempt?.requestId, check, reportRestError, updatePending]);

  const upgrade = useCallback(() => {
    if (
      pendingRef.current !== null ||
      !model.canUpgrade ||
      snapshot?.catalog.availableRelease === null ||
      snapshot === null ||
      storageKey === null
    )
      return;
    const target = snapshot.catalog.availableRelease;
    const body = {
      requestId: newUpgradeRequestId(),
      targetReleaseId: target.releaseId,
      targetDigest: target.targetDigest,
      expectedActivationGeneration: snapshot.activationGeneration,
    };
    updatePending({ requestId: body.requestId, storageKey, phase: 'submitting' });
    setCommandMessage('正在确认本次升级请求');
    void requestInstanceUpgrade(body, snapshot.csrfToken)
      .then(async (accepted) => {
        if (
          pendingRef.current?.requestId !== body.requestId ||
          accepted.requestId !== body.requestId ||
          accepted.targetDigest !== body.targetDigest ||
          accepted.instanceId !== snapshot.instanceId
        )
          return;
        updatePending({ requestId: body.requestId, storageKey, phase: 'accepted' });
        setCommandMessage('升级请求已受理，正在读取实例进度');
        await check();
      })
      .catch((error: unknown) => {
        reportRestError(error);
        if (pendingRef.current?.requestId !== body.requestId) return;
        if (
          error instanceof ApiErrorException &&
          [400, 401, 403, 409, 422].includes(error.httpStatus)
        ) {
          updatePending(null);
          setCommandMessage('本次请求未受理，请检查权限、目标版本和当前实例状态后再决定。');
          void check();
        } else {
          updatePending({ requestId: body.requestId, storageKey, phase: 'lookup' });
          setCommandMessage('请求结果待确认，只查询原请求，不重复提交');
        }
      });
  }, [model.canUpgrade, snapshot, storageKey, check, reportRestError, updatePending]);
  const refreshPage = useCallback(() => {
    if (!model.canRefresh || snapshot === null) return;
    const expectedInstance = snapshot.instanceId;
    void check().then((verified) => {
      const latest = client.getQueryData<UpgradeObservation>(UPGRADE_STATUS_KEY);
      if (
        !verified ||
        latest?.snapshot?.instanceId !== expectedInstance ||
        !deriveUpgradeModel(latest, loadedWebBuild, Date.now()).canRefresh
      ) {
        setCommandMessage('新版页面暂时未确认可用，请重新检查。');
        return;
      }
      if (leaveGuard() === 'allowed') window.location.reload();
    });
  }, [model.canRefresh, snapshot, leaveGuard, client, check]);
  const openDetails = useCallback(() => {
    setDetailsRequested(true);
    router.push('/settings/system#version');
  }, [router]);
  const consumeDetailsRequest = useCallback(() => {
    setDetailsRequested(false);
  }, []);
  return {
    model,
    observation,
    busy: pending !== null,
    isChecking: query.isFetching,
    commandMessage,
    showNotice: model.showEntry && reminder.showNotice,
    check,
    upgrade,
    refreshPage,
    later: reminder.dismiss,
    openDetails,
    detailsRequested,
    consumeDetailsRequest,
  };
}
