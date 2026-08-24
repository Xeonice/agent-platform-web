// 从 clone 进度 store 派生 view 用结果（hook 可 import lib；view 只吃派生结果）。
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '@/stores';
import {
  cloneProgressPercent,
  cloneFailureGuidance,
  cloneStageLabel,
  formatBytes,
  formatRate,
  formatElapsed,
  type CloneFailureGuidance,
} from '@/lib/projectClone';
import type { ProjectCloneState } from '@/types/project';

export interface ProjectCloneView {
  /** store 中的原始进度（无记录为 null）。 */
  state: ProjectCloneState | null;
  /** 百分比（0–100）；null 时走 indeterminate 展示。 */
  percent: number | null;
  /** 进度明细（阶段 · 对象数 · 体积 · 速率；container 透传给 view，避免 view 依赖 lib）。 */
  detailLabel?: string;
  /** "已用 1:23"；长克隆里最便宜的"我还活着"信号。 */
  elapsedLabel?: string;
  isCloning: boolean;
  isSlow: boolean;
  isDone: boolean;
  isFailed: boolean;
  /** 仅 failed 态给出的错误码引导（否则 null）。 */
  guidance: CloneFailureGuidance | null;
}

/**
 * 明细行：`接收对象 · 527/26,348 · 380 KB · 189 KB/s`。
 *
 * 逐段都可缺（git 早期的帧只有阶段和对象数），缺了就不出现，不留空占位。
 * 旧实现只有两条分支：`x / y`（幽灵 totalBytes，永不成立）与裸 `45%`——
 * 于是实际渲染出来的永远只是一个百分比，还与进度条重复。
 */
function buildDetailLabel(state: ProjectCloneState): string | undefined {
  const parts: string[] = [];
  const stage = cloneStageLabel(state.stage);
  if (stage !== undefined) parts.push(stage);
  if (typeof state.objectsDone === 'number' && typeof state.objectsTotal === 'number') {
    parts.push(`${state.objectsDone.toLocaleString()}/${state.objectsTotal.toLocaleString()}`);
  } else if (typeof state.objectsTotal === 'number') {
    // `Enumerating objects: 26348` 只有总数：先把总量亮出来，比空着强。
    parts.push(`共 ${state.objectsTotal.toLocaleString()} 个对象`);
  }
  if (typeof state.receivedBytes === 'number') parts.push(formatBytes(state.receivedBytes));
  if (typeof state.bytesPerSecond === 'number') parts.push(formatRate(state.bytesPerSecond));
  return parts.length === 0 ? undefined : parts.join(' · ');
}

export function useProjectClone(projectId: string | null): ProjectCloneView {
  const state = useAppStore((s) => (projectId === null ? undefined : s.projectClones[projectId]));

  // "已用 x:xx" 要自己走——事件到达的间隔是不确定的（受 1/s 节流 + 网络影响），
  // 只靠事件驱动重渲染会让时长看起来一顿一顿的，反而像卡住。
  // ⚠️ 只在进行中计时：done/failed 之后继续 setInterval 就是纯泄漏。
  const ticking = state !== undefined && (state.phase === 'cloning' || state.phase === 'slow');
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNowMs(Date.now());
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [ticking]);

  return useMemo(() => {
    if (state === undefined) {
      return {
        state: null,
        percent: null,
        detailLabel: undefined,
        elapsedLabel: undefined,
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
      detailLabel: buildDetailLabel(state),
      elapsedLabel:
        state.startedAt === undefined || state.phase === 'done' || state.phase === 'failed'
          ? undefined
          : `已用 ${formatElapsed(nowMs - state.startedAt)}`,
      isCloning: state.phase === 'cloning',
      isSlow: state.phase === 'slow',
      isDone: state.phase === 'done',
      isFailed: state.phase === 'failed',
      guidance: state.phase === 'failed' ? cloneFailureGuidance(state.errorCode) : null,
    };
  }, [state, nowMs]);
}
