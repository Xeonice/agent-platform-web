// 向导壳体专用的不可关闭 Dialog（design/design-notes.md §1「弹层组件选型」+ §4 Phase 0
// 第 6 件）。
//
// 决策记录（照抄设计稿理由，不是重新设计）：v1 曾认为"向导不能用 Radix Dialog，因为默认
// 的 Esc/遮罩关闭行为跟'不可取消'冲突"——这个判断站不住：Radix 官方支持在
// `onEscapeKeyDown`/`onInteractOutside` 里 `event.preventDefault()` 拦下关闭，是文档里的
// 标准用法，不是 hack。于是向导壳体与任务弹层（普通 `Dialog`，见 `./dialog.tsx`）**用同一个
// shadcn Dialog**，区别只在这一份拦住了关闭事件——不是两套写法，全站只维护一套弹层实现。
//
// ⚠️ **关不掉是靠"没有出口"，不是靠拦事件。**
//
// `open` 由调用方传死为 `true`，且**不传 `onOpenChange`** —— Radix 在 Esc / 点遮罩外时
// 走的是 `if (!event.defaultPrevented) onDismiss()`，而 `onDismiss` 最终调的是
// `onOpenChange?.(false)`：回调不存在，这一步天然是空操作。于是没有任何路径能把 `open`
// 拨回 `false`。
//
// 向导的真正关闭方式是**卸载**：`AppBootGate` 在 `initialized` 变 `true` 时直接不再渲染
// `InitWizardContainer`，整棵子树（含本组件）随 React 卸载消失。
//
// ⛔ **曾经这里还挂着 `onEscapeKeyDown`/`onInteractOutside`/`onPointerDownOutside` 三个
//    `preventDefault`，已删。** 它们在生产里**永远不会触发**（没有 `onOpenChange` 可拦），
//    实测把三条全摘掉，行为级 story 一条都不红 —— 也就是说那是一组永不执行的代码，外加
//    一组假装在测它的用例。留着只会让人以为"关不掉"这件事是它们保证的，从而在某天接上
//    `onOpenChange` 时以为仍然安全。
//
// ⚠️ ⇒ **谁要把它改成受控组件（传 `onOpenChange`），必须同时重新把关闭拦住**，
//    并且别指望现有用例会提醒你 —— 那时候要先补用例。
'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/_shared/utils';

export interface BlockingDialogProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}

export function BlockingDialog({ open, children, className }: BlockingDialogProps) {
  return (
    <Dialog open={open} modal>
      <DialogPortal>
        <DialogOverlay data-testid="blocking-dialog-overlay" />
        <DialogPrimitive.Content
          data-testid="blocking-dialog-content"
          className={cn(
            'fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background p-6 focus:outline-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
