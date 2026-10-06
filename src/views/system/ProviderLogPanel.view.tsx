import { Button } from '@/components/ui/button';

export interface ProviderLogPanelProps {
  id: string;
  lines: string[];
  isLoading: boolean;
  isError: boolean;
  unavailableReason?: string;
  onRetry?: () => void;
}

export function ProviderLogPanelView({
  id,
  lines,
  isLoading,
  isError,
  unavailableReason,
  onRetry,
}: ProviderLogPanelProps) {
  return (
    <div id={id} aria-busy={isLoading} className="mt-2 space-y-2 border-t border-border pt-2">
      <p className="text-xs text-muted-foreground">最近 20 行运行日志</p>
      {isLoading ? (
        <p role="status" className="text-xs text-muted-foreground">
          日志读取中…
        </p>
      ) : isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
          日志读取失败
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            重试日志
          </Button>
        </div>
      ) : lines.length === 0 ? (
        <p role="status" className="text-xs text-muted-foreground">
          {unavailableReason ?? '这个环境暂时没有运行日志。'}
        </p>
      ) : (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 text-xs leading-5">
          {lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
