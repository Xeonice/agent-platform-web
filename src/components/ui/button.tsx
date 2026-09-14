// shadcn/ui Button（代码入仓，非黑盒，07 §1）。UI 库层，view/app 可 import。
//
// 与 shadcn 官方 new-york 版（`https://ui.shadcn.com/r/styles/new-york/button.json`）
// 逐项对过。**结构一律照官方**：`asChild`(Slot)、`whitespace-nowrap`、`[&_svg]` 三条
// 图标规则、六个 variant、四个 size。
//
// ⚠️ **只有配色不照搬，因为本仓的 token 语义和 shadcn 默认不是一回事**：
//  · 官方 ghost 是 `hover:bg-accent hover:text-accent-foreground`。本仓 ghost 保留
//    `hover:bg-muted`：按钮的悬停反馈与全站其余可点区域同一档，而 `accent` 这一档
//    留给「当前项」（菜单键盘焦点这类）—— 两者在本仓不是同一个视觉层级。
//  · 官方 focus 环是 `ring-1 ring-ring`。本仓用 `ring-2 ring-primary`：更粗、对比更高，
//    ⛔ 不为了"和官方一致"把可见度调低。
//
// ⓘ 2026-09-14 之前这里还记着「`text-accent-foreground` 在本仓根本不存在」—— 那是
//   tailwind.config.ts 把 accent 配成单值留下的缺陷，现已修复（accent 改为
//   `{DEFAULT, foreground}` 成对映射到 `--accent-surface`），这条不再成立。
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/_shared/utils';

const buttonVariants = cva(
  // `[&_svg]` 三条来自官方：图标统一 16px、不收缩、不吃指针事件（否则点在图标上
  // 事件 target 是 svg，一些依赖 currentTarget 的处理会错位）。
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:opacity-90',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:opacity-90',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  /** 官方同名 prop：渲染成子元素（`<Link>`/`<a>`）而不是 `<button>`，不多套一层 DOM。 */
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
