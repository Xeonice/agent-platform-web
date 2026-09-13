// 测试连接结果（F21-3 §3）：成功/失败图标 + errorCode 映射后的人话（映射在 lib，容器传入 message）。
// 绝不展示任何 ref 名（P21-3 §10.3）。纯展示、props 驱动。
import { Check, X } from 'lucide-react';

export interface TestConnectionResultProps {
  /** 测试进行中。 */
  testing?: boolean;
  /** 测试结果（null = 尚未测试）。 */
  result?: { ok: boolean; message: string } | null;
}

export function TestConnectionResultView({ testing = false, result }: TestConnectionResultProps) {
  if (testing) {
    return (
      <p role="status" className="text-xs text-muted-foreground">
        正在测试连接…（最多 15 秒）
      </p>
    );
  }
  if (result === null || result === undefined) return null;
  const Icon = result.ok ? Check : X;
  return (
    <p
      role={result.ok ? 'status' : 'alert'}
      className={
        'flex items-center gap-1 text-xs ' + (result.ok ? 'text-green-400' : 'text-red-400')
      }
    >
      <Icon aria-hidden="true" data-testid="test-connection-icon" className="h-3 w-3 shrink-0" />
      {result.ok ? '连接成功' : result.message}
    </p>
  );
}
