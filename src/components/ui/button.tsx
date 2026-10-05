// Shared controls follow the approved v2 button sizes and focus ring.
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/_shared/utils';

const buttonVariants = cva(
  // `[&_svg]` 三条来自官方：图标统一 16px、不收缩、不吃指针事件（否则点在图标上
  // 事件 target 是 svg，一些依赖 currentTarget 的处理会错位）。
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-[var(--v2-focus-ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
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
        sm: 'h-8 rounded-md px-3 text-sm',
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
