// `sandbox.instance_progress` 的**唯一**消费点（纯函数，可单测）。
//
// 它补的是这个洞：一个 Task 停在「启动运行环境」**3 分 10 秒**，全程零反馈，用户判它卡死；
// 去排查的人第一次采样看到 CPU 0%、到 registry 零连接，**也判成了卡死**。审计流事后
// 才说清楚：`starting` 段 190529ms，其中探测 + 装 runtime + 起会话加起来不到 0.4 秒，
// 190 秒**全在 provider 起实例那一步**——13GB 的镜像本机第一次用，要现拉 + 铺 rootfs。
//
// 纪律（同 `runtimeInstallProgress`，15 §2.3 / 10 §7.4）：
//   · 不 patch 任何 Query 字段，只喂进度卡「启动运行环境」格下的一行子文案；
//   · 不作为失败原因来源（失败一律走 status_changed.errorCode / DTO.failureCode）。
import type { InstanceStartupPhase } from '@/types/ws-protocol';

/**
 * 某个沙箱当前起实例的进度（store 里 keyed by sandboxId 的那份投影）。
 *
 * ⚠️ `imageStaged` 的三态是这个类型的全部意义：`false`（本机确实没有）、`true`（有）、
 * **`undefined`（provider 说不出）**。第三种绝不能被当成第一种——「不知道为什么慢」和
 * 「因为要现拉一份 13GB 的镜像所以慢」是两句话，只有后者能拿去当让用户接着等的理由。
 */
export interface InstanceStartupProgress {
  phase: InstanceStartupPhase;
  imageStaged?: boolean;
}

/** Image presence is not evidence of current transfer or forward progress. */
export function instanceSubCopy(progress: InstanceStartupProgress | undefined): string | undefined {
  if (progress === undefined) return undefined;
  if (progress.phase === 'ready') return '运行环境已就绪，正在准备 Agent…';
  if (progress.imageStaged === false) return '本机尚未找到这个镜像，正在确认运行环境准备情况。';
  if (progress.imageStaged === true) return '本机已有镜像记录，正在准备运行环境…';
  return '正在确认运行环境准备情况…';
}
export function startupSubtitle(progress: InstanceStartupProgress | undefined): string | undefined {
  return progress?.imageStaged === false ? '本机尚未找到这个镜像；具体准备进展待确认。' : undefined;
}

/** Display elapsed server time without inventing a missing clock anchor. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const seconds = String(total % 60).padStart(2, '0');
  if (total < 3600) return `${String(Math.floor(total / 60))}:${seconds}`;
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return `${String(Math.floor(total / 3600))}:${minutes}:${seconds}`;
}
