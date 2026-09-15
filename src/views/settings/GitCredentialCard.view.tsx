// Git 凭证卡片（F21-3 §3，P21-3 §10.1）：已配置（类型/指纹或尾号/allowedHosts/lastUsedAt +
// [更换][测试连接][删除]）或未配置态（[配置 SSH 密钥][配置 HTTPS Token]）。私钥/token 明文永不回显，
// 只保留指纹 / 尾号。纯展示、props 驱动、零副作用。
//
// ⚠️ **「查不到」与「没有」是两态。** 此前 Git 凭证接口失败时也落到 `credential === null` 这一支，
//    屏幕上就是「○ 未配置」+ [配置 SSH 密钥] —— 用户会以为自己的密钥被清了，然后重新配一份。
//    加载失败必须单独说，并给 [重试]，绝不给「去配一个新的」这种引导。
import { Button } from '@/components/ui/button';
import { StatusPill } from '@/components/ui/status-pill';
import { KnownHostsRowView } from '@/views/settings/KnownHostsRow.view';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';
import type { MaskedGitCredential } from '@/types/gitCredential';

export interface GitCredentialCardProps {
  /** null = 未配置态（**仅当确实查到了、且确实没有时**）。 */
  credential: MaskedGitCredential | null;
  /** 列表**加载失败**：单独一态（不是「未配置」），带 [重试]。 */
  loadFailed?: boolean;
  onRetryLoad?: () => void;
  /** 最后使用时间的展示文案（容器格式化，如 "2 小时前"）。 */
  lastUsedLabel?: string;
  testing?: boolean;
  testResult?: { ok: boolean; message: string } | null;
  busy?: boolean;
  onReplace?: () => void;
  onTest?: () => void;
  onRevoke?: () => void;
  onConfigureSsh?: () => void;
  onConfigureHttps?: () => void;
}

export function GitCredentialCardView({
  credential,
  loadFailed = false,
  onRetryLoad,
  lastUsedLabel,
  testing = false,
  testResult,
  busy = false,
  onReplace,
  onTest,
  onRevoke,
  onConfigureSsh,
  onConfigureHttps,
}: GitCredentialCardProps) {
  if (loadFailed) {
    return (
      <div
        role="alert"
        data-testid="git-load-error"
        className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-4 text-sm text-amber-400"
      >
        <span>Git 凭证没能加载出来 —— 这不代表它被删了，只是现在读不到。</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetryLoad}>
          重试
        </Button>
      </div>
    );
  }

  if (credential === null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
        {/* ⭐ 状态用 StatusPill 的 skipped（虚线框），⛔ 不是 fail：没配 Git 凭证不等于
            出错了，是「这一路没走」（design/prototype.html #credentials 第 663/717 行同款）。 */}
        <StatusPill status="skipped" data-testid="git-unconfigured-badge">
          未配置
        </StatusPill>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onConfigureSsh}>
            配置 SSH 密钥
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onConfigureHttps}>
            配置 HTTPS Token
          </Button>
        </div>
      </div>
    );
  }

  const isSsh = credential.type === 'ssh-key';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1 text-sm">
        <div>
          <span className="text-muted-foreground">类型：</span>
          <span className="font-medium">{isSsh ? 'SSH 私钥' : 'HTTPS Token'}</span>
        </div>
        <div className="break-all">
          <span className="text-muted-foreground">{isSsh ? '指纹：' : 'Token 尾号：'}</span>
          <span className="font-mono">{credential.maskedIdentifier}</span>
        </div>
        {!isSsh && credential.allowedHosts.length > 0 && (
          <div>
            <span className="text-muted-foreground">host 白名单：</span>
            <span className="font-mono">{credential.allowedHosts.join('、')}</span>
          </div>
        )}
        {lastUsedLabel !== undefined && lastUsedLabel !== '' && (
          <div>
            <span className="text-muted-foreground">最后使用：</span>
            <span>{lastUsedLabel}</span>
          </div>
        )}
      </div>

      {isSsh && credential.knownHosts !== undefined && (
        <KnownHostsRowView knownHosts={credential.knownHosts} />
      )}

      <TestConnectionResultView testing={testing} result={testResult} />

      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onReplace}>
          更换
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || testing}
          onClick={onTest}
        >
          测试连接
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRevoke}>
          删除
        </Button>
      </div>
    </div>
  );
}
