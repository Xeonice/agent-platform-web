import { Button } from '@/components/ui/button';
import { AppDialogView } from '@/views/common/AppDialog.view';
import type { ImageDeletionPreviewDto } from '@/types/image';

export interface DeleteImageConfirmProps {
  reference: string;
  version: string;
  isActive: boolean;
  envCount: number;
  secretCount: number;
  preview?: ImageDeletionPreviewDto;
  loading: boolean;
  error?: string;
  busy: boolean;
  onRetry: () => void;
  onConfirm: () => void;
  onDisable: () => void;
  onCancel: () => void;
}

const TASK_STATE: Record<string, string> = {
  pending: '等待分配',
  scheduling: '分配中',
  'preparing-workspace': '准备代码副本',
  creating: '启动运行环境',
  starting: '启动中',
  running: '运行中',
  idle: '空闲',
  waiting_input: '等待输入',
  stopping: '停止中',
  stopped: '已停止',
  failed: '异常',
  destroying: '删除中',
  destroyed: '已删除',
};

export function DeleteImageConfirmView({
  reference,
  version,
  isActive,
  envCount,
  secretCount,
  preview,
  loading,
  error,
  busy,
  onRetry,
  onConfirm,
  onDisable,
  onCancel,
}: DeleteImageConfirmProps) {
  const blocked = preview !== undefined && !preview.canDelete;
  return (
    <AppDialogView
      title={`删除镜像「${reference}」？`}
      subtitle={`自定义镜像 · 当前版本 ${version} · ${isActive ? '已启用' : '已禁用'}`}
      busy={busy}
      onClose={onCancel}
      testId="image-delete-confirm"
    >
      <div className="space-y-4 px-5 py-4 text-sm">
        {loading ? <p role="status">正在读取受影响清单…</p> : null}
        {error === undefined ? null : (
          <div role="alert" className="space-y-2 text-destructive">
            <p>{error}</p>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onRetry}>
              重试清单
            </Button>
          </div>
        )}
        {blocked ? (
          <div
            id="image-delete-blocked-reason"
            role="alert"
            className="space-y-2 rounded-md border border-border bg-muted p-3"
          >
            <p className="font-medium">有 {preview.tasks.length} 个任务在用这一版，删不了</p>
            <ul className="space-y-1 text-xs">
              {preview.tasks.map((task) => (
                <li key={task.id}>
                  {task.name} · {task.projectName} · {TASK_STATE[task.status] ?? task.status}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              删掉会让它们指向一张不存在的镜像。改为禁用：新任务不能再选用它，这{' '}
              {preview.tasks.length} 个任务照常运行，不会停任务、不删代码。
            </p>
          </div>
        ) : null}
        <section className="space-y-1">
          <h4 className="font-medium">会删掉</h4>
          <p className="text-muted-foreground">
            这一版的登记 · {version}，连同它的验证结论和运行参数（{envCount} 个环境变量，其中{' '}
            {secretCount} 个是 Secret）。
            {preview?.versions.length === 1 ? '这是最后一版，这张镜像的卡片也会从列表消失。' : ''}
          </p>
        </section>
        <section className="space-y-1">
          <h4 className="font-medium">会留下</h4>
          <p className="text-muted-foreground">
            历史里的其他版本；卡片会退回最近登记的那一版，它现在没有启用，要继续用请在卡片上点
            [启用]。这台机器上已经下载的镜像层也会留下，删除不会腾出磁盘空间。
          </p>
        </section>
        <section className="space-y-1">
          <h4 className="font-medium">删掉之后</h4>
          <p className="text-muted-foreground">
            拿不回来。要再用这一版只能重新注册同一个地址；那时按下载源上的内容重新锁定版本，未必还是同一版。
          </p>
        </section>
        <section className="space-y-1">
          <h4 className="font-medium">不受影响</h4>
          <p className="text-muted-foreground">镜像下载源上的镜像本身；已有任务。</p>
        </section>
        <p className="text-xs text-muted-foreground">
          清单来源：平台刚刚读取的版本登记与未销毁任务引用（含已停止、异常任务）。
        </p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
        <Button
          autoFocus
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </Button>
        {blocked ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !isActive}
            onClick={onDisable}
          >
            {busy ? '禁用中…' : isActive ? '改为禁用' : '已禁用'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          aria-describedby={blocked ? 'image-delete-blocked-reason' : undefined}
          disabled={blocked || busy || loading || error !== undefined || preview === undefined}
          onClick={onConfirm}
        >
          {busy && !blocked ? '删除中…' : '删除镜像'}
        </Button>
      </footer>
    </AppDialogView>
  );
}
