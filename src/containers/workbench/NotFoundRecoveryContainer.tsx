'use client';

import { useUnknownRouteRecovery } from '@/hooks/workbench/useUnknownRouteRecovery';

export function NotFoundRecoveryContainer() {
  useUnknownRouteRecovery();
  return (
    <p role="status" className="p-6 text-sm">
      这个地址没有对应的页面，正在打开项目总览。
    </p>
  );
}
