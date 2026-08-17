// 解锁门表单（11 §3.1）：输入 passcode → 提交。纯展示、props 驱动、零副作用。
// passcode 仅存本地受控 state，提交后不回填、不落 localStorage（安全红线）。
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export interface UnlockFormProps {
  /** 锁定原因（后端信封 message，可空）。 */
  reason?: string | null;
  /** 提交进行中。 */
  submitting?: boolean;
  /** 解锁失败信息（口令错误/锁定）。 */
  errorMessage?: string;
  /** 提交口令。 */
  onSubmit: (passcode: string) => void;
}

export function UnlockFormView({
  reason,
  submitting = false,
  errorMessage,
  onSubmit,
}: UnlockFormProps) {
  const [passcode, setPasscode] = useState('');
  const trimmed = passcode.trim();

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-border bg-background p-6 shadow-lg"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed !== '' && !submitting) onSubmit(trimmed);
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">需要访问口令</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {reason !== undefined && reason !== null && reason !== ''
            ? reason
            : '此环境已启用访问口令，请输入口令后继续。'}
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">访问口令</span>
        <input
          type="password"
          name="passcode"
          autoComplete="off"
          autoFocus
          className="rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={passcode}
          disabled={submitting}
          onChange={(e) => {
            setPasscode(e.target.value);
          }}
        />
      </label>

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      <Button type="submit" disabled={submitting || trimmed === ''}>
        {submitting ? '验证中…' : '解锁'}
      </Button>
    </form>
  );
}
