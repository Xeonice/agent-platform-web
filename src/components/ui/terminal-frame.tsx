// 终端仪表壳（design/design-notes.md §1 问题 4 / §4 Phase 0 第 5 件）：
// 画布（真正跑 xterm 的黑色区域）恒黑不变；仪表壳（相框）跟随主题——暗色下维持原状，
// 亮色下改用浅灰相框。两套颜色都来自 --terminal-chrome / --terminal-chrome-border
// 这两个随 .dark 切换的 CSS 变量（globals.css），组件本身不判断主题，只消费变量。
//
// v1 曾把仪表壳做成固定深色、不随主题变——这个设定已被推翻（见设计稿原文）：亮色模式
// 下一块恒定的深色壳会显得比周边浅色 UI 重、像贴上去的。
import * as React from 'react';
import { cn } from '@/lib/_shared/utils';

export interface TerminalFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 画布节点的 className（不是外层相框的）。 */
  canvasClassName?: string;
  /**
   * 画布节点的 `data-testid`。⚠️ 组件的 `ref` 转发给的是**画布**，不是外层相框——
   * `useTerminalInstance.attach()` 需要拿到的是这个节点。
   */
  canvasTestId?: string;
}

export const TerminalFrame = React.forwardRef<HTMLDivElement, TerminalFrameProps>(
  ({ className, canvasClassName, canvasTestId, ...shellProps }, ref) => {
    return (
      <div
        data-slot="terminal-shell"
        className={cn(
          'flex h-full w-full flex-col gap-2 rounded-lg border p-2',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
          'bg-[var(--terminal-chrome)] border-[var(--terminal-chrome-border)]',
          className,
        )}
        {...shellProps}
      >
        <div
          ref={ref}
          data-slot="terminal-canvas"
          data-testid={canvasTestId}
          className={cn(
            'min-h-0 flex-1 rounded-md border border-white/[0.06] bg-[var(--terminal-bg)]',
            canvasClassName,
          )}
        />
      </div>
    );
  },
);
TerminalFrame.displayName = 'TerminalFrame';
