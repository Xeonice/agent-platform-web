// 仅持有 <div ref> 容器（实例活在 registry，08 §7.4）。零副作用、零逻辑。
import { forwardRef } from 'react';
import { TerminalFrame } from '@/components/ui/terminal-frame';

export interface TerminalPaneProps {
  /** 空态：无选中会话时渲染引导文案而非空白（08 §2.2）。 */
  empty?: boolean;
  emptyHint?: string;
}

export const TerminalPaneView = forwardRef<HTMLDivElement, TerminalPaneProps>(
  ({ empty = false, emptyHint = '选择左侧的一个任务以打开终端' }, ref) => {
    if (empty) {
      return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {emptyHint}
        </div>
      );
    }
    // 画布仍是 ref 指向的那个 div（useTerminalInstance.attach 挂载点不变，08 §7.4，
    // TerminalFrame 的 ref 转发给画布不是外层相框）；外层相框跟随主题
    // （design-notes.md §1 问题 4），替换掉此前的 `bg-terminal` 简单 div。
    return <TerminalFrame ref={ref} canvasTestId="terminal-container" />;
  },
);
TerminalPaneView.displayName = 'TerminalPaneView';
