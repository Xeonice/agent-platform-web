// `runtime.install_progress` 的**唯一消费点**（纯函数，可单测）。
//
// 纪律（15 §2.3 / 10 §3.1，S5 裁决 T-3）：这条事件**不 patch 任何 Query 字段**——
// 它不是 SandboxDto 的一部分，只喂进度卡「启动实例」格子下的一行子文案。
// 存在的理由：装 CLI 期间 sandbox.status 恒为 `starting`，而 AIO 默认镜像上现装 claude-code
// 实测 **753 秒（12.5 分钟）**（04 §3 ★1）——没有子文案，用户盯着「启动实例」干等 12 分钟，看起来像卡死。
import type { RuntimeInstallStatus } from '@/types/ws-protocol';

/**
 * 某个沙箱当前的装 CLI 进度（store 里 keyed by sandboxId 的那份投影）。
 *
 * ⚠️ **刻意不含 errorCode**：契约帧上有这个字段，但 install_progress **不是失败兜底通道**
 * （10 §3.1）。失败原因一律取 `sandbox.status_changed.errorCode`（即时）或
 * `SandboxResponseDto.failureCode`（刷新恢复）——单一来源，避免同一次失败被渲染两遍。
 */
export interface RuntimeInstallProgress {
  runtime: string;
  status: RuntimeInstallStatus;
  versionDetected?: string;
}

/**
 * 「启动实例」格下的子文案。返回 undefined = 本格不加子文案（进度卡照常渲染四格）。
 *
 * `failed` 刻意返回 undefined：**紧随其后的 `sandbox.status_changed → failed`（带 errorCode）才是权威**
 * （10 §3.1），失败呈现走失败卡而不是进度卡的子文案，避免两处同时喊失败。
 */
export function installSubCopy(progress: RuntimeInstallProgress | undefined): string | undefined {
  if (progress === undefined) return undefined;
  switch (progress.status) {
    case 'not_installed':
      return `镜像未预装 ${progress.runtime} CLI，准备安装…`;
    case 'installing':
      // 明确写出"可能十几分钟、不是卡死"——P22 §1 INSTALL_FAILED 行的说明要求。
      return `正在安装 ${progress.runtime} CLI…（该镜像未预装，现装可能持续十几分钟，不是卡死）`;
    case 'installed':
      return progress.versionDetected !== undefined && progress.versionDetected !== ''
        ? `${progress.runtime} CLI 已就绪（${progress.versionDetected}）`
        : `${progress.runtime} CLI 已就绪`;
    case 'failed':
      return undefined;
  }
}
