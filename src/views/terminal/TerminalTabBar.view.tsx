import { useState } from 'react';
// 终端标签栏（P21-1 §3/§6，08 §5）：同一个 Task 的多路会话 + [+ 新终端]。
// 纯展示，props 驱动，零副作用（07 §3 规则 1）。
export interface TerminalTabItem {
  sessionId: string;
  label: string;
  /** Agent 那个恒为 false —— 关掉它并不会停下任务，给个 [×] 只会误导（裁决 D-15）。 */
  closable: boolean;
}

/** [+ 新终端] 下拉里的一项。`runtimeId` 缺席 = 纯终端。 */
export interface TerminalLaunchItem {
  runtimeId?: string;
  label: string;
}

export interface TerminalTabBarProps {
  tabs: TerminalTabItem[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  /** `runtimeId` 缺席 = 开一个纯终端。 */
  onNewTerminal: (runtimeId?: string) => void;
  /**
   * [+ 新终端] 能开什么（06 §5.6）。
   *
   * ⛔ **这里只列这个沙箱里真的能跑的**（`SandboxDto.availableRuntimes` 派生）——
   * 没注入凭证的 CLI 列出来就是一个点开必然失败的选项，而"点了再报错"正是本切片
   * 要避免的形状。
   *
   * 只有一项（纯终端）时不渲染下拉，[+ 新终端] 退回成一个直接建纯终端的按钮 ——
   * 一个只有一个选项的菜单是纯粹的多余一次点击。
   */
  launchOptions?: TerminalLaunchItem[];
  /**
   * 「这个任务下还有没有别的终端，现在**查不到**」（06 §5.5 的第三态）。
   *
   * ⛔ 它与"确认没有别的终端"必须是**两句不同的话**。后端分不清时前端只画出现有标签、
   * 什么都不说的话，用户看到的就是一句没说出口的假话：他可能有三个正跑着构建的终端
   * 在沙箱里，而界面在暗示"你只有这一个"。⇒ 就地说出来，并且说清这只是**查不到**。
   */
  inventoryUnavailable?: boolean;
}

export function TerminalTabBarView({
  tabs,
  activeSessionId,
  onSelect,
  onClose,
  onNewTerminal,
  launchOptions = [],
  inventoryUnavailable = false,
}: TerminalTabBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  // 只有"纯终端"一项时不值得给一个菜单（多一次点击换不到任何选择）。
  const runtimeChoices = launchOptions.filter((o) => o.runtimeId !== undefined);
  const hasChoice = runtimeChoices.length > 0;
  return (
    <div
      role="tablist"
      aria-label="终端标签"
      data-testid="terminal-tab-bar"
      className="flex items-end gap-1 border-b border-border bg-background px-2 pt-1"
    >
      {tabs.map((tab) => {
        const active = tab.sessionId === activeSessionId;
        return (
          <div
            key={tab.sessionId}
            className={[
              'flex items-center gap-1.5 rounded-t-md px-3 text-xs',
              active
                ? 'border-b-2 border-primary bg-muted text-foreground'
                : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`terminal-tab-${tab.sessionId}`}
              className="h-8"
              onClick={() => {
                onSelect(tab.sessionId);
              }}
            >
              {tab.label}
            </button>
            {/*
              ⛔ Agent 标签**不渲染** [×]，而不是渲染一个禁用的。
              一个灰掉的 [×] 仍然在说"这里本来可以关"，用户会去找怎么解禁；
              而真相是它压根不该关——关掉不会停下任务，只会让人以为停了。
            */}
            {tab.closable ? (
              <button
                type="button"
                aria-label={`关闭 ${tab.label}`}
                data-testid={`terminal-tab-close-${tab.sessionId}`}
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onClose(tab.sessionId);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
      {/*
        ⚠️ 文案是「+ 新终端」，**不是**「+ 新建」。左下角那个 [＋ 新任务] 是发起一个
        新 Task（起一台机器、跑一个 agent），这里只是在**同一个** Task 里多开一个
        终端——两者曾经都叫"新建"，在同一屏上造成过歧义（design-notes 2026-09）。
      */}
      <div className="relative ml-1">
        <button
          type="button"
          data-testid="terminal-tab-new"
          aria-haspopup={hasChoice ? 'menu' : undefined}
          aria-expanded={hasChoice ? menuOpen : undefined}
          className="h-8 rounded-t-md px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => {
            // 没有别的可选 ⇒ 直接开一个纯终端（见 `launchOptions` 的注释）。
            if (hasChoice) setMenuOpen((v) => !v);
            else onNewTerminal();
          }}
        >
          + 新终端{hasChoice ? ' ▾' : ''}
        </button>
        {hasChoice && menuOpen ? (
          <div
            role="menu"
            data-testid="terminal-launch-menu"
            className="absolute right-0 top-8 z-10 min-w-32 rounded-md border border-border bg-popover py-1 shadow-md"
          >
            {launchOptions.map((option) => (
              <button
                key={option.runtimeId ?? '__shell__'}
                type="button"
                role="menuitem"
                data-testid={`terminal-launch-${option.runtimeId ?? 'shell'}`}
                className="block w-full px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false);
                  onNewTerminal(option.runtimeId);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {/*
        第三态就地说出来。⚠️ 文案里**不许**出现"没有别的终端"这类断言 —— 我们不知道。
        也不说"出错了"：任务本身与现有这些标签都好好的，坏掉的只是"清点"这一件事。
      */}
      {inventoryUnavailable ? (
        <span
          role="status"
          data-testid="terminal-inventory-unavailable"
          className="ml-auto self-center pr-1 text-xs text-amber-400"
          title="重新打开这个任务会再查一次"
        >
          这个任务下是否还有别的终端，现在查不到
        </span>
      ) : null}
    </div>
  );
}
