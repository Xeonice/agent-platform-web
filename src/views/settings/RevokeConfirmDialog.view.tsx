import { Button } from '@/components/ui/button';
import { AppDialogView } from '@/views/common/AppDialog.view';
import type { AffectedTaskItem } from '@/types/runtimeCredential';

export interface RevokeConfirmDialogProps {
  runtimeName: string;
  modeLabel: string;
  affectedItems: AffectedTaskItem[];
  restCount: number;
  affectedKnown?: boolean;
  preparingItems?: AffectedTaskItem[];
  onRetryPreview?: () => void;
  otherModeLabel?: string;
  warningText: string;
  followUpText?: string;
  warnActiveMode?: boolean;
  revoking?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
const STATUS: Record<string, string> = {
  running: '运行中',
  idle: '空闲',
  starting: '启动中',
  creating: '准备中',
  failed: '失败',
  stopped: '已停止',
  stopping: '停止中',
  destroying: '删除中',
  waiting_input: '等待你输入',
};
function TaskItem({ item, runtimeName }: { item: AffectedTaskItem; runtimeName: string }) {
  return (
    <li>
      {item.name} · {runtimeName} · {item.headless ? '无头任务 · ' : ''}
      {STATUS[item.status ?? ''] ?? '准备中'}
    </li>
  );
}
export function RevokeConfirmDialogView({
  runtimeName,
  modeLabel,
  affectedItems,
  restCount,
  affectedKnown = true,
  preparingItems = [],
  onRetryPreview,
  otherModeLabel,
  warningText,
  followUpText,
  warnActiveMode = false,
  revoking = false,
  onConfirm,
  onCancel,
}: RevokeConfirmDialogProps) {
  const total = affectedItems.length + restCount;
  return (
    <AppDialogView
      title={`删除 ${runtimeName} 的${modeLabel}？`}
      subtitle={warnActiveMode ? '凭证 · 当前在用' : '凭证'}
      onClose={onCancel}
      busy={revoking}
      testId="credential-revoke-confirm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        {!affectedKnown ? (
          <div
            role="alert"
            className="rounded-md border border-[var(--v2-status-warn-fg)]/30 bg-[var(--v2-status-warn-subtle-bg)] p-3"
            data-testid="affected-unknown"
          >
            <h4 className="font-medium">会被销毁的任务清单暂时查不到</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              凭证绑定表这次没读出来 ——
              这不代表没有任务在用它。正在用这份凭证的任务都会被销毁，代码副本保留为成果。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={onRetryPreview}
              disabled={revoking}
            >
              重试读取
            </Button>
          </div>
        ) : total > 0 ? (
          <section>
            <h4 className="font-medium">会销毁这 {total} 个任务</h4>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {affectedItems.map((item) => (
                <TaskItem key={item.id} item={item} runtimeName={runtimeName} />
              ))}
              {restCount > 0 && <li>等共 {total} 个</li>}
            </ul>
          </section>
        ) : null}
        <section>
          <h4 className="font-medium">会留下</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            被销毁任务的代码副本保留为成果，30 天后清理；可在「保留下来的成果」里查看或下载。
          </p>
        </section>
        <section>
          <h4 className="font-medium">平台删不掉</h4>
          <p className="mt-1 text-xs text-muted-foreground">{warningText}</p>
          {followUpText && <p className="mt-1 text-xs text-muted-foreground">{followUpText}</p>}
        </section>
        <section>
          <h4 className="font-medium">删掉之后</h4>
          {warnActiveMode && (
            <p className="mt-1 text-xs text-muted-foreground">
              这个 Agent 现在用的就是它，删掉就不能用了
              {otherModeLabel
                ? ` —— 它的 ${otherModeLabel} 还留着，删完会问你要不要切过去`
                : ` —— 要再发 ${runtimeName} 任务，先登录帐号或重新添加 API Key`}
              。
            </p>
          )}
          {preparingItems.length > 0 && (
            <>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {preparingItems.map((item) => (
                  <TaskItem key={item.id} item={item} runtimeName={runtimeName} />
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                这些任务还没注入凭证，不在销毁清单里；继续启动时会以未登录状态起来，需要重新登录。
              </p>
            </>
          )}
        </section>
        <section>
          <h4 className="font-medium">不受影响</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {affectedKnown && total === 0
              ? '现在没有任务在用这份凭证，不会销毁任何任务。'
              : '其他 Agent 的任务不受影响。'}
          </p>
        </section>
        <p className="text-xs text-muted-foreground">清单来源：后端凭证绑定表。</p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          autoFocus
          type="button"
          variant="outline"
          size="sm"
          disabled={revoking}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={revoking}
          onClick={onConfirm}
        >
          {revoking
            ? '删除中…'
            : affectedKnown && total > 0
              ? `删除并销毁 ${String(total)} 个任务`
              : '删除凭证'}
        </Button>
      </footer>
    </AppDialogView>
  );
}
