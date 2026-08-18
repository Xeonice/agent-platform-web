// 设置页布局壳（F21-3 §2/§3）：左侧菜单 slot + 右侧内容区。进入设置隐藏工作台任务侧栏/终端区
// （本布局不渲染它们，天然隐藏，07 §7.2）。纯展示、props 驱动、零副作用；跨三子页复用。
import type { ReactNode } from 'react';

export interface SettingsLayoutProps {
  /** 左侧菜单（SettingsMenu.view）。 */
  menu: ReactNode;
  children: ReactNode;
}

export function SettingsLayoutView({ menu, children }: SettingsLayoutProps) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      {menu}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-6">{children}</div>
      </main>
    </div>
  );
}
