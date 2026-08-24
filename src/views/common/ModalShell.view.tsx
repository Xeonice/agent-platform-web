// 弹层外壳（F21-2 §N.0「两个真弹层，形态对称」）：标题 + [✕] + 内容插槽。纯展示、props 驱动、零副作用。
//
// ⚠️ **形态是刻意与 `ConfirmDialog.view` 逐字对齐的**：同一份
// `fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4`。
// 本轮要修的病根就是"两个新建动作长得不一样、其中一个根本不是弹层"——
// 新建项目此前被 `WorkbenchContainer` return 成主区内容（`currentModal` 这个名字是假的），
// 新建任务则连入口都没有，只是沙箱为空时的兜底渲染。两个都改走这一个壳，形态才对称。
//
// Esc 关闭**不在本层**：views/ 禁 useEffect（07 §3 规则 2），而挂在弹层 DOM 上的
// `onKeyDown` 只有焦点已经进了弹层才收得到 —— 那会让 Esc 时灵时不灵。
// 由 container 调 `useEscapeKey`（hooks/）统一处理。
import type { ReactNode } from 'react';

export interface ModalShellProps {
  /** 弹层标题；同时作为 `aria-label`（读屏用户听到的就是它）。 */
  title: string;
  /** 副标题：用来交代上下文（如「在 ProjectA 中发起」）。 */
  subtitle?: string;
  /**
   * 关闭（[✕] / 遮罩点击 / container 的 Esc 都走它）。
   * `busy` 为真时**不触发**——创建中被误关会留下一个用户以为没发生过的请求。
   */
  onClose: () => void;
  busy?: boolean;
  /** 便于测试与 e2e 定位具体是哪一个弹层（两个弹层形态一致，靠它区分）。 */
  testId: string;
  children: ReactNode;
}

export function ModalShellView({
  title,
  subtitle,
  onClose,
  busy = false,
  testId,
  children,
}: ModalShellProps) {
  const close = (): void => {
    if (!busy) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testId}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // 只有点在遮罩本身才关；点在弹层内部（冒泡上来的）不关。
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-y-auto rounded-lg border border-border bg-background">
        <div className="flex items-start gap-3 border-b border-border px-5 py-3">
          <div className="min-w-0 flex-1 text-left">
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle !== undefined && subtitle !== '' && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            aria-label="关闭"
            disabled={busy}
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            onClick={close}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
