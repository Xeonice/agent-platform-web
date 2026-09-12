'use client';
// 全局横幅栈的容器（F21-8 §4 / 07 §8.4）。唯一的 view ↔ hooks 粘合点。
//
// ⚠️ **它挂在 `AppBootGate` 的 `children` 里，而不是与 `AppBootGate` 并排**（`app/layout.tsx`）。
//    差别在未初始化那一屏：并排时，向导与横幅会同时出现 —— 而向导是**阻塞式**的
//    （F21-8 §2「没有 [取消]、没有 Esc 逃逸」），在它上面挂一条「离线模式：Agent 不可用
//    [重新检测]」，那个 [重新检测] 会把用户从一个不许离开的流程里带走。
//    ⇒ 复用 `AppBootGate` 已有的结构性拦截：`initialized === false` 时 `children` 根本不进树，
//    于是"向导与横幅不同时出现"是**结构上成立的**，不靠任何一个 `if`。
//    （向导内部自有 `OfflineNotice`，那才是初始化阶段该说这件事的地方。）
//
// ⚠️ **[重新检测] 是一次跳转，不是一次探测**：理由写在 `useSystemStatus` 里那段
//    「全局横幅的 [重新检测] 落地点」。这里只做 意图位 + `router.push` 两件事。
import { useRouter } from 'next/navigation';
import { useGlobalBanner } from '@/hooks/system/useGlobalBanner';
import { useAppStore } from '@/stores';
import { BannerStackView } from '@/views/banner/BannerStack.view';

/** 两条阻断类横幅的动作去处：系统状态页（诊断卡在那里，且只有那里有所有者）。 */
const SYSTEM_STATUS_ROUTE = '/settings/system';
/** 工作台路由——治理类横幅的 [查看这些规则] 要去的地方（自动化面板只在工作台里）。 */
const WORKBENCH_ROUTE = '/';

export function GlobalBannerContainer() {
  const router = useRouter();
  const { model, dismiss, requestRecheck } = useGlobalBanner();
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectForMenu = useAppStore((s) => s.setSelectedProjectForMenu);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);

  return (
    <BannerStackView
      model={model}
      onDismiss={dismiss}
      onAction={(id) => {
        // ⚠️ 「查看这些规则」跳的不是系统状态页——自动化面板只挂在工作台的
        //    `WorkbenchContainer`（组头「⋯」→ 项目菜单）里，`/settings/system` 上没有它。
        //    走同一套 `currentModal`/`selectedProjectForMenu` 是因为两者本来就是同一份
        //    全局 store 状态：`WorkbenchContainer` 的 `overlaySlot` 已经在读它们。
        if (id === 'automation-needs-attention') {
          // ⚠️ 只有真的拿到了 projectId 才动这两位状态——理论上到这一步它必然有值
          // （横幅本身就是拿这个 projectId 的缓存判出来的），这里只是防御性收窄类型。
          if (selectedProjectId !== null) {
            setSelectedProjectForMenu(selectedProjectId);
            setCurrentModal('automations');
          }
          router.push(WORKBENCH_ROUTE);
          return;
        }
        // 「状态未知」那条只是去看看（此时诊断多半也跑不通，自动跑一轮只会多一条红线）；
        // 「离线」那条才真的要重跑一轮出网检测。
        if (id === 'offline') requestRecheck();
        router.push(SYSTEM_STATUS_ROUTE);
      }}
    />
  );
}
