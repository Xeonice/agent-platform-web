// 初始化向导使用 BlockingDialog，不提供取消或 Esc 关闭出口。
// 初始化完成由 AppBootGate 卸载；步骤条保留完整步骤，可跳过项仍显示当前位置。
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
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[shadow:var(--v2-shadow-raised)]">
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
