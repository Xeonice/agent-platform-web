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
    // ⚠️ `open` 恒为 `true`：本壳的挂载/卸载本身就是它的开关，见文件头那条大注释。
    //    `BlockingDialog` 内部已经把 role="dialog"/aria-modal/焦点陷阱/背景滚动锁定全部
    //    接好，这里不用再手写。
    <BlockingDialog open className="items-center justify-center bg-background p-4">
      <section
        data-testid="init-wizard"
        className="flex w-full max-w-3xl flex-col gap-4 self-center rounded-lg border border-border bg-background p-6"
      >
        <header className="flex flex-col gap-3">
          {/*
            ⚠️ **这是用户看到的第一行字**，此前只有「平台初始化」四个字 —— 它说不出
            "要做什么"，也说不出"要多久"，于是第一反应是"还要装多久"。
            ⛔ **不许在这里承诺时间**（"约 5 分钟"是编的）：说得出的是**步数**与
            **哪一步需要你离开这一页**，这两件都是真的。
            ⚠️ 用 `DialogTitle`/`DialogDescription`（`asChild` 保留原有的 h1/p 标签与样式）
            让 Radix 自动把 `aria-labelledby`/`aria-describedby` 接到 `BlockingDialog` 的
            `DialogPrimitive.Content` 上——这是 Radix 内部按同一个 `Dialog.Root` context
            自动关联的，⛔ 不需要（也不应该）改 `blocking-dialog.tsx` 去手动传一个
            `aria-label`。
          */}
          <div className="flex flex-col gap-1">
            <DialogTitle asChild>
              <h1 className="text-lg font-semibold">平台初始化 · 共 5 步</h1>
            </DialogTitle>
            <DialogDescription asChild>
              <p className="text-sm text-muted-foreground">
                一次性设置：先确认这台机器能联网、备齐沙箱镜像，再配一个你自己的模型帐号，最后看一眼本机资源。
                只有配模型帐号那一步需要你离开这一页；之后所有配置都能在「设置 → 系统状态」里改。
              </p>
            </DialogDescription>
          </div>
          <ol data-testid="init-wizard-steps" className="flex flex-wrap gap-2 text-xs">
            {steps.map((s) => (
              <li
                key={s.key}
                data-testid={`init-step-${s.key}`}
                data-current={s.current ? 'true' : 'false'}
                data-done={s.done ? 'true' : 'false'}
                data-skipped={s.skipped ? 'true' : 'false'}
                className={
                  s.current
                    ? 'rounded border border-primary px-2 py-1 font-medium text-primary'
                    : 'rounded border border-border px-2 py-1 text-muted-foreground'
                }
              >
                {/* ⚠️ 三态要分得开：达成 ✅ / 走过没达成 ⚠️ / 还没走到（无标记）。
                    两者共用"无标记"时，用户没法从指示条上看出自己跳过了什么。 */}
                {s.done ? '✅ ' : s.skipped ? '⚠️ ' : ''}
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
    </BlockingDialog>
  );
}
