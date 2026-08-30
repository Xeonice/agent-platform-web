'use client';
// 放行闸门（F21-8 §2「判定位置」/「路由拦截」）：全局最外层，在 `app/layout.tsx` 之下。
//
// ⚠️ **四条纪律：**
//
//  ① **未初始化时「只渲染向导」，⛔ 不是「渲染工作台再盖一层」。** 差别在 DOM 里：
//     `initialized === false` 时 `children` **根本不进树**。盖一层的写法在界面上完全一样，
//     代价是工作台照常挂载 —— 它会去拉项目列表、开 `/events` WS、恢复上次选中的 Task，
//     而这台机器还没初始化完。§7.3 那条断言因此是**否定断言**：不是"向导出现了"，
//     而是"工作台节点不存在"；只断言前者的话，两个同时渲染也照样绿。
//
//  ② **拦截靠"不渲染"，⛔ 不做 redirect。** 直接访问 `/settings/images` 时若 `router.replace('/')`，
//     用户完成初始化后就回不到他原本要去的地方了，而深链恢复（浏览器前进后退、书签）
//     会与这次强制跳转打架。⇒ URL 原样保留，只是那条路由下什么都不挂。
//     Next 的嵌套布局让这件事天然成立：所有页面都是本组件的 `children`。
//
//  ③ **pending 期间渲染骨架，⛔ 不渲染工作台**（§5「防闪现」）。先画工作台再换成向导，
//     用户会看到一次"进去了又被踢出来"，而那正是他第一次打开这个平台的第一印象。
//
//  ④ **判定失败时放行（fail-open），并把 401 交给口令门。** `init-status` 拉不到的原因只有
//     两种：后端没起来、或口令门拦下了。两者都不该表现成"欢迎使用初始化向导"——
//     后端没起来时向导里每个按钮都会失败，而口令门那条路上，用户要看到的是解锁框
//     （`AccessGateContainer` 在 `children` 里）。⇒ 放行，让下游各自说自己的话。
import { useEffect, type ReactNode } from 'react';
import { useInitGate } from '@/hooks/system/useInitGate';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { InitWizardContainer } from '@/containers/init/InitWizardContainer';

export function AppBootGate({ children }: { children: ReactNode }) {
  const gate = useInitGate();
  const { reportRestError } = useReportUnauthorized();

  // ④ 401/口令门拒绝 → 置锁，`AccessGateContainer` 浮出解锁框。
  useEffect(() => {
    if (gate.error !== null) reportRestError(gate.error);
  }, [gate.error, reportRestError]);

  // ③ 判定没回来之前**什么都不挂**（工作台与向导都不挂）。
  if (gate.isPending) {
    return (
      <div
        role="status"
        data-testid="app-boot-skeleton"
        className="flex min-h-screen items-center justify-center text-sm text-muted-foreground"
      >
        正在检查平台初始化状态…
      </div>
    );
  }

  // ① `initialized !== true` ⇒ **只有向导**。⛔ 不要在这里 `<>{children}{wizard}</>`。
  //    ⚠️ 判据写成 `=== false` 而不是 `!== true` 是刻意的：`gate.data` 为 undefined 的情况
  //    （④ 的失败路径）走下面的放行，不掉进向导。
  if (gate.data?.initialized === false) {
    return <InitWizardContainer />;
  }

  return <>{children}</>;
}
