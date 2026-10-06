// 向导专用的不可关闭 Dialog，与普通弹层共用 Radix/shadcn 实现。
// open 恒为 true，不提供 onOpenChange，Esc/遮罩无法将其关闭；初始化完成由 AppBootGate 卸载。
// 若将来接入 onOpenChange，必须同时处理关闭限制并补充行为回归。
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
