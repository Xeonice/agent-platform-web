// 初始化向导的外壳（F21-8 §2/§3）：四步指示 + 内容插槽 + 底部导航。纯展示、props 驱动、零副作用。
//
// ⛔⛔ **这是全局 Esc 分层规则（P20 §8.4）的唯一例外，而且是刻意的。**
//
//  · **没有 [取消]**：向导是**放行卡点**，不是一个可以关掉的弹层。取消它之后没有"回到哪里"
//    —— 后面根本没有应用（`AppBootGate` 在 `initialized === false` 时不挂载工作台）。
//    一个按下去什么都不会发生的 [取消] 比没有它更糟。
//  · **没有 Esc 逃逸**：本壳用的是 `BlockingDialog`（design/design-notes.md §1「弹层组件
//    选型」+ §4 Phase 0 第 6 件）——Esc / 点遮罩外 / 遮罩外 pointerdown 三个入口都在
//    `blocking-dialog.tsx` 里被 `preventDefault` 拦住，⛔ 谁要在这里加一个 `onClose`/
//    `onCancel`，请先回答"关掉之后用户看到什么"——答案是一张白屏。全站其余弹层的 Esc
//    行为在 `hooks/_shared/useEscapeKey.ts`，那条规则**不适用于本文件**，这是唯一的豁免点。
//  · 也**没有遮罩点击关闭**：同一条理由。
//
// ⚠️ **本壳真正的"关闭出口"是被父组件卸载，⛔ 不是把 `open` 拨回 `false`。** `BlockingDialog`
// 拿到的 `open` 恒为 `true`——本壳只在 `AppBootGate.initialized === false` 时才会被渲染，
// 一旦初始化完成，`AppBootGate` 直接不再渲染 `InitWizardContainer`（不是把某个 `open` prop
// 翻转成 false），整棵子树（连同这层 `BlockingDialog`）随 React 卸载一起消失。
// ⇒ **没有必要给 `BlockingDialog` 接 `onOpenChange`**：Radix 内部因 Esc/点遮罩触发的
// `onDismiss()` 落到一个没有回调的受控 Root 上本来就是空操作（`blocking-dialog.tsx` 顶部
// 那条注释），而"正规出口"走的是完全不同的一条路径——组件根本不在树里了，无需通过
// `open` 状态机去关它。⛔ 谁想通过"传 `open={someState}` + `onOpenChange`"给本壳加一个能被
// 翻转的关闭状态，请先看这条注释：那样接线会让"靠构造关不掉"这层保护当场消失，
// 而 `AppBootGate` 现有的卸载机制已经是一条足够、且不引入新攻击面的正规出口。
//
// ⚠️ 四步指示条上 Step2「代理配置」在出网全通过时标成「可跳过」而**不隐藏**：用户要看得到
// 总共几步、自己在第几步。中途出网变差时它会自己变回必经步骤，而步数不跳动。
import type { ReactNode } from 'react';
import { BlockingDialog } from '@/components/ui/blocking-dialog';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { InitStepModel } from '@/types/init';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';

export interface InitWizardShellProps {
  steps: InitStepModel[];
  title: string;
  /** 这一步在做什么，一句话。 */
  description: string;
  children: ReactNode;
  /** 下一步 / 完成；`undefined` ⇒ 不渲染（例如最后一步由内容区自己给 [确认，开始使用]）。 */
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  nextDescribedBy?: string;
  nextBusy?: boolean;
  /** 上一步；`undefined` ⇒ 不渲染（第一步）。 */
  onBack?: () => void;
  /** 底部左侧的补充说明（如 [稍后配置] 的后果）。 */
  footerNote?: ReactNode;
}

export function InitWizardShellView({
  steps,
  title,
  description,
  children,
  onNext,
  nextLabel = '下一步',
  nextDisabled = false,
  nextDescribedBy,
  nextBusy = false,
  onBack,
  footerNote,
}: InitWizardShellProps) {
  const current = steps.find((step) => step.current)?.ordinal ?? 1;
  return (
    <BlockingDialog
      open
      className="items-center overflow-hidden bg-background p-4 sm:px-8 sm:py-10"
    >
      <main
        data-testid="init-wizard"
        className="flex h-full min-h-0 w-full max-w-3xl flex-col gap-5"
      >
        <div className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-foreground font-semibold text-background"
          >
            A
          </span>
          Agent 管理平台
          <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
            本机
          </span>
        </div>
        <header className="shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <DialogTitle asChild>
              <h1 className="text-2xl font-semibold tracking-tight">平台初始化 · 共 5 步</h1>
            </DialogTitle>
            <span className="text-xs tabular-nums text-muted-foreground">
              第 {String(current)} / 5 步
            </span>
          </div>
          <DialogDescription asChild>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              一次性设置：先确认这台机器能联网、备齐沙箱镜像，再配一个你自己的模型帐号，最后看一眼本机资源。
              只有配模型帐号那一步需要你离开这一页；之后所有配置都能在「系统状态」里改。
            </p>
          </DialogDescription>
        </header>
        <ol data-testid="init-wizard-steps" className="grid shrink-0 grid-cols-5 gap-2 text-xs">
          {steps.map((step) => (
            <li
              key={step.key}
              data-testid={`init-step-${step.key}`}
              data-current={step.current ? 'true' : 'false'}
              data-done={step.done ? 'true' : 'false'}
              data-skipped={step.skipped ? 'true' : 'false'}
              aria-current={step.current ? 'step' : undefined}
              className={
                step.current
                  ? 'min-w-0 font-medium text-foreground'
                  : 'min-w-0 text-muted-foreground'
              }
            >
              <span
                aria-hidden="true"
                className={`mb-2 block h-1 rounded-full ${step.current || step.done ? 'bg-primary' : step.skipped ? 'bg-warning' : 'bg-muted'}`}
              />
              {step.done ? (
                <Check aria-hidden="true" className="mr-1 inline size-3" />
              ) : step.skipped ? (
                <AlertTriangle aria-hidden="true" className="mr-1 inline size-3 text-warning" />
              ) : null}
              {step.label}
              {step.active ? '' : '（可跳过）'}
              {step.done ? (
                <span className="sr-only">（已完成）</span>
              ) : step.skipped ? (
                <span className="sr-only">（走过、没有完成）</span>
              ) : null}
            </li>
          ))}
        </ol>
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--v2-shadow-raised)]">
          <header className="shrink-0 px-5 pb-4 pt-5 sm:px-6">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          </header>
          <div
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-5 sm:px-6"
            data-testid="init-wizard-body"
          >
            {children}
          </div>
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1 text-[13px] text-muted-foreground">{footerNote}</div>
            <div className="ml-auto flex items-center gap-2">
              {onBack === undefined ? null : (
                <Button type="button" variant="outline" disabled={nextBusy} onClick={onBack}>
                  上一步
                </Button>
              )}
              {onNext === undefined ? null : (
                <Button
                  type="button"
                  onClick={onNext}
                  disabled={nextDisabled}
                  aria-describedby={nextDescribedBy}
                >
                  {nextBusy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  {nextLabel}
                </Button>
              )}
            </div>
          </footer>
        </section>
      </main>
    </BlockingDialog>
  );
}
