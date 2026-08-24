'use client';
// 凭证页容器（F21-3 §3）：Runtime 凭证分区（本切片）+ Git 凭证分区（S3 复用）并列 + 二级弹层
//（切模式确认 / 吊销确认）。逻辑全在 useCredentials；凭证明文不经此容器（授权面板在 AuthGateContainer 局部 state）。
import { useCredentials } from '@/hooks/credential/useCredentials';
import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';
import { GitCredentialsContainer } from '@/containers/credential/GitCredentialsContainer';
import { RuntimeCredentialsSectionView } from '@/views/settings/RuntimeCredentialsSection.view';
import { ConfirmDialogView } from '@/views/settings/ConfirmDialog.view';
import { RevokeConfirmDialogView } from '@/views/settings/RevokeConfirmDialog.view';
import type { RuntimeAuthMethod, RuntimeAuthMode } from '@/types/runtimeCredential';

const MODE_LABEL: Record<RuntimeAuthMode, string> = { account: '帐号授权', 'api-key': 'API Key' };

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
          methods={methods}
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

      {m.pendingSwitch !== null && (
        <ConfirmDialogView
          title="切换生效模式"
          message={m.pendingSwitch.message}
          confirmLabel="切换"
          busy={m.switching}
          onConfirm={m.confirmSwitch}
          onCancel={m.cancelSwitch}
        />
      )}

      {m.pendingRevoke !== null && (
        <RevokeConfirmDialogView
          runtimeName={m.pendingRevoke.runtimeName}
          modeLabel={MODE_LABEL[m.pendingRevoke.mode]}
          affectedItems={m.pendingRevoke.affected.items}
          restCount={m.pendingRevoke.affected.restCount}
          warningText={m.pendingRevoke.warningText}
          warnActiveMode={m.pendingRevoke.warnActiveMode}
          revoking={m.revoking}
          onConfirm={m.confirmRevoke}
          onCancel={m.cancelRevoke}
        />
      )}
    </div>
  );
}
