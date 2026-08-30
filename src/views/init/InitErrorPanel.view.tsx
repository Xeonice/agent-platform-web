// 初始化保存失败的就地反馈（F21-8 §3/§5）。纯展示、props 驱动、零副作用。
//
// ⚠️ **失败 ⇒ 停在向导，⛔ 不放行。** 这是阻塞语义的另一半：`POST /api/system/init` 没成功
// 就意味着 `initialized` 还是 false，此时把用户放进工作台，他下次刷新会被弹回向导——
// 而中间那一程做的事有没有存下来，谁也说不清。
//
// ⚠️ **原因原样上 UI。** 后端错误信封的 `message` 已经是人话（10 §6.8），而且带着这一次的
// 具体情况（比如"模型 API 全部不可达（api.openai.com、api.anthropic.com）"）。
// 换成一句「初始化失败，请重试」等于把唯一有用的信息删掉。
import { Button } from '@/components/ui/button';

export interface InitErrorPanelProps {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}

export function InitErrorPanelView({ message, isRetrying, onRetry }: InitErrorPanelProps) {
  return (
    <section
      role="alert"
      data-testid="init-error-panel"
      className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/5 p-3 text-sm"
    >
      <p className="font-medium text-red-500">初始化没有完成</p>
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{message}</p>
      <div>
        <Button type="button" variant="outline" disabled={isRetrying} onClick={onRetry}>
          {isRetrying ? '重试中…' : '重试'}
        </Button>
      </div>
    </section>
  );
}
