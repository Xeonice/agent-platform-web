'use client';
// clone 权限失败回程态（pendingProjectCreate）的生命周期守卫（F21-3 §10.2 修）。
// 该回程态只在凭证页 [重试克隆] 横幅里被消费；一旦离开凭证页就应作废，否则：
//   从项目 A 失败跳到凭证页 → 中途 Esc/切菜单/直接跳转离开去处理别的事（甚至删了 A）
//   → 之后再开 /settings/credentials 仍见陈旧横幅，点"重试克隆"会对已处理/已删 projectId 误发 retry-clone。
// 全局挂载（Providers）而非设置区内：Esc/返回工作台会卸载设置布局，唯有更高层能观测到"离开凭证页"的
// pathname 变化。app 层禁依赖 store（boundaries），故清理逻辑收敛在本 container 层。
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppStore } from '@/stores';

const CREDENTIALS_PATH = '/settings/credentials';

export function PendingCloneReturnGuard(): null {
  const pathname = usePathname();
  const setPendingProjectCreate = useAppStore((s) => s.setPendingProjectCreate);

  useEffect(() => {
    // 只按 pathname 变化触发；用 getState() 读取当前值而非订阅 —— 否则创建流 setPendingProjectCreate
    // 会被当作触发源、在跳转到凭证页之前就把刚写入的回程态清掉。命中凭证页时从不清（含从创建流跳入的
    // 首帧），故对 StrictMode 开发期双跑（mount→cleanup→mount）也安全。
    if (!pathname.startsWith(CREDENTIALS_PATH)) {
      if (useAppStore.getState().pendingProjectCreate !== null) {
        setPendingProjectCreate(null);
      }
    }
  }, [pathname, setPendingProjectCreate]);

  return null;
}
