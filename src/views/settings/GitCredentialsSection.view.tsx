// Git 凭证分区（F21-3 §3，P21-3 §10）：📦 标题 + 选型引导 + clone 回程重试横幅 + 已配置/未配置卡片 +
// 打开的表单 slot + 页底安全承诺。纯展示、props 驱动、零副作用；一切决策/网络在容器。
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { GitCredentialCardView } from '@/views/settings/GitCredentialCard.view';
import type {
  GitCredentialCardModel,
  GitCredentialType,
  MaskedGitCredential,
} from '@/types/gitCredential';

export type { GitCredentialCardModel };

export interface GitCredentialsSectionProps {
  loading?: boolean;
  cards: GitCredentialCardModel[];
  /** 尚未配置、可新增的类型（渲染 CTA）。 */
  missingTypes: GitCredentialType[];
  /** 选型引导文案（lib 常量，容器传入）。 */
  guidanceText: string;
  /** 当前打开的表单（SshKeyForm / HttpsTokenForm，由容器渲染）。 */
  formSlot?: ReactNode;
  /** clone 权限失败回程横幅（pendingProjectCreate 存在时）。 */
  pendingRetry?: {
    name: string;
    retrying: boolean;
    onRetry: () => void;
    onDiscard: () => void;
  } | null;
  busy?: boolean;
  onConfigureSsh: () => void;
  onConfigureHttps: () => void;
  onReplace: (credential: MaskedGitCredential) => void;
  onTest: (credential: MaskedGitCredential) => void;
  onRevoke: (credential: MaskedGitCredential) => void;
}

export function GitCredentialsSectionView({
  loading = false,
  cards,
  missingTypes,
  guidanceText,
  formSlot,
  pendingRetry,
  busy = false,
  onConfigureSsh,
  onConfigureHttps,
  onReplace,
  onTest,
  onRevoke,
}: GitCredentialsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">📦 Git 凭证（私有仓库访问）</h2>
        <p className="text-xs text-muted-foreground">{guidanceText}</p>
        <p className="text-xs text-muted-foreground">
          ℹ️ Git 凭证用于克隆私有仓库，与 Agent 的 Runtime 凭证无关。
        </p>
      </header>

      {pendingRetry !== undefined && pendingRetry !== null && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <p className="text-sm">为项目「{pendingRetry.name}」配置凭证后，可重试克隆。</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pendingRetry.retrying}
              onClick={pendingRetry.onRetry}
            >
              {pendingRetry.retrying ? '重试中…' : '重试克隆'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pendingRetry.retrying}
              onClick={pendingRetry.onDiscard}
            >
              放弃
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/30" />
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((model) => (
            <GitCredentialCardView
              key={model.credential.id}
              credential={model.credential}
              lastUsedLabel={model.lastUsedLabel}
              testing={model.testing}
              testResult={model.testResult}
              busy={busy}
              onReplace={() => {
                onReplace(model.credential);
              }}
              onTest={() => {
                onTest(model.credential);
              }}
              onRevoke={() => {
                onRevoke(model.credential);
              }}
            />
          ))}

          {cards.length === 0 && (
            <GitCredentialCardView
              credential={null}
              onConfigureSsh={onConfigureSsh}
              onConfigureHttps={onConfigureHttps}
            />
          )}

          {cards.length > 0 && missingTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              <span>添加其他类型凭证：</span>
              {missingTypes.includes('ssh-key') && (
                <Button type="button" variant="outline" size="sm" onClick={onConfigureSsh}>
                  配置 SSH 密钥
                </Button>
              )}
              {missingTypes.includes('https-token') && (
                <Button type="button" variant="outline" size="sm" onClick={onConfigureHttps}>
                  配置 HTTPS Token
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {formSlot}

      <footer className="mt-2 border-t border-border pt-3 text-xs text-muted-foreground">
        凭证已加密保存在本机，不上传；SSH 私钥与 Token 明文永不回显，仅保留指纹 / 尾号用于识别。
      </footer>
    </section>
  );
}
