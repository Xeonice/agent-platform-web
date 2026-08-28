// `sandbox.instance_progress` 的**唯一**消费点（纯函数，可单测）。
//
// 它补的是这个洞：一个 Task 停在「启动实例」**3 分 10 秒**，全程零反馈，用户判它卡死；
// 去排查的人第一次采样看到 CPU 0%、到 registry 零连接，**也判成了卡死**。审计流事后
// 才说清楚：`starting` 段 190529ms，其中探测 + 装 runtime + 起会话加起来不到 0.4 秒，
// 190 秒**全在 provider 起实例那一步**——13GB 的镜像本机第一次用，要现拉 + 铺 rootfs。
//
// 纪律（同 `runtimeInstallProgress`，15 §2.3 / 10 §7.4）：
//   · 不 patch 任何 Query 字段，只喂进度卡「启动实例」格下的一行子文案；
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

/**
 * 「启动实例」格下的子文案。返回 undefined = 本格不加子文案。
 *
 * ⚠️ **`true` 那一支只陈述事实，不承诺时间。** 后端那个布尔有一种它自己排除不掉的假阳性：
 * BoxLite 的 image store 里有 `complete` 这一列（半截的 pull 是 0），而 SDK 的
 * `images.list()` 根本不把它透出来——一次拉到一半的 13GB 镜像照样会被数成"有"。
 * 所以这里写「镜像已在本机」而不是「几秒就好」：万一那个 true 是错的，用户损失的是
 * 一句安慰，而不是又一次"说好很快结果等了三分钟"。
 */
export function instanceSubCopy(progress: InstanceStartupProgress | undefined): string | undefined {
  if (progress === undefined) return undefined;
  if (progress.phase === 'ready') return '实例已就绪，正在准备 agent 运行环境…';
  switch (progress.imageStaged) {
    case false:
      // 「不是卡死」这句必须写出来——这一段没有任何输出、CPU 也不忙，它看起来就是卡死了。
      return '本机还没有这个镜像，正在下载并铺开运行环境…（首次使用可能持续数分钟，期间没有输出，不是卡死）';
    case true:
      return '镜像已在本机，正在拉起实例…';
    default:
      // provider 说不出（第三方 provider 没实现这个可选方法，或这次问不出来）。
      // 只说做什么、不解释为什么慢——编一个理由比不给理由更糟。
      return '正在拉起实例…';
  }
}

/**
 * 「已等待」的显示形态：`m:ss`，超过一小时给 `h:mm:ss`。
 *
 * ⚠️ 这个数字**由前端自己算**，后端一个字节都不推：浏览器知道自己是哪一刻收到
 * `status_changed → starting` 的，从那一刻数即可。为它新增一个 WS 字段等于让唯一的
 * 读者去跟一个它本来就有的值对账，还要跨仓同步一次（10 §7.4 里明写了这条取舍）。
 *
 * 负数与 NaN 一律归 0：时钟回拨不该在进度卡上渲染成 `-1:-3`。
 */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const seconds = String(total % 60).padStart(2, '0');
  if (total < 3600) return `${String(Math.floor(total / 60))}:${seconds}`;
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return `${String(Math.floor(total / 3600))}:${minutes}:${seconds}`;
}
