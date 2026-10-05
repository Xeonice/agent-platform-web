import { useState } from 'react';
import { CircleX, Loader2, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface UnlockFormProps {
  reason?: string | null;
  submitting?: boolean;
  errorMessage?: string;
  lockedForMinutes?: number;
  onSubmit: (passcode: string) => void;
}

export function UnlockFormView({
  submitting = false,
  errorMessage,
  lockedForMinutes = 0,
  onSubmit,
}: UnlockFormProps) {
  const [passcode, setPasscode] = useState('');
  const trimmed = passcode.trim();
  const blocked = lockedForMinutes > 0;
  const message = blocked
    ? `错得太多次，已暂时锁定，约 ${String(lockedForMinutes)} 分钟后再试。`
    : errorMessage;
  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-card p-6 shadow-[var(--v2-shadow-card)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !submitting && !blocked) onSubmit(trimmed);
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">需要访问口令</h2>
        <p className="mt-1 text-sm text-muted-foreground">这个平台设了访问口令，输入后才能继续。</p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>访问口令</span>
        <input
          type="password"
          name="passcode"
          autoComplete="off"
          autoFocus
          aria-invalid={!!message}
          aria-describedby={message ? 'access-error access-source' : 'access-source'}
          className={`h-9 rounded-md border bg-background px-3 text-sm focus-visible:outline-none ${message ? 'border-destructive shadow-[var(--v2-focus-input-error)]' : 'border-border focus-visible:shadow-[var(--v2-focus-input)]'}`}
          value={passcode}
          disabled={submitting}
          onChange={(event) => {
            setPasscode(event.target.value);
          }}
        />
      </label>
      {message && (
        <p
          id="access-error"
          role="alert"
          className="flex items-start gap-2 text-sm text-foreground"
        >
          {blocked ? (
            <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          )}
          {message}
        </p>
      )}
      <Button type="submit" disabled={submitting || blocked || !trimmed}>
        {submitting && <Loader2 aria-hidden="true" className="animate-spin" />}
        {submitting ? '验证中…' : '解锁'}
      </Button>
      <p id="access-source" className="text-xs leading-relaxed text-muted-foreground">
        口令只在首次启动时输出在服务日志里，可以找部署这台平台的人要；忘了可以用环境变量
        ACCESS_PASSCODE 重设。
      </p>
    </form>
  );
}
