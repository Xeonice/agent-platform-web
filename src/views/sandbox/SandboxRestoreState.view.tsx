// 运行方式未知时的详情读取门。纯 props；任何终端和无头输出都在确认模式后再挂载。
import { Button } from '@/components/ui/button';

export interface SandboxRestoreStateProps {
  pending: boolean;
  errorMessage?: string;
  onRetry: () => void;
}

export function SandboxRestoreStateView({
  pending,
  errorMessage,
  onRetry,
}: SandboxRestoreStateProps) {
  if (pending) {
    return (
      <div
        data-testid="sandbox-restore-pending"
        className="flex h-full min-h-0 flex-col gap-4 p-6"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm text-muted-foreground">正在读取任务详情…</p>
        <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
          <div className="h-4 w-48 max-w-full rounded bg-muted" />
          <div className="h-4 w-72 max-w-full rounded bg-muted" />
          <div className="h-32 w-full rounded bg-muted" />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="sandbox-restore-error"
      className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <p role="alert" className="text-sm text-muted-foreground">
        {errorMessage ?? '暂时无法读取任务详情，请重试。'}
      </p>
      <Button variant="secondary" onClick={onRetry}>
        重新读取
      </Button>
    </div>
  );
}
