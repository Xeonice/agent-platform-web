import type { ReactNode } from 'react';
import { Bot, ChevronDown, Plus, Terminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface TerminalTabItem {
  sessionId: string;
  label: string;
  /** Agent 会话不可关闭；关闭标签不会停止任务。 */
  closable: boolean;
}
export interface TerminalLaunchItem {
  runtimeId?: string;
  label: string;
}
export interface TerminalTabBarProps {
  tabs: TerminalTabItem[];
  activeSessionId: string;
  onSelect: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
  onNewTerminal: (runtimeId?: string) => void;
  launchOptions?: TerminalLaunchItem[];
  inventoryUnavailable?: boolean;
  disabledReason?: string;
  toolsSlot?: ReactNode;
}

export function TerminalTabBarView({
  tabs,
  activeSessionId,
  onSelect,
  onClose,
  onNewTerminal,
  launchOptions = [],
  inventoryUnavailable = false,
  disabledReason,
  toolsSlot,
}: TerminalTabBarProps) {
  const hasChoice = launchOptions.some((option) => option.runtimeId !== undefined);
  const newButtonClass =
    'h-7 shrink-0 gap-1.5 rounded-md px-2 text-sm font-normal text-[var(--v2-foreground-muted)]';
  return (
    <>
      <div
        data-testid="terminal-tab-bar"
        className="flex h-[var(--v2-shell-termbar-h)] min-w-0 shrink-0 items-center gap-1 border-b border-[var(--v2-border-subtle)] bg-[var(--v2-canvas)] px-4"
      >
        <div
          role="tablist"
          aria-label="终端标签"
          className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = tab.sessionId === activeSessionId;
            const Icon = tab.closable ? Terminal : Bot;
            return (
              <div
                key={tab.sessionId}
                className={`group flex h-7 shrink-0 items-center rounded-md ${active ? 'bg-[var(--v2-fill-selected)] text-foreground' : 'text-[var(--v2-foreground-muted)] hover:bg-[var(--v2-fill)] hover:text-foreground'}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`terminal-tab-${tab.sessionId}`}
                  className={`flex h-full items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm ${active ? 'font-medium' : 'font-normal'}`}
                  onClick={() => {
                    onSelect(tab.sessionId);
                  }}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                  {tab.label}
                </button>
                {tab.closable && (
                  <button
                    type="button"
                    aria-label={`关闭 ${tab.label}`}
                    title={`关闭 ${tab.label}`}
                    data-testid={`terminal-tab-close-${tab.sessionId}`}
                    className={`-ml-1 mr-1 grid size-5 shrink-0 place-items-center rounded-sm text-[var(--v2-foreground-muted)] hover:bg-[var(--v2-fill-active)] hover:text-foreground ${active ? '' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'}`}
                    onClick={() => {
                      onClose(tab.sessionId);
                    }}
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {disabledReason !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className={newButtonClass}
            aria-disabled
            aria-describedby="terminal-new-disabled"
            onClick={() => undefined}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            新终端
            <span id="terminal-new-disabled" className="sr-only">
              {disabledReason}
            </span>
          </Button>
        ) : hasChoice ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="terminal-tab-new"
                className={newButtonClass}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                新终端
                <ChevronDown aria-hidden="true" className="-ml-0.5 size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              data-testid="terminal-launch-menu"
              className="min-w-32"
            >
              {launchOptions.map((option) => (
                <DropdownMenuItem
                  key={option.runtimeId ?? '__shell__'}
                  data-testid={`terminal-launch-${option.runtimeId ?? 'shell'}`}
                  onSelect={() => {
                    onNewTerminal(option.runtimeId);
                  }}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            data-testid="terminal-tab-new"
            className={newButtonClass}
            onClick={() => {
              onNewTerminal();
            }}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            新终端
          </Button>
        )}
        {toolsSlot}
      </div>
      {inventoryUnavailable && (
        <p
          role="status"
          data-testid="terminal-inventory-unavailable"
          className="shrink-0 border-b border-[var(--v2-border-subtle)] bg-[var(--v2-canvas)] px-4 py-1 text-xs text-[var(--v2-status-warn-fg)]"
          title="重新打开这个任务会再查一次"
        >
          这个任务下是否还有别的终端，现在查不到
        </p>
      )}
    </>
  );
}
