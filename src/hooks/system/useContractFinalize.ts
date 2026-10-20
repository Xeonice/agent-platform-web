import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiErrorException } from '@/services/api/apiError';
import { lookupContractRequest, requestSemanticContract } from '@/services/api/upgrade.service';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { contractPendingKey, deriveContractFinalize } from '@/lib/system/contractFinalizeModel';
import { newUpgradeRequestId, readPendingRequest } from '@/lib/system/upgradeRequestIdentity';
import { UpgradeStatusSchema } from '@/types/upgrade-contract';
import type { InstanceUpgradeController } from '@/hooks/system/useInstanceUpgrade';

interface Pending {
  requestId: string;
  key: string;
  submitting: boolean;
}
interface Proposal {
  instanceId: string;
  userScope: string;
  generation: number;
  planDigest: string;
}
const unavailableCheck = () => Promise.resolve(false);
/** Uses the single AppFrame status source; only an unresolved command has its own lookup. */
export function useContractFinalize(controller: InstanceUpgradeController | null) {
  const observation = controller?.observation;
  const snapshot = useMemo(
    () => (observation?.snapshot ? UpgradeStatusSchema.parse(observation.snapshot) : null),
    [observation?.snapshot],
  );
  const model = deriveContractFinalize(snapshot, observation?.uncertain ?? true, Date.now());
  const check = controller?.check ?? unavailableCheck;
  const { reportRestError } = useReportUnauthorized();
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const key = snapshot ? contractPendingKey(snapshot.instanceId, snapshot.userScope) : null;
  const update = useCallback((next: Pending | null) => {
    const old = pendingRef.current;
    pendingRef.current = next;
    setPending(next);
    try {
      if (next)
        localStorage.setItem(next.key, JSON.stringify({ version: 1, requestId: next.requestId }));
      else if (old) localStorage.removeItem(old.key);
    } catch {
      /* Public bookmark failure is never authority or a new command. */
    }
  }, []);
  useEffect(() => {
    if (key === null || pendingRef.current?.key === key) return;
    let requestId: string | null = null;
    try {
      requestId = readPendingRequest(localStorage.getItem(key));
    } catch {
      /* optional bookmark */
    }
    const restored = requestId ? { requestId, key, submitting: false } : null;
    pendingRef.current = restored;
    setPending(restored);
    setProposal(null);
    setMessage(restored ? '清理请求结果待确认，正在查询原请求' : null);
  }, [key]);
  useEffect(() => {
    if (!pending || pending.submitting) return;
    if (snapshot?.contract?.attempt?.requestId === pending.requestId) {
      update(null);
      setMessage(null);
      return;
    }
    let live = true,
      inFlight = false;
    const lookup = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await lookupContractRequest(pending.requestId);
        if (
          !live ||
          result.requestId !== pending.requestId ||
          result.instanceId !== snapshot?.instanceId
        )
          return;
        setMessage('清理请求已受理，正在确认原请求状态');
        await check();
      } catch (error) {
        if (!live) return;
        reportRestError(error);
        if (error instanceof ApiErrorException && error.httpStatus === 404) {
          update(null);
          setMessage('已确认清理请求尚未受理。检查状态后，可自行决定是否重新提交。');
        } else setMessage('清理请求结果暂时无法确认，仅查询原请求，不重复执行');
      } finally {
        inFlight = false;
      }
    };
    void lookup();
    const timer = setInterval(() => {
      void lookup();
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [
    pending,
    snapshot?.instanceId,
    snapshot?.contract?.attempt?.requestId,
    check,
    update,
    reportRestError,
  ]);
  const onConfirmationOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setProposal(null);
        return;
      }
      const plan = snapshot?.contract?.availablePlan;
      if (!model.canExecute || !snapshot || !plan || pendingRef.current) return;
      setProposal({
        instanceId: snapshot.instanceId,
        userScope: snapshot.userScope,
        generation: snapshot.activationGeneration,
        planDigest: plan.planDigest,
      });
    },
    [model.canExecute, snapshot],
  );
  const onConfirm = useCallback(() => {
    if (pendingRef.current || !proposal || !snapshot || !key) return;
    if (
      !deriveContractFinalize(snapshot, observation?.uncertain ?? true, Date.now()).canExecute ||
      snapshot.instanceId !== proposal.instanceId ||
      snapshot.userScope !== proposal.userScope ||
      snapshot.activationGeneration !== proposal.generation ||
      snapshot.contract?.availablePlan?.planDigest !== proposal.planDigest
    ) {
      setProposal(null);
      setMessage('清理权限、目标或实例状态已改变，请检查后重新确认。');
      void check();
      return;
    }
    const body = {
      requestId: newUpgradeRequestId(),
      targetPlanDigest: proposal.planDigest,
      expectedActivationGeneration: proposal.generation,
      acknowledgeRollbackClosure: true as const,
    };
    update({ requestId: body.requestId, key, submitting: true });
    setMessage('正在确认本次独立清理请求');
    void requestSemanticContract(body, snapshot.csrfToken)
      .then(async (accepted) => {
        if (pendingRef.current?.requestId !== body.requestId) return;
        if (
          accepted.requestId !== body.requestId ||
          accepted.targetPlanDigest !== body.targetPlanDigest ||
          accepted.instanceId !== proposal.instanceId ||
          accepted.activationGeneration !== proposal.generation
        ) {
          update({ requestId: body.requestId, key, submitting: false });
          setMessage('清理回执身份暂时无法确认，仅查询原请求。');
          setProposal(null);
          return;
        }
        update({ requestId: body.requestId, key, submitting: false });
        setProposal(null);
        setMessage('清理请求已受理，正在读取原请求进度');
        await check();
      })
      .catch((error: unknown) => {
        reportRestError(error);
        if (pendingRef.current?.requestId !== body.requestId) return;
        setProposal(null);
        if (
          error instanceof ApiErrorException &&
          [400, 401, 403, 409, 422].includes(error.httpStatus)
        ) {
          update(null);
          setMessage('本次清理请求未受理，请检查权限、目标及实例状态。');
          void check();
        } else {
          update({ requestId: body.requestId, key, submitting: false });
          setMessage('清理请求结果待确认，仅查询原请求，不重复执行');
        }
      });
  }, [proposal, snapshot, key, observation?.uncertain, check, reportRestError, update]);
  return {
    model,
    busy: pending !== null,
    message,
    confirmationOpen: proposal !== null,
    onConfirmationOpenChange,
    onConfirm,
  };
}
