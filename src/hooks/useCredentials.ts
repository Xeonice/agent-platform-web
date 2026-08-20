// 凭证页 runtime 分区编排（F21-3 §4/§5）：runtimeKeys.list → 卡片模型 + 搜索 + 就地重授权面板展开 +
// 模式单选切换（确认/补配二分支）+ 吊销二次确认（受影响 Task + P0-4 文案）。副作用/lib/service 归 hook（07 §6）。
// 凭证明文不经此 hook（粘贴 code / api-key 只在 AuthGateContainer 局部 state，15 §3.5）。
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRuntimes } from '@/hooks/useRuntimes';
import {
  useSetAuthMode,
  useRevokeRuntimeCredential,
  invalidateRuntimeAuth,
} from '@/hooks/useRuntimeAuthMutations';
import {
  runtimeCardModel,
  switchModeDecision,
  revokeConfirmConfig,
  switchModeConfirmText,
  RUNTIME_REVOKE_WARNING,
  type SwitchModeDecision,
} from '@/lib/runtimeCredential';
import { matchesRuntimeSearch } from '@/lib/maskAccount';
import { affectedRunningTasks, type AffectedTasksResult } from '@/lib/affectedTasks';
import { ApiErrorException } from '@/services/api/apiError';
import type {
  RuntimeCredentialCardModel,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

/** 就地展开的授权面板定位（哪张卡的哪个方式）。 */
export interface ExpandedAuthPanel {
  runtimeId: string;
  method: RuntimeAuthMethod;
}

/** 切模式确认弹层状态。 */
export interface PendingModeSwitch {
  runtimeId: string;
  mode: RuntimeAuthMode;
  message: string;
}

/** 吊销确认弹层状态（受影响 Task + P0-4 文案）。 */
export interface PendingRevoke {
  runtimeId: string;
  runtimeName: string;
  mode: RuntimeAuthMode;
  credentialId: string;
  warnActiveMode: boolean;
  otherModeConfigured: boolean;
  affected: AffectedTasksResult;
  warningText: string;
}

export interface CredentialsRuntimeManager {
  loading: boolean;
  cards: RuntimeCredentialCardModel[];
  search: string;
  setSearch: (q: string) => void;

  expandedPanel: ExpandedAuthPanel | null;
  /** [帐号授权]/[重新授权]：就地展开帐号授权面板（未配置态无前置，F21-3 §5）。 */
  reauth: (runtimeId: string, method: RuntimeAuthMethod) => void;
  /** [添加 API Key]/[更换]：就地展开 api-key 面板。 */
  addKey: (runtimeId: string) => void;
  closePanel: () => void;
  /** 面板内配置成功：invalidate runtime 两族 + 收起面板 + toast。 */
  onAuthSuccess: () => void;

  /** ◉/○ 切模式：目标已配置 → 确认弹层；未配置 → 就地补配（返回决策供测试断言）。 */
  switchMode: (runtimeId: string, mode: RuntimeAuthMode) => SwitchModeDecision | null;
  pendingSwitch: PendingModeSwitch | null;
  confirmSwitch: () => void;
  cancelSwitch: () => void;
  switching: boolean;

  /** [吊销]：打开二次确认（列受影响运行中 Task + P0-4 文案）。 */
  requestRevoke: (runtimeId: string, mode: RuntimeAuthMode) => void;
  pendingRevoke: PendingRevoke | null;
  confirmRevoke: () => void;
  cancelRevoke: () => void;
  revoking: boolean;
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiErrorException && error.envelope.message !== ''
    ? error.envelope.message
    : fallback;
}

export function useCredentials(): CredentialsRuntimeManager {
  const queryClient = useQueryClient();
  const runtimes = useRuntimes();
  const setAuthModeMutation = useSetAuthMode();
  const revokeMutation = useRevokeRuntimeCredential();

  const [search, setSearch] = useState('');
  const [expandedPanel, setExpandedPanel] = useState<ExpandedAuthPanel | null>(null);
  const [pendingSwitch, setPendingSwitch] = useState<PendingModeSwitch | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PendingRevoke | null>(null);

  const allCards = useMemo<RuntimeCredentialCardModel[]>(
    () => (runtimes.data ?? []).map((rt) => runtimeCardModel(rt)),
    [runtimes.data],
  );

  const cards = useMemo<RuntimeCredentialCardModel[]>(() => {
    const q = search.trim();
    if (q === '') return allCards;
    return allCards.filter((card) => {
      const identifiers = card.rows.map((r) => r.maskedIdentifier);
      return (
        matchesRuntimeSearch(q, card.displayName, undefined) ||
        identifiers.some((id) => matchesRuntimeSearch(q, card.displayName, id))
      );
    });
  }, [allCards, search]);

  const cardOf = useCallback(
    (runtimeId: string) => allCards.find((c) => c.runtimeId === runtimeId) ?? null,
    [allCards],
  );

  const reauth = useCallback((runtimeId: string, method: RuntimeAuthMethod): void => {
    setExpandedPanel({ runtimeId, method });
  }, []);

  const addKey = useCallback((runtimeId: string): void => {
    setExpandedPanel({ runtimeId, method: 'api-key' });
  }, []);

  const closePanel = useCallback((): void => {
    setExpandedPanel(null);
  }, []);

  const onAuthSuccess = useCallback((): void => {
    invalidateRuntimeAuth(queryClient);
    setExpandedPanel(null);
    toast.success('凭证已更新');
  }, [queryClient]);

  const switchMode = useCallback(
    (runtimeId: string, mode: RuntimeAuthMode): SwitchModeDecision | null => {
      const card = cardOf(runtimeId);
      if (card === null) return null;
      const decision = switchModeDecision(card, mode);
      if (decision === null) return null;
      if (decision.kind === 'needs-setup') {
        // 切到未配置模式：不报错，就地展开该模式配置面板（F21-3 §5）。
        setExpandedPanel({ runtimeId, method: decision.method });
      } else {
        setPendingSwitch({ runtimeId, mode, message: switchModeConfirmText(mode) });
      }
      return decision;
    },
    [cardOf],
  );

  const confirmSwitch = useCallback((): void => {
    if (pendingSwitch === null) return;
    const { runtimeId, mode } = pendingSwitch;
    setAuthModeMutation.mutate(
      { runtimeId, method: mode },
      {
        onSuccess: () => {
          toast.success('已切换生效模式');
          setPendingSwitch(null);
        },
        onError: (error) => {
          toast.error(errorMessageOf(error, '切换失败，请稍后重试。'));
          setPendingSwitch(null);
        },
      },
    );
  }, [pendingSwitch, setAuthModeMutation]);

  const cancelSwitch = useCallback((): void => {
    setPendingSwitch(null);
  }, []);

  const requestRevoke = useCallback(
    (runtimeId: string, mode: RuntimeAuthMode): void => {
      const card = cardOf(runtimeId);
      if (card === null) return;
      const config = revokeConfirmConfig(card, mode);
      const row = card.rows.find((r) => r.mode === mode);
      if (config === null || row?.credentialId === undefined) return;
      // 受影响运行中 Task：来自 sandbox 列表（本切片暂无 sandbox 列表 query → 空；接入后传入即联动）。
      const affected = affectedRunningTasks([], runtimeId);
      setPendingRevoke({
        runtimeId,
        runtimeName: card.displayName,
        mode,
        credentialId: row.credentialId,
        warnActiveMode: config.warnActiveMode,
        otherModeConfigured: config.otherModeConfigured,
        affected,
        warningText: RUNTIME_REVOKE_WARNING,
      });
    },
    [cardOf],
  );

  const confirmRevoke = useCallback((): void => {
    if (pendingRevoke === null) return;
    const { runtimeId, credentialId } = pendingRevoke;
    revokeMutation.mutate(
      { runtimeId, credentialId },
      {
        onSuccess: () => {
          toast.success('凭证已吊销');
          setPendingRevoke(null);
        },
        onError: (error) => {
          toast.error(errorMessageOf(error, '吊销失败，请稍后重试。'));
          setPendingRevoke(null);
        },
      },
    );
  }, [pendingRevoke, revokeMutation]);

  const cancelRevoke = useCallback((): void => {
    setPendingRevoke(null);
  }, []);

  return {
    loading: runtimes.isPending,
    cards,
    search,
    setSearch,
    expandedPanel,
    reauth,
    addKey,
    closePanel,
    onAuthSuccess,
    switchMode,
    pendingSwitch,
    confirmSwitch,
    cancelSwitch,
    switching: setAuthModeMutation.isPending,
    requestRevoke,
    pendingRevoke,
    confirmRevoke,
    cancelRevoke,
    revoking: revokeMutation.isPending,
  };
}
