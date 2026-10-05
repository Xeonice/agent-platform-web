import { AppDialogView } from '@/views/common/AppDialog.view';

export function ShortcutsView({
  onClose,
  onCloseAutoFocus,
}: {
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AppDialogView
      title="快捷键"
      testId="shortcuts-dialog"
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <dl className="space-y-4 p-5 text-sm">
        {[
          ['查找任务、项目与动作', '⌘K / Ctrl K'],
          ['收起 / 展开侧栏', '⌘B / Ctrl B'],
          ['查看快捷键', '?'],
          ['关闭弹层', 'Esc'],
          ['查找结果中移动', '↑ / ↓'],
          ['执行所选动作', 'Enter'],
        ].map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt>{label}</dt>
            <dd>
              <kbd className="rounded border border-[var(--v2-border-subtle)] px-2 py-1 font-mono text-xs text-muted-foreground">
                {keys}
              </kbd>
            </dd>
          </div>
        ))}
      </dl>
    </AppDialogView>
  );
}
