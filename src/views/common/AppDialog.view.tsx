// 应用弹层外壳（F21-2 §N.0「两个真弹层，形态对称」）。纯展示、props 驱动、零副作用。
//
// ⚠️ **2026-09-14：内部从手写 overlay 换成 shadcn `Dialog`（Radix）。** 原 `ModalShell.view`
// 自己画遮罩、自己判"点在遮罩上才关"、自己出 [✕]，而 Esc 与焦点陷阱要靠 container 另外调
// `useEscapeKey` + `useModalFocus` 两个 hook 接上 —— 一共四处协作才凑齐一个弹层该有的行为，
// 少接一处就是"Esc 时灵时不灵"或"焦点留在背后的终端里"。Radix 把这四件事一并管了。
//
// **API 与 `ModalShell` 保持一致**（title / subtitle / onClose / busy / testId / children），
// 这样四个调用点只换组件名，⛔ 不用各自重写一遍开合与守卫逻辑。
//
// ⚠️ `busy` 是**真守卫不是样式**：创建中被误关会留下一个用户以为没发生过的请求。
// 所以 busy 时 Esc / 点遮罩 / 点 [✕] 三条路径全部拦掉（前两条靠 Radix 的
// `onEscapeKeyDown` / `onInteractOutside` 里 `preventDefault`，第三条靠按钮 disabled）。
//
// ⛔ 不要拿它替换 `BlockingDialog`：那个是**不可关闭**的向导壳（三个守卫恒 preventDefault
// 且不接 `onOpenChange`），本组件是可关闭弹层，两者语义相反。见 `blocking-dialog.tsx`。
import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';

export interface AppDialogProps {
  /** 弹层标题；同时作为读屏用户听到的名字（Radix 用 `DialogTitle` 关联 `aria-labelledby`）。 */
  title: string;
  /** 副标题：用来交代上下文（如「在 ProjectA 中」）。 */
  subtitle?: string;
  /**
   * 关闭（[✕] / 遮罩点击 / Esc 都走它）。
   * `busy` 为真时**不触发**——创建中被误关会留下一个用户以为没发生过的请求。
   */
  onClose: () => void;
  busy?: boolean;
  /** 便于测试与 e2e 定位具体是哪一个弹层（形态一致，靠它区分）。 */
  testId: string;
  children: ReactNode;
}

export function AppDialogView({
  title,
  subtitle,
  onClose,
  busy = false,
  testId,
  children,
}: AppDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-testid={testId}
          /*
           * ⚠️ Radix 这个版本的 `DialogPrimitive.Content` **不会自己加 `aria-modal`**
           * （`dialog.tsx` / `blocking-dialog.tsx` 两份共享封装同样没有）—— 它把这一位留给
           * 调用方显式声明，不是漏了。`ModalShellView` 此前手写了这个属性，这里照抄，
           * ⛔ 不能指望换个组件就白拿（`SandboxTerminalContainer` 的同类弹层踩过同一处）。
           */
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border border-border bg-background focus:outline-none"
          // busy 时 Esc 与点遮罩都不关（见文件头：这是守卫，不是样式）。
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <div className="flex items-start gap-3 border-b border-border px-5 py-3">
            <div className="min-w-0 flex-1 text-left">
              <DialogPrimitive.Title className="text-base font-semibold">
                {title}
              </DialogPrimitive.Title>
              {/*
                ⚠️ Description 只在真有副标题时渲染。Radix 缺 Description 会在控制台告警，
                但**编一句描述出来**比告警更糟 —— 读屏用户会听到一句没信息量的废话。
              */}
              {subtitle !== undefined && subtitle !== '' && (
                <DialogPrimitive.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                  {subtitle}
                </DialogPrimitive.Description>
              )}
            </div>
          </div>
          {children}
          {/*
            ⚠️ **不用共享 `DialogContent` 的内置关闭按钮**：它的无障碍名是英文 "Close"，
            而全仓（含 e2e）按 `{ name: '关闭' }` 找它。手写 `DialogPrimitive.Close` 保住中文名。
            ⚠️ **DOM 顺序：关闭按钮放最后**（视觉上用 `absolute` 摆回右上角）—— Radix 的自动
            聚焦取"容器内第一个可聚焦元素"，顺序反了会把首次打开的焦点落在 [✕] 上，回车直接
            把弹层关了。两条都与 `SandboxTerminalContainer` 的同类弹层同源。
          */}
          <DialogPrimitive.Close
            aria-label="关闭"
            disabled={busy}
            data-modal-close=""
            className="absolute right-4 top-3 rounded px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
