'use client';
// Git 凭证容器（F21-3 §4/§5）：唯一 view↔hook 粘合点。逻辑/副作用全在 useGitCredentialManager，
// 本容器只把 hook 返回值装配进视图（含打开的表单 slot）。凭证明文不经此容器落地（见 hook 注释）。
import { useGitCredentialManager } from '@/hooks/useGitCredentialManager';
import { GitCredentialsSectionView } from '@/views/settings/GitCredentialsSection.view';
import { SshKeyFormView } from '@/views/settings/SshKeyForm.view';
import { HttpsTokenFormView } from '@/views/settings/HttpsTokenForm.view';

export function GitCredentialsContainer() {
  const m = useGitCredentialManager();

  const formSlot = ((): React.ReactNode => {
    if (m.activeForm === 'ssh') {
      return (
        <SshKeyFormView
          privateKey={m.sshKey}
          onPrivateKeyChange={m.setSshKey}
          passphraseWarning={m.sshWarning}
          submitDisabled={m.sshSubmitDisabled}
          submitting={m.saving}
          testing={m.formTesting}
          testResult={m.formTestResult}
          onTest={m.testForm}
          onSubmit={m.submitSsh}
          onCancel={m.closeForm}
        />
      );
    }
    if (m.activeForm === 'https') {
      return (
        <HttpsTokenFormView
          platform={m.platform}
          onPlatformChange={m.setPlatform}
          token={m.token}
          onTokenChange={m.setToken}
          allowedHosts={m.allowedHosts}
          onAllowedHostsChange={m.setAllowedHosts}
          scopeHint={m.scopeHint}
          submitDisabled={m.httpsSubmitDisabled}
          submitting={m.saving}
          testing={m.formTesting}
          testResult={m.formTestResult}
          onTest={m.testForm}
          onSubmit={m.submitHttps}
          onCancel={m.closeForm}
        />
      );
    }
    return null;
  })();

  return (
    <GitCredentialsSectionView
      loading={m.loading}
      cards={m.cards}
      missingTypes={m.missingTypes}
      guidanceText={m.guidanceText}
      formSlot={formSlot}
      pendingRetry={
        m.pendingRetry !== null
          ? {
              name: m.pendingRetry.name,
              retrying: m.pendingRetry.retrying,
              onRetry: m.retryClone,
              onDiscard: m.discardPending,
            }
          : null
      }
      busy={m.busy}
      onConfigureSsh={m.openSshForm}
      onConfigureHttps={m.openHttpsForm}
      onReplace={m.replace}
      onTest={m.testCard}
      onRevoke={m.revoke}
    />
  );
}
