// 根布局：只做 Provider + 全局样式装配（app 层不写业务逻辑，07 §2）。
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/app/providers';
import { AppBootGate } from '@/containers/init/AppBootGate';

export const metadata: Metadata = {
  title: 'Agent 管理平台',
  description: '云 Agent 管理平台前端',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="font-sans antialiased">
        {/*
          `AppBootGate` 挂在 `Providers` 之下、所有页面之上（F21-8 §2「判定位置」）。
          ⚠️ 它必须在**根**布局里：Next 的嵌套布局让所有路由（`/`、`/settings/*`）都是它的
          `children`，于是"未初始化时直接访问 `/settings/images` 也被拦下"是结构性成立的，
          **不需要一条 redirect**（§2「不做 redirect，避免与深链恢复打架」）。
        */}
        <Providers>
          <AppBootGate>{children}</AppBootGate>
        </Providers>
      </body>
    </html>
  );
}
