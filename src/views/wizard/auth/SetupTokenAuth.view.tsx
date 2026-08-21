// B · setup-token（Claude Code，07 §6.2）：授权链接 + [打开链接] → code 粘贴框（password 遮罩，
// [展开查看] 纯前端切换）→ [提交]。粘贴值受控于容器局部 state（提交即清空，绝不落 localStorage，15 §3.5）。
// 纯展示、props 驱动、零副作用。
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface SetupTokenAuthProps {
  verificationUrl: string;
  /** 后端下发的引导文案（可选）。 */
  instructions?: string;
  /** 粘贴的授权码（受控，容器持有，提交即清空）。 */
  code: string;
  onCodeChange: (value: string) => void;
  submitting?: boolean;
  error?: string;
  onSubmit: () => void;
}

export function SetupTokenAuthView({
  verificationUrl,
  instructions,
  code,
  onCodeChange,
  submitting = false,
  error,
  onSubmit,
}: SetupTokenAuthProps) {
  const [reveal, setReveal] = useState(false);
  const disabled = submitting || code.trim() === '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      {instructions !== undefined && instructions !== '' && (
        <p className="text-xs text-muted-foreground">{instructions}</p>
      )}

      <a
        href={verificationUrl}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-primary underline-offset-2 hover:underline"
      >
        打开授权链接 ↗
      </a>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">粘贴授权码（提交后自动清空）</span>
        <div className="flex gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            name="setup-token-code"
            autoComplete="off"
            placeholder="粘贴从浏览器复制的授权码"
            className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={code}
            disabled={submitting}
            onChange={(e) => {
              onCodeChange(e.target.value);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setReveal((v) => !v);
            }}
          >
            {reveal ? '隐藏' : '展开查看'}
          </Button>
        </div>
      </label>

      {error !== undefined && error !== '' && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <div>
        <Button type="submit" size="sm" disabled={disabled}>
          {submitting ? '提交中…' : '提交'}
        </Button>
      </div>
    </form>
  );
}
