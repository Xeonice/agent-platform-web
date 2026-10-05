// 测试连接结果（F21-3 §3）：成功/失败图标 + errorCode 映射后的人话（映射在 lib，容器传入 message）。
// 绝不展示任何 ref 名（P21-3 §10.3）。纯展示、props 驱动。
import { CircleCheck, CircleX, Loader2 } from 'lucide-react';

export interface TestConnectionResultProps {
  /** 测试进行中。 */
  testing?: boolean;
  /** 测试结果（null = 尚未测试）。 */
  result?: { ok: boolean; message: string } | null;
}

export function TestConnectionResultView({ testing = false, result }: TestConnectionResultProps) {
  if (testing) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin" />
        正在测试连接…（最多 15 秒）
      </p>
    );
  }
  if (result === null || result === undefined) return null;
  const Icon = result.ok ? CircleCheck : CircleX;
  return (
    <p
      role={result.ok ? 'status' : 'alert'}
      className={
        'flex items-center gap-1.5 text-[13px] ' +
        (result.ok ? 'text-[var(--v2-status-ok-fg)]' : 'text-destructive')
      }
    >
      <Icon aria-hidden="true" data-testid="test-connection-icon" className="size-4 shrink-0" />
      {result.ok ? '连接成功' : result.message}
    </p>
  );
}
