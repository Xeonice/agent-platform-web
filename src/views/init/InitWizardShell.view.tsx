// 初始化向导的外壳（F21-8 §2/§3）：四步指示 + 内容插槽 + 底部导航。纯展示、props 驱动、零副作用。
//
// ⛔⛔ **这是全局 Esc 分层规则（P20 §8.4）的唯一例外，而且是刻意的。**
//
//  · **没有 [取消]**：向导是**放行卡点**，不是一个可以关掉的弹层。取消它之后没有"回到哪里"
//    —— 后面根本没有应用（`AppBootGate` 在 `initialized === false` 时不挂载工作台）。
//    一个按下去什么都不会发生的 [取消] 比没有它更糟。
//  · **没有 Esc 逃逸**：本壳**不接** `useEscapeKey`，`InitWizardContainer` 也不接。
//    ⛔ 谁要在这里加一个 `onClose`/`onCancel`，请先回答"关掉之后用户看到什么"——
//    答案是一张白屏。全站其余弹层的 Esc 行为在 `hooks/_shared/useEscapeKey.ts`，
//    那条规则**不适用于本文件**，这是唯一的豁免点。
//  · 也**没有遮罩点击关闭**：同一条理由。
//
// ⚠️ 四步指示条上 Step2「代理配置」在出网全通过时标成「可跳过」而**不隐藏**：用户要看得到
// 总共几步、自己在第几步。中途出网变差时它会自己变回必经步骤，而步数不跳动。
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { InitStepModel } from '@/types/init';

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
  onBack,
  footerNote,
}: InitWizardShellProps) {
  return (
    // ⚠️ `role="dialog"` 但**没有** `onClose` —— 阻塞层，不是弹层（见文件头）。
    <div
      data-testid="init-wizard"
      role="dialog"
      aria-modal="true"
      aria-label="平台初始化"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-4"
    >
      <section className="flex w-full max-w-3xl flex-col gap-4 rounded-lg border border-border bg-background p-6">
        <header className="flex flex-col gap-3">
          <h1 className="text-lg font-semibold">平台初始化</h1>
          <ol data-testid="init-wizard-steps" className="flex flex-wrap gap-2 text-xs">
            {steps.map((s) => (
              <li
                key={s.key}
                data-testid={`init-step-${s.key}`}
                data-current={s.current ? 'true' : 'false'}
                data-done={s.done ? 'true' : 'false'}
                className={
                  s.current
                    ? 'rounded border border-primary px-2 py-1 font-medium text-primary'
                    : 'rounded border border-border px-2 py-1 text-muted-foreground'
                }
              >
                {s.done ? '✅ ' : ''}
                {String(s.ordinal)}. {s.label}
                {s.active ? '' : '（可跳过）'}
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </header>

        <div className="flex flex-col gap-3">{children}</div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">{footerNote}</div>
          <div className="flex items-center gap-2">
            {onBack === undefined ? null : (
              <Button type="button" variant="outline" onClick={onBack}>
                上一步
              </Button>
            )}
            {onNext === undefined ? null : (
              <Button type="button" onClick={onNext} disabled={nextDisabled}>
                {nextLabel}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
