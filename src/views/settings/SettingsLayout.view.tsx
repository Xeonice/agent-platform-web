// 设置页布局壳（F21-3 §2/§3）：左侧菜单 slot + 右侧内容区。进入设置隐藏工作台任务侧栏/终端区
// （本布局不渲染它们，天然隐藏，07 §7.2）。纯展示、props 驱动、零副作用；跨三子页复用。
//
// ⚠️ **响应式：`sm:` 以下菜单从"侧边栏"变成"顶部条"**（配合 `SettingsMenuView` 的窄屏
// 布局）——390px 下 `flex-row` + 固定宽度侧边栏会把内容区挤到不到 120px；`flex-col`
// 让菜单条占满宽度、内容区在它下方拿到全部宽度。
//
// ⚠️ **内容区宽度分两档，`width` 由子页自己声明**：
//   · `form`（默认，`max-w-3xl`）—— 凭证 / 镜像这类**表单**页。表单行不该拉到满屏宽，
//     一行输入框横跨 1400px 会让 label 与 input 离得太远、眼睛要横扫。
//   · `wide`（`max-w-none`）—— 系统状态这类**看板**页。它是两栏卡片栅格（`lg:grid-cols-2`），
//     压在 768px 里等于每列只剩 ~340px，pill 文字被截断、卡片内大量换行。
//     ⛔ 不要把两者统一成一个值：它们要的东西是相反的。
import type { ReactNode } from 'react';

export interface SettingsLayoutProps {
  /** 左侧菜单（SettingsMenu.view）。 */
  menu: ReactNode;
  /** 内容区宽度档位，见文件头。缺省 `form`。 */
  width?: 'form' | 'wide';
  children: ReactNode;
}

export function SettingsLayoutView({ menu, width = 'form', children }: SettingsLayoutProps) {
  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground sm:flex-row">
      {menu}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div
          data-width={width}
          className={`mx-auto w-full p-6 ${width === 'wide' ? 'max-w-none' : 'max-w-3xl'}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
