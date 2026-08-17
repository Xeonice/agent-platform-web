// 项目克隆的纯派生（可单测）：进度百分比、失败错误码引导、就绪判定。UI 决策集中于此，view 只吃结果。
import type { ProjectCloneState, ProjectDto } from '@/types/project';

/** 项目是否就绪（可建沙箱）：cloneStatus 'ready'（空项目直接就绪 / git 克隆完成）。 */
export function isProjectReady(project: Pick<ProjectDto, 'cloneStatus'>): boolean {
  return project.cloneStatus === 'ready';
}

/**
 * 克隆进度百分比（0–100）：优先用后端 percent；否则用 bytes 比值；都没有则 null（走 indeterminate）。
 */
export function cloneProgressPercent(state: ProjectCloneState): number | null {
  if (typeof state.percent === 'number') return clamp(Math.round(state.percent), 0, 100);
  if (
    typeof state.receivedBytes === 'number' &&
    typeof state.totalBytes === 'number' &&
    state.totalBytes > 0
  ) {
    return clamp(Math.round((state.receivedBytes / state.totalBytes) * 100), 0, 100);
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/** 人类可读字节。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i] ?? 'GB'}`;
}

export interface CloneFailureGuidance {
  /** 面向用户的引导文案。 */
  message: string;
  /** 重试是否可能有效（PERMISSION 需凭证，重试无用）。 */
  canRetry: boolean;
  /** 需要凭证（S3 接入，暂文案）。 */
  needsCredentials: boolean;
}

/** 失败错误码 → 分支引导（未知码走通用重试）。 */
export function cloneFailureGuidance(errorCode: string | undefined): CloneFailureGuidance {
  switch (errorCode) {
    case 'CLONE_FAILED_PERMISSION':
      return {
        message: '没有访问该仓库的权限。需要配置访问凭证后重试（凭证管理将在后续版本提供）。',
        canRetry: false,
        needsCredentials: true,
      };
    case 'CLONE_FAILED_NETWORK':
      return {
        message: '网络错误导致克隆失败，请检查网络后重试。',
        canRetry: true,
        needsCredentials: false,
      };
    case 'TIMEOUT':
      return {
        message: '克隆超时（仓库较大或网络较慢），可重试。',
        canRetry: true,
        needsCredentials: false,
      };
    case 'INTERRUPTED':
      return { message: '克隆被中断，请重试。', canRetry: true, needsCredentials: false };
    case 'DISK_INSUFFICIENT':
      // 03 §7.5 retryable=❌：磁盘不足重试无意义，只保留「转为空项目」。
      return {
        message: '磁盘空间不足，无法完成克隆。可转为空项目，或清理磁盘后重新创建。',
        canRetry: false,
        needsCredentials: false,
      };
    default:
      return { message: '克隆失败，请重试。', canRetry: true, needsCredentials: false };
  }
}
