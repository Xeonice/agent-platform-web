'use client';
// 凭证页容器（F21-3 §3）：Runtime 凭证分区（本切片）+ Git 凭证分区（S3 复用）并列 + 二级弹层
//（切模式确认 / 吊销确认）。逻辑全在 useCredentials；凭证明文不经此容器（授权面板在 AuthGateContainer 局部 state）。
import { useCredentials } from '@/hooks/credential/useCredentials';
import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';
import { GitCredentialsContainer } from '@/containers/credential/GitCredentialsContainer';
import { RuntimeCredentialsSectionView } from '@/views/settings/RuntimeCredentialsSection.view';
import { CredentialsSecurityFooterView } from '@/views/settings/CredentialsSecurityFooter.view';
import { ConfirmDialogView } from '@/views/settings/ConfirmDialog.view';
import { RevokeConfirmDialogView } from '@/views/settings/RevokeConfirmDialog.view';
import type { RuntimeAuthMethod } from '@/types/runtimeCredential';

export function CredentialsContainer() {
  const m = useCredentials();

  const panelFor = (runtimeId: string): React.ReactNode => {
    if (m.expandedPanel?.runtimeId !== runtimeId) return undefined;
    const card = m.cards.find((c) => c.runtimeId === runtimeId);
    if (card === undefined) return undefined;
    // 可用方式由卡片各行的 method 反推（帐号授权行的具体方式 + api-key）。
    const methods: RuntimeAuthMethod[] = card.rows.map((r) => r.method);
    return (
      <div className="mt-1">
        <AuthGateContainer
          runtimeId={runtimeId}
          runtimeName={card.displayName}
          vendor={card.vendor}
          methods={methods}
          apiKeyPrefix={card.apiKeyPrefix}
          initialMethod={m.expandedPanel.method}
          onSuccess={m.onAuthSuccess}
        />
        <button
          type="button"
          onClick={m.closePanel}
          className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          收起
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-10">
      <RuntimeCredentialsSectionView
        loading={m.loading}
        loadError={m.loadError}
        onRetryLoad={m.retryLoad}
        storageNote={m.storageNote}
        cards={m.cards}
        search={m.search}
        onSearch={m.setSearch}
        panelFor={panelFor}
        isRowBusy={m.isRowBusy}
        onSwitch={(runtimeId, mode) => {
          m.switchMode(runtimeId, mode);
        }}
        onNeedSetup={(runtimeId, mode) => {
          m.switchMode(runtimeId, mode);
        }}
        onReauth={(runtimeId, method: RuntimeAuthMethod) => {
          m.reauth(runtimeId, method);
        }}
        onAddKey={m.addKey}
        onRevoke={m.requestRevoke}
      />

      <GitCredentialsContainer />

      {/* 产品 §3 的安全承诺：跨两个分区，落在页底（此前只埋在 Git 分区里，且少了一半）。 */}
      <CredentialsSecurityFooterView />

      {m.pendingSwitch !== null && (
        <ConfirmDialogView
          title={m.pendingSwitch.title}
          message={m.pendingSwitch.message}
          confirmLabel={m.pendingSwitch.confirmLabel}
          busy={m.switching}
          onConfirm={m.confirmSwitch}
          onCancel={m.cancelSwitch}
        />
      )}

      {m.pendingRevoke !== null && (
        <RevokeConfirmDialogView
          runtimeName={m.pendingRevoke.runtimeName}
          modeLabel={m.pendingRevoke.modeLabel}
          affectedItems={m.pendingRevoke.affected.items}
          restCount={m.pendingRevoke.affected.restCount}
          affectedKnown={m.pendingRevoke.affectedKnown}
          warningText={m.pendingRevoke.warningText}
          followUpText={m.pendingRevoke.followUpText}
          warnActiveMode={m.pendingRevoke.warnActiveMode}
          revoking={m.revoking}
          onConfirm={m.confirmRevoke}
          onCancel={m.cancelRevoke}
        />
      )}
    </div>
  );
}
