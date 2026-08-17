// Git 凭证卡片（F21-3 §3，P21-3 §10.1）：已配置（类型/maskedIdentifier/allowedHosts/lastUsedAt +
// [更换][测试连接][吊销]）或未配置态（[配置 SSH 密钥][配置 HTTPS Token]）。私钥/token 明文永不回显，
// 仅 maskedIdentifier（SSH=指纹 / Token=尾号）。纯展示、props 驱动、零副作用。
import { Button } from '@/components/ui/button';
import { KnownHostsRowView } from '@/views/settings/KnownHostsRow.view';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';
import type { MaskedGitCredential } from '@/types/gitCredential';

export interface GitCredentialCardProps {
  /** null = 未配置态。 */
  credential: MaskedGitCredential | null;
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
  if (credential === null) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4">
        <p className="text-sm text-muted-foreground">○ 未配置</p>
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
          吊销
        </Button>
      </div>
    </div>
  );
}
