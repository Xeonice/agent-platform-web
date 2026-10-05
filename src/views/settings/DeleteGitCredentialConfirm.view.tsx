import { Button } from '@/components/ui/button';
import { AppDialogView } from '@/views/common/AppDialog.view';
import type { GitCredentialDeletionModel } from '@/types/gitCredential';

export function DeleteGitCredentialConfirmView({
  model,
  busy,
  onConfirm,
  onCancel,
  onRetryProjects,
}: {
  model: GitCredentialDeletionModel;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRetryProjects: () => void;
}) {
  return (
    <AppDialogView
      title={model.title}
      subtitle={model.subtitle}
      onClose={onCancel}
      busy={busy}
      testId="git-credential-delete-confirm"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
        <section>
          <h4 className="font-medium">会删掉</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {model.subject}。平台不再保存它，也不会再拿它访问
            {model.ssh ? ' SSH 仓库' : ` ${model.hosts}`}。
          </p>
        </section>
        <section>
          <h4 className="font-medium">平台删不掉</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {model.ssh
              ? 'Git 服务上登记的对应公钥。去 Git 服务的 SSH Keys 设置里删掉它。'
              : `${model.provider} 上的这个 Token 本身。去 ${model.provider} 的设置里把它作废，否则它在 ${model.provider} 那边一直有效。`}
          </p>
        </section>
        <section>
          <h4 className="font-medium">删掉之后</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            克隆或拉取{model.ssh ? ' SSH 地址（git@ / ssh://）' : ` ${model.hosts} 上`}
            的私有仓会失败，直到重新配置凭证。
          </p>
          {model.projectsKnown ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {model.ssh ? '仓库地址是 SSH 形式' : `仓库在 ${model.hosts}`}的{' '}
              {model.projectNames.length} 个项目：
              {model.projectNames.length === 0 ? '没有相关项目' : model.projectNames.join('、')}。
            </p>
          ) : (
            <div role="alert" className="mt-2 text-xs text-[var(--v2-status-warn-fg)]">
              相关项目清单暂时查不到，这不代表没有相关项目。
              <Button variant="outline" size="sm" onClick={onRetryProjects} disabled={busy}>
                重试读取
              </Button>
            </div>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            仓库是私有的话，项目里的「拉取最新代码」会失败；新建任务仍用这台机器上已有的代码副本。
          </p>
        </section>
        <section>
          <h4 className="font-medium">不受影响</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            已经建好的任务：代码副本已在这台机器上，Git 凭证也不会注入任务。
          </p>
        </section>
        <p className="text-xs text-muted-foreground">
          项目清单来源：
          {model.ssh
            ? '项目列表里仓库地址是 SSH 形式的项目。'
            : `项目列表里仓库 host 在这份 Token 白名单（${model.hosts}）内的项目。`}
        </p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
        <Button autoFocus variant="outline" size="sm" disabled={busy} onClick={onCancel}>
          取消
        </Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={onConfirm}>
          {busy ? '删除中…' : '删除凭证'}
        </Button>
      </footer>
    </AppDialogView>
  );
}
