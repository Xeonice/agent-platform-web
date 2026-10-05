import type { KeyboardEvent } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Search } from 'lucide-react';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import type { CommandSection } from '@/types/command';

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  sections: CommandSection[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
  onExecute: (id: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function CommandPaletteView({
  query,
  onQueryChange,
  sections,
  activeId,
  onActiveChange,
  onExecute,
  onKeyDown,
  onClose,
  onCloseAutoFocus,
}: Props) {
  const hasResults = sections.length > 0;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed left-1/2 top-[10vh] z-50 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 overflow-hidden rounded-[var(--v2-radius-xl)] border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-[var(--v2-shadow-modal)] focus:outline-none"
          data-testid="command-palette"
        >
          <DialogPrimitive.Title className="sr-only">查找任务、项目与动作</DialogPrimitive.Title>
          <div className="flex h-16 items-center gap-3 border-b border-[var(--v2-border-subtle)] px-4">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              role="combobox"
              aria-label="查找任务、项目与动作"
              aria-autocomplete="list"
              aria-expanded={hasResults}
              aria-controls={hasResults ? 'command-results' : undefined}
              aria-activedescendant={activeId === null ? undefined : `command-${activeId}`}
              value={query}
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
              onKeyDown={onKeyDown}
              placeholder="查找任务、项目或动作…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <DialogPrimitive.Close
              className="rounded border border-[var(--v2-border-subtle)] px-1.5 py-0.5 text-xs text-muted-foreground"
              aria-label="关闭查找"
            >
              Esc
            </DialogPrimitive.Close>
          </div>
          {hasResults ? (
            <div
              id="command-results"
              role="listbox"
              aria-label="匹配结果"
              className="max-h-[60vh] overflow-y-auto p-2"
            >
              {sections.map((section) => (
                <div key={section.group} role="group" aria-label={section.group}>
                  <h2 className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">
                    {section.group}
                  </h2>
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      id={`command-${item.id}`}
                      role="option"
                      aria-selected={activeId === item.id}
                      aria-disabled={item.disabledReason !== undefined}
                      onMouseMove={() => {
                        onActiveChange(item.id);
                      }}
                      onClick={() => {
                        onExecute(item.id);
                      }}
                      className={`flex min-h-10 cursor-default items-center gap-3 rounded-md px-2 py-2 text-sm ${activeId === item.id ? 'bg-[var(--v2-fill-selected)]' : ''} ${item.disabledReason !== undefined ? 'text-muted-foreground' : 'text-foreground'}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.name}</span>
                      {(item.disabledReason ?? item.description) && (
                        <span className="max-w-[50%] text-right text-xs text-muted-foreground">
                          {item.disabledReason ?? item.description}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p role="status" className="p-8 text-center text-sm text-muted-foreground">
              没有找到匹配“{query.trim()}”的结果
            </p>
          )}
          <p className="border-t border-[var(--v2-border-subtle)] px-4 py-2 text-xs text-muted-foreground">
            ↑ ↓ 选择 · Enter 打开 · Esc 关闭
          </p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
