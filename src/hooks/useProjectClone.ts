// 从 clone 进度 store 派生 view 用结果（hook 可 import lib；view 只吃派生结果）。
import { useMemo } from 'react';
import { useAppStore } from '@/stores';
import {
  cloneProgressPercent,
  cloneFailureGuidance,
  formatBytes,
  type CloneFailureGuidance,
} from '@/lib/projectClone';
import type { ProjectCloneState } from '@/types/project';

export interface ProjectCloneView {
  /** store 中的原始进度（无记录为 null）。 */
  state: ProjectCloneState | null;
  /** 百分比（0–100）；null 时走 indeterminate 展示。 */
  percent: number | null;
  /** 进度明细（bytes 优先，否则 percent；container 直接透传给 view，避免 view 依赖 lib）。 */
  detailLabel?: string;
  isCloning: boolean;
  isSlow: boolean;
  isDone: boolean;
  isFailed: boolean;
  /** 仅 failed 态给出的错误码引导（否则 null）。 */
  guidance: CloneFailureGuidance | null;
}

function buildDetailLabel(state: ProjectCloneState, percent: number | null): string | undefined {
  if (typeof state.receivedBytes === 'number' && typeof state.totalBytes === 'number') {
    return `${formatBytes(state.receivedBytes)} / ${formatBytes(state.totalBytes)}`;
  }
  return percent === null ? undefined : `${String(percent)}%`;
}

export function useProjectClone(projectId: string | null): ProjectCloneView {
  const state = useAppStore((s) => (projectId === null ? undefined : s.projectClones[projectId]));

  return useMemo(() => {
    if (state === undefined) {
      return {
        state: null,
        percent: null,
        detailLabel: undefined,
        isCloning: false,
        isSlow: false,
        isDone: false,
        isFailed: false,
        guidance: null,
      };
    }
    const percent = cloneProgressPercent(state);
    return {
      state,
      percent,
      detailLabel: buildDetailLabel(state, percent),
      isCloning: state.phase === 'cloning',
      isSlow: state.phase === 'slow',
      isDone: state.phase === 'done',
      isFailed: state.phase === 'failed',
      guidance: state.phase === 'failed' ? cloneFailureGuidance(state.errorCode) : null,
    };
  }, [state]);
}
