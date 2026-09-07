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

      {/*
        ⭐ **自动回流才是主路**（2026-09-07 真机改）：`claude setup-token` 起了一个本地
        监听，浏览器与平台同机时回调页把码直接送进去，页面只说「可以关闭此窗口」、
        **不给码**。此前这里只有一个粘贴框，用户在浏览器里翻遍了也找不到码。
        ⇒ 先说清楚「通常不用管下面」，再把粘贴框留成远端部署的退路。
      */}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        ⏳ 正在等浏览器把授权送回 —— <strong>通常不需要你做别的</strong>，完成后这里会自己变。
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">
          页面<strong>显示了授权码</strong>时才需要粘贴（浏览器与平台不在同一台机器时才会这样）
        </span>
        <div className="flex gap-2">
          <input
            type={reveal ? 'text' : 'password'}
            name="setup-token-code"
            autoComplete="off"
            placeholder="页面没给码就不用填"
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
