// 失败项目恢复动作（副作用归 hook）：retry-clone / convert-to-empty，供 NewProjectContainer（建流程内）
// 与 ProjectRecoveryContainer（工作台选中失败项目）复用——失败项目刷新/切走再回来也能触达恢复动作（P0-1）。
// retry 乐观置 cloning；失败必回退到 failed + 展示可见错误（不停在 cloning，P0-2）。
import { useState } from 'react';
import { useRetryClone, useConvertToEmpty } from '@/hooks/project/useProjects';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { cloneFailureGuidance, type CloneFailureGuidance } from '@/lib/project/projectClone';
import { ApiErrorException } from '@/services/api/apiError';

export interface UseProjectRecoveryArgs {
  projectId: string | null;
  /** 失败错误码（clone store 或 DTO.cloneErrorCode）：用于引导文案 + retry 回退恢复。 */
  errorCode?: string | null;
  /** 转空成功回调（选中并进入建沙箱流）。 */
  onConverted?: (projectId: string) => void;
}

export interface ProjectRecoveryApi {
  retry: () => void;
  convertToEmpty: () => void;
  busy: boolean;
  /** 动作失败的用户可见错误（409/网络等；null 无错误）。 */
  actionError: string | null;
  guidance: CloneFailureGuidance;
}

/** 归一化 mutation 错误为用户可见文案（401 已由 reportRestError 处理，此处覆盖 409/非 failed 态/网络）。 */
function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiErrorException) {
    return error.envelope.message !== '' ? error.envelope.message : '操作失败，请稍后重试。';
  }
  return '网络错误，请稍后重试。';
}

export function useProjectRecovery({
  projectId,
  errorCode,
  onConverted,
}: UseProjectRecoveryArgs): ProjectRecoveryApi {
  const retryClone = useRetryClone();
  const convertToEmpty = useConvertToEmpty();
  const { reportRestError } = useReportUnauthorized();
  const setCloneProgress = useAppStore((s) => s.setCloneProgress);
  const clearCloneProgress = useAppStore((s) => s.clearCloneProgress);
  const [actionError, setActionError] = useState<string | null>(null);

  const rollbackCode = errorCode ?? undefined;

  const retry = (): void => {
    if (projectId === null) return;
    setActionError(null);
    setCloneProgress(projectId, { phase: 'cloning' }); // 乐观置 cloning
    retryClone.mutate(projectId, {
      onError: (error) => {
        reportRestError(error);
        // 关键：回退到 failed，绝不停在 cloning（P0-2）。
        setCloneProgress(projectId, { phase: 'failed', errorCode: rollbackCode });
        setActionError(actionErrorMessage(error));
      },
    });
  };

  const convert = (): void => {
    if (projectId === null) return;
    setActionError(null);
    convertToEmpty.mutate(projectId, {
      onSuccess: (project) => {
        clearCloneProgress(project.id);
        onConverted?.(project.id);
      },
      onError: (error) => {
        reportRestError(error);
        setActionError(actionErrorMessage(error));
      },
    });
  };

  return {
    retry,
    convertToEmpty: convert,
    busy: retryClone.isPending || convertToEmpty.isPending,
    actionError,
    guidance: cloneFailureGuidance(rollbackCode),
  };
}
