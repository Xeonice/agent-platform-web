// v2终端画布：两套主题恒黑、满幅、无相框；ref始终指向xterm挂载节点。
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
          'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[var(--terminal-bg)]',
          className,
        )}
        {...shellProps}
      >
        <div
          ref={ref}
          data-slot="terminal-canvas"
          data-testid={canvasTestId}
          className={cn(
            'min-h-0 min-w-0 flex-1 bg-[var(--terminal-bg)] px-[var(--v2-term-pad-x)] py-[var(--v2-term-pad-y)]',
            canvasClassName,
          )}
        />
      </div>
    );
  },
);
TerminalFrame.displayName = 'TerminalFrame';
