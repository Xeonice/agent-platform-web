'use client';

import { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/_shared/utils';

export interface SearchSelectOption {
  value: string;
  label: string;
  secondary?: string;
  searchText?: string;
  disabled?: boolean;
  reason?: string;
  warning?: string;
}

export interface SearchSelectProps {
  id: string;
  value: string;
  options: readonly SearchSelectOption[];
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  searchLabel: string;
  emptyLabel: string;
  placeholder: string;
  fixedOption?: SearchSelectOption;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
  'aria-describedby'?: string;
}

/** shadcn's Radix Popover + Command composition, with exact local substring filtering. */
export function SearchSelect({
  id,
  value,
  options,
  onValueChange,
  onOpenChange,
  searchLabel,
  emptyLabel,
  placeholder,
  fixedOption,
  disabled = false,
  loading = false,
  loadingLabel = '正在加载…',
  className,
  'aria-describedby': describedBy,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [listId, setListId] = useState<string>();
  const [activeValue, setActiveValue] = useState('');
  const [boundary, setBoundary] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const tabTarget = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setQuery('');
      setFilterQuery('');
      onOpenChange?.(false);
    }
  }, [disabled, open, onOpenChange]);
  const search = filterQuery.trim().toLocaleLowerCase();
  const matches = options.filter((option) =>
    (option.searchText ?? option.label).toLocaleLowerCase().includes(search),
  );
  const selected =
    fixedOption?.value === value ? fixedOption : options.find((option) => option.value === value);
  const visibleOptions = fixedOption === undefined ? matches : [fixedOption, ...matches];
  const activeOption =
    visibleOptions.find((option) => !option.disabled && `option:${option.value}` === activeValue) ??
    visibleOptions.find((option) => !option.disabled);

  function changeOpen(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
    setQuery('');
    setFilterQuery('');
    setActiveValue(
      next && selected !== undefined && !selected.disabled ? `option:${selected.value}` : '',
    );
    composing.current = false;
    if (next) {
      setBoundary(
        trigger.current?.closest<HTMLElement>('[data-search-select-boundary]') ??
          trigger.current
            ?.closest<HTMLElement>('[data-testid="new-sandbox-panel"]')
            ?.querySelector<HTMLElement>('[data-search-select-boundary]') ??
          null,
      );
    }
  }

  function continueTab(backwards: boolean) {
    const scope = trigger.current?.closest('[role="dialog"]') ?? trigger.current?.parentElement;
    const controls = Array.from(
      scope?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      ) ?? [],
    ).filter(
      (element) =>
        !element.closest('[data-search-select-content]') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        !element.closest('[hidden]') &&
        element.tabIndex >= 0 &&
        (!(element instanceof HTMLInputElement) ||
          element.type !== 'radio' ||
          element.checked ||
          !scope?.querySelector(`input[type="radio"][name="${element.name}"]:checked`)),
    );
    const index = trigger.current === null ? -1 : controls.indexOf(trigger.current);
    const nextIndex = backwards ? index - 1 : index + 1;
    tabTarget.current = controls[(nextIndex + controls.length) % controls.length] ?? null;
    changeOpen(false);
  }

  return (
    <PopoverPrimitive.Root open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          ref={trigger}
          id={id}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open && !disabled}
          aria-controls={open && !disabled ? listId : undefined}
          aria-describedby={[describedBy, `${id}-selection`].filter(Boolean).join(' ')}
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-10 w-full justify-between border-input bg-background px-3 text-left font-normal',
            className,
          )}
          title={selected?.secondary ?? selected?.label ?? placeholder}
        >
          <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown aria-hidden="true" className="shrink-0 text-muted-foreground" />
        </Button>
      </PopoverPrimitive.Trigger>
      <span id={`${id}-selection`} className="sr-only">
        {selected === undefined
          ? placeholder
          : `已选择：${selected.label}${selected.secondary === undefined ? '' : `，${selected.secondary}`}`}
      </span>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-search-select-content
          align="start"
          sideOffset={4}
          collisionBoundary={boundary}
          collisionPadding={8}
          sticky="always"
          className="z-[60] flex max-h-[min(320px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
            setListId(input.current?.getAttribute('aria-controls') ?? undefined);
          }}
          onCloseAutoFocus={(event) => {
            if (tabTarget.current !== null) {
              event.preventDefault();
              tabTarget.current.focus();
              tabTarget.current = null;
            }
          }}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!composing.current && !event.isComposing) changeOpen(false);
          }}
        >
          <Command
            shouldFilter={false}
            value={activeOption === undefined ? '' : `option:${activeOption.value}`}
            onValueChange={setActiveValue}
            label={searchLabel}
            className="flex min-h-0 flex-1 flex-col"
            onKeyDownCapture={(event) => {
              // Older Chromium IME events report 229 instead of isComposing on the confirmation key.
              // eslint-disable-next-line @typescript-eslint/no-deprecated
              const imeConfirmation = event.keyCode === 229;
              if (composing.current || event.nativeEvent.isComposing || imeConfirmation) {
                if (['Enter', 'ArrowUp', 'ArrowDown', 'Escape'].includes(event.key)) {
                  event.preventDefault();
                  event.stopPropagation();
                }
                return;
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                event.stopPropagation();
                continueTab(event.shiftKey);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.stopPropagation();
            }}
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
              <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <Command.Input
                ref={input}
                id={`${id}-search`}
                aria-label={searchLabel}
                value={query}
                onValueChange={(next) => {
                  setQuery(next);
                  if (!composing.current) setFilterQuery(next);
                }}
                onCompositionStart={() => {
                  composing.current = true;
                }}
                onCompositionEnd={(event) => {
                  composing.current = false;
                  setFilterQuery(event.currentTarget.value);
                }}
                placeholder={searchLabel}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query !== '' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="清空搜索"
                  onClick={() => {
                    setQuery('');
                    setFilterQuery('');
                    input.current?.focus();
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
            <Command.List id={`${id}-list`} className="min-h-0 overflow-y-auto p-1">
              {visibleOptions.map((option) => (
                <Command.Item
                  key={option.value}
                  value={`option:${option.value}`}
                  data-value={option.value}
                  aria-current={value === option.value ? 'true' : undefined}
                  disabled={option.disabled}
                  onSelect={() => {
                    if (option.disabled || composing.current) return;
                    if (option.value !== value) onValueChange(option.value);
                    changeOpen(false);
                  }}
                  className="relative flex cursor-default select-none items-start gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:text-muted-foreground"
                  title={option.secondary ?? option.label}
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 size-4 shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {value === option.value && <span className="sr-only">（已选）</span>}
                    {option.secondary !== undefined && (
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {option.secondary}
                      </span>
                    )}
                    {(option.reason ?? option.warning) !== undefined && (
                      <span className="block text-xs text-muted-foreground">
                        {option.reason ?? option.warning}
                      </span>
                    )}
                  </span>
                </Command.Item>
              ))}
              {loading ? (
                <p
                  role="status"
                  aria-busy="true"
                  className="px-3 py-3 text-sm text-muted-foreground"
                >
                  {loadingLabel}
                </p>
              ) : matches.length === 0 ? (
                <p role="status" className="px-3 py-3 text-sm text-muted-foreground">
                  {emptyLabel}
                </p>
              ) : null}
            </Command.List>
          </Command>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
