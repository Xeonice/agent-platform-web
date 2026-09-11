// 失败项目恢复动作（副作用归 hook）：retry-clone / convert-to-empty，供 NewProjectContainer（建流程内）
// 与 ProjectRecoveryContainer（工作台选中失败项目）复用——失败项目刷新/切走再回来也能触达恢复动作（P0-1）。
// retry 乐观置 cloning；失败必回退到 failed + 展示可见错误（不停在 cloning，P0-2）。
import { useState } from 'react';
import { useRetryClone, useConvertToEmpty } from '@/hooks/project/useProjects';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
import { cloneFailureGuidance, type CloneFailureGuidance } from '@/lib/project/projectClone';
import { PROJECT_ERROR_COPY, projectErrorMessage } from '@/lib/project/projectErrorCopy';
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

/**
 * 归一化 mutation 错误为用户可见文案（401 已由 reportRestError 处理，此处覆盖 409/网络）。
 *
 * ★ **按码查表，⛔ 不渲染 `envelope.message`。** 旧写法的中文兜底永远走不到
 *   （`message` 恒非空），实际上屏的是 `retry-clone is only allowed on a failed project`。
 *
 * ⚠️ **两个动作各有自己的 `INVALID_STATE` 文案**：同一个 409，[重试克隆] 和
 *   [改为空项目] 该说的话不一样，而"这是哪个动作"只有调用点知道 ——
 *   ⛔ 不许合并成一句「当前状态不允许该操作」，那句话解释不了任何事。
 */
function actionErrorMessage(error: unknown, invalidState: string): string {
  if (!(error instanceof ApiErrorException)) return '网络不通，请稍后再试。';
  return projectErrorMessage(
    error.envelope.code,
    error.envelope.traceId,
    '操作失败，请稍后重试。',
    {
      ...PROJECT_ERROR_COPY,
      INVALID_STATE: invalidState,
    },
  );
}

/** 这两句都在说同一件事：这个项目已经不是「克隆失败」了，通常是别处已经处理过。 */
const RETRY_INVALID_STATE =
  '这个项目现在不是「克隆失败」状态，重试克隆用不上了 —— 可能已经克隆成功、或者在别处被改成了空项目。刷新一下看看。';
const CONVERT_INVALID_STATE =
  '这个项目现在不是「克隆失败」状态，改不成空项目 —— 可能已经克隆成功、或者在别处改过了。刷新一下看看。';

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
        setActionError(actionErrorMessage(error, RETRY_INVALID_STATE));
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
        setActionError(actionErrorMessage(error, CONVERT_INVALID_STATE));
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
