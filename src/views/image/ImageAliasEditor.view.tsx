import type { Ref } from 'react';
import { Button } from '@/components/ui/button';

export interface ImageAliasEditorProps {
  inputRef?: Ref<HTMLInputElement>;
  value: string;
  count: number;
  error?: string;
  invalid?: boolean;
  saving?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onClear: () => void;
}

export function ImageAliasEditorView({
  inputRef,
  value,
  count,
  error,
  invalid = false,
  saving = false,
  onChange,
  onSave,
  onCancel,
  onClear,
}: ImageAliasEditorProps) {
  return (
    <div
      data-testid="image-alias-editor"
      className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted/30 p-3"
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <label htmlFor="image-alias-draft">镜像别名</label>
        <span className="text-muted-foreground" aria-live="polite">
          {count}/64
        </span>
      </div>
      <input
        ref={inputRef}
        id="image-alias-draft"
        type="text"
        value={value}
        disabled={saving}
        aria-invalid={error !== undefined}
        aria-describedby={`image-alias-help${error === undefined ? '' : ' image-alias-error'}`}
        className="w-full min-w-0 rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          onChange(
            value.slice(0, input.selectionStart ?? value.length) +
              event.clipboardData.getData('text') +
              value.slice(input.selectionEnd ?? value.length),
          );
        }}
        onKeyDown={(event) => {
          // Some IME confirmation keys use 229 before isComposing is updated.
          // eslint-disable-next-line @typescript-eslint/no-deprecated
          const imeConfirmation = event.keyCode === 229;
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !imeConfirmation) {
            event.preventDefault();
            if (!saving && !invalid) onSave();
          }
        }}
      />
      <p id="image-alias-help" className="text-xs text-muted-foreground">
        仅用于显示和搜索，不改变镜像地址；留空显示真实坐标。
      </p>
      {error === undefined ? null : (
        <p id="image-alias-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={saving || invalid} onClick={onSave}>
          {saving ? '保存中…' : '保存别名'}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onClear}>
          清除别名
        </Button>
      </div>
    </div>
  );
}
