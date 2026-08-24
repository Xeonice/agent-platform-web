'use client';
// 鉴权拦截面板容器（07 §6.4）：向导拦截面板与凭证页卡片内嵌**共用**。方式切换 Tab + 按分支渲染
// Device/SetupToken/ApiKey 面板。**粘贴的 code / API key 只作为本层 useState，提交即清空、不进全局 store、
// 不进 persist（15 §3.5 安全红线）**——切 Tab / 卸载即随组件 key 重挂而丢弃。
import { useEffect, useState } from 'react';
import { useRuntimeAuthFlow, type AuthSuccess } from '@/hooks/credential/useRuntimeAuthFlow';
import {
  AuthGatePanelView,
  type AuthGateTab,
  type AuthTabKey,
} from '@/views/wizard/auth/AuthGatePanel.view';
import { DeviceCodeAuthView } from '@/views/wizard/auth/DeviceCodeAuth.view';
import { SetupTokenAuthView } from '@/views/wizard/auth/SetupTokenAuth.view';
import { ApiKeyAuthView } from '@/views/wizard/auth/ApiKeyAuth.view';
import type { RuntimeAuthMethod } from '@/types/runtimeCredential';

export interface AuthGateContainerProps {
  runtimeId: string;
  runtimeName: string;
  /** 可用鉴权方式（getAuthMethods 下发）。 */
  methods: RuntimeAuthMethod[];
  /** 初始选中方式（默认按当前生效模式；凭证页由具体入口指定）。 */
  initialMethod?: RuntimeAuthMethod;
  /** 拦截面板一次性语义文案（凭证页复用省略）。 */
  showOneTimeNotice?: boolean;
  /** 页脚 [管理所有凭证]（仅向导）。 */
  onOpenCredentials?: () => void;
  /** 配置成功回调（掩码帐号）。 */
  onSuccess?: (result: AuthSuccess) => void;
}

const ACCOUNT_METHODS: RuntimeAuthMethod[] = ['oauth-device', 'setup-token'];

function tabOfMethod(method: RuntimeAuthMethod): AuthTabKey {
  return method === 'api-key' ? 'api-key' : 'account';
}

export function AuthGateContainer({
  runtimeId,
  runtimeName,
  methods,
  initialMethod,
  showOneTimeNotice,
  onOpenCredentials,
  onSuccess,
}: AuthGateContainerProps) {
  const accountMethod = methods.find((m) => ACCOUNT_METHODS.includes(m)) ?? null;
  const hasApiKey = methods.includes('api-key');

  const tabs: AuthGateTab[] = [
    ...(accountMethod !== null ? [{ key: 'account' as const, label: '帐号授权' }] : []),
    ...(hasApiKey ? [{ key: 'api-key' as const, label: 'API Key' }] : []),
  ];

  const [selectedTab, setSelectedTab] = useState<AuthTabKey>(() =>
    initialMethod !== undefined ? tabOfMethod(initialMethod) : (tabs[0]?.key ?? 'account'),
  );

  // 帐号授权 Tab 但 methods 未含任何帐号授权方式：这是调用方喂了不一致 methods（配错鉴权方式的隐患）。
  // 显式开发态断言，而非静默回退到硬编码 'oauth-device'（P2）。
  if (
    process.env.NODE_ENV !== 'production' &&
    selectedTab !== 'api-key' &&
    accountMethod === null
  ) {
    console.error(
      `AuthGateContainer: 选中「帐号授权」但 methods 未含帐号授权方式（oauth-device/setup-token），` +
        `静默回退到 oauth-device 会配错鉴权方式。methods=${JSON.stringify(methods)}`,
    );
  }

  const currentMethod: RuntimeAuthMethod =
    selectedTab === 'api-key' ? 'api-key' : (accountMethod ?? 'oauth-device');

  return (
    <AuthGatePanelView
      runtimeName={runtimeName}
      tabs={tabs}
      selectedTab={selectedTab}
      onSelectTab={setSelectedTab}
      showOneTimeNotice={showOneTimeNotice}
      onOpenCredentials={onOpenCredentials}
    >
      {/* key=method：切 Tab 即重挂，粘贴的 code/key 局部 state 随之丢弃（安全红线）。 */}
      <AuthBranchSlot
        key={currentMethod}
        runtimeId={runtimeId}
        method={currentMethod}
        onSuccess={onSuccess}
      />
    </AuthGatePanelView>
  );
}

interface AuthBranchSlotProps {
  runtimeId: string;
  method: RuntimeAuthMethod;
  onSuccess?: (result: AuthSuccess) => void;
}

function AuthBranchSlot({ runtimeId, method, onSuccess }: AuthBranchSlotProps) {
  const flow = useRuntimeAuthFlow({ runtimeId, method, onSuccess });
  const { state } = flow;

  // 帐号授权类（device-code / setup-token）：进入即发起挑战（无前置，07 §6.2）。
  useEffect(() => {
    if (state.branch !== 'api-key' && state.phase === 'idle') flow.begin();
    // 只在挂载/分支就绪时触发一次；begin 幂等于 idle→starting。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.branch]);

  // —— 凭证明文只在本层局部 state（提交即清空，绝不进 store/persist）——
  const [pasteCode, setPasteCode] = useState('');
  const [apiKeyValue, setApiKeyValue] = useState('');

  if (state.phase === 'success') {
    return <p className="text-xs text-green-400">✅ 配置完成</p>;
  }

  if (state.branch === 'api-key') {
    return (
      <ApiKeyAuthView
        value={apiKeyValue}
        onValueChange={setApiKeyValue}
        expectedPrefix={flow.expectedPrefix}
        prefixValid={flow.isApiKeyPrefixValid(apiKeyValue)}
        submitting={state.phase === 'submitting'}
        {...(state.phase === 'rejected' ? { error: state.message, reasons: state.reasons } : {})}
        onSubmit={() => {
          flow.submitApiKey(apiKeyValue);
          setApiKeyValue('');
        }}
      />
    );
  }

  if (state.branch === 'setup-token') {
    if (state.phase === 'awaiting-paste') {
      const verificationUrl = state.challenge.verificationUrl;
      if (verificationUrl === undefined || verificationUrl === '') {
        // 契约层空值：后端漏发验证链接 → 显式提示而非空白链接（P2）。
        return (
          <RetryNotice message="授权信息缺失（验证链接为空），请重试。" onRetry={flow.begin} />
        );
      }
      return (
        <SetupTokenAuthView
          verificationUrl={verificationUrl}
          instructions={state.challenge.instructions}
          code={pasteCode}
          onCodeChange={setPasteCode}
          submitting={state.submitting}
          {...(state.error !== undefined ? { error: state.error } : {})}
          onSubmit={() => {
            flow.submitPaste(pasteCode);
            setPasteCode('');
          }}
        />
      );
    }
    if (state.phase === 'error') {
      return <RetryNotice message={state.message} onRetry={flow.begin} />;
    }
    return <p className="text-xs text-muted-foreground">正在获取授权链接…</p>;
  }

  // —— device-code ——
  if (state.phase === 'polling' || state.phase === 'expired') {
    const { userCode, verificationUrl } = state.challenge;
    if (
      userCode === undefined ||
      userCode === '' ||
      verificationUrl === undefined ||
      verificationUrl === ''
    ) {
      // 契约层空值：后端漏发设备码/验证链接 → 显式提示而非空白设备码/空链接（P2）。
      return (
        <RetryNotice
          message="设备授权信息缺失（设备码或验证链接为空），请重试。"
          onRetry={flow.begin}
        />
      );
    }
    return (
      <DeviceCodeAuthView
        userCode={userCode}
        verificationUrl={verificationUrl}
        secondsLeft={flow.secondsLeft}
        polling={state.phase === 'polling'}
        pollError={state.phase === 'polling' && state.pollError}
        expired={state.phase === 'expired'}
        onCopy={() => {
          void navigator.clipboard.writeText(userCode);
        }}
        onRefetchChallenge={flow.refetchChallenge}
      />
    );
  }
  if (state.phase === 'error') {
    return <RetryNotice message={state.message} onRetry={flow.begin} />;
  }
  return <p className="text-xs text-muted-foreground">正在获取设备码…</p>;
}

function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <p role="alert" className="text-xs text-red-400">
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        重试
      </button>
    </div>
  );
}
