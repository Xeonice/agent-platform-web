// 凭证页 runtime 分区编排（F21-3 §4/§5）：runtimeKeys.list → 卡片模型 + 搜索 + 就地重授权面板展开 +
// 模式单选切换（确认/补配二分支）+ 吊销二次确认（受影响 Task + P0-4 文案）。副作用/lib/service 归 hook（07 §6）。
// 凭证明文不经此 hook（粘贴 code / api-key 只在 AuthGateContainer 局部 state，15 §3.5）。
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useRuntimes } from '@/hooks/credential/useRuntimes';
import {
  useSetAuthMode,
  useRevokeRuntimeCredential,
} from '@/hooks/credential/useRuntimeAuthMutations';
import {
  useRuntimeAuthPanel,
  type RuntimeAuthPanelTarget,
} from '@/hooks/credential/useRuntimeAuthPanel';
import {
  runtimeCardModel,
  switchModeDecision,
  revokeConfirmConfig,
  switchModeConfirmText,
  switchModeTitle,
  switchAfterRevokeText,
  authModeLabel,
  RUNTIME_REVOKE_WARNING,
  RUNTIME_REVOKE_FOLLOW_UP,
  RUNTIME_CREDENTIAL_STORAGE_NOTE,
  type SwitchModeDecision,
} from '@/lib/credential/runtimeCredential';
import { matchesRuntimeSearch } from '@/lib/credential/maskAccount';
import { useAffectedTasks } from '@/hooks/credential/useAffectedTasks';
import type { AffectedTasksResult } from '@/lib/credential/affectedTasks';
import { ApiErrorException } from '@/services/api/apiError';
import type {
  RuntimeCredentialCardModel,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

/**
 * 就地展开的授权面板定位（哪张卡的哪个方式）。
 *
 * ⚠️ 现在是共用类型的别名：展开态本身搬进了 {@link useRuntimeAuthPanel}，三处宿主
 * （凭证页 / 向导 / 任务侧闸门）共用同一份。本名字留着是因为它是本 hook 的对外接口。
 */
export type ExpandedAuthPanel = RuntimeAuthPanelTarget;

/** 切「当前使用」确认弹层状态。 */
export interface PendingModeSwitch {
  runtimeId: string;
  mode: RuntimeAuthMode;
  /** 弹层标题（术语表：不说「切换生效模式」，说「切换到 X」）。 */
  title: string;
  message: string;
  /** 确认按钮文案。 */
  confirmLabel: string;
}

/** 删除确认弹层状态（受影响的正在跑的任务 + P0-4 文案）。 */
export interface PendingRevoke {
  runtimeId: string;
  runtimeName: string;
  mode: RuntimeAuthMode;
  /** 模式展示名（用户语境）。 */
  modeLabel: string;
  credentialId: string;
  warnActiveMode: boolean;
  otherModeConfigured: boolean;
  affected: AffectedTasksResult;
  /**
   * 受影响清单是否**可信**（false ⇒ 弹层必须说「查不到」，不许说「没有」）。
   * 见 `useAffectedTasks` —— 这一位是本弹层里最要紧的那一位。
   */
  affectedKnown: boolean;
  warningText: string;
  /** P0-4 断言之后**能做的那件事**（去厂商后台作废）。 */
  followUpText: string;
}

/**
 * 弹层内部持有的**身份快照**（不含受影响清单 —— 那一份必须现算，见 `pendingRevokeView`）。
 */
interface PendingRevokeIdentity {
  runtimeId: string;
  runtimeName: string;
  mode: RuntimeAuthMode;
  credentialId: string;
  warnActiveMode: boolean;
  otherModeConfigured: boolean;
  otherMode: RuntimeAuthMode | null;
}

export interface CredentialsRuntimeManager {
  loading: boolean;
  /**
   * 列表**加载失败**（`useRuntimes` 的 `isError`）。
   *
   * ⛔ 此前全仓无人读它 ⇒ 接口挂了照样渲染「没有匹配的 runtime」，而用户根本没搜索过。
   * 「查不动」与「查到了但是空的」必须分开说，这一位就是那道分界。
   */
  loadError: boolean;
  /** [重试] 重新拉取列表。 */
  retryLoad: () => void;
  /** 分区就近的存放承诺（lib 常量透传；container 不得 import lib）。 */
  storageNote: string;
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

  /** [删除]：打开二次确认（列出会被重启的任务 + P0-4 文案）。 */
  requestRevoke: (runtimeId: string, mode: RuntimeAuthMode) => void;
  pendingRevoke: PendingRevoke | null;
  confirmRevoke: () => void;
  cancelRevoke: () => void;
  revoking: boolean;

  /**
   * 某 runtime 某模式行是否正被操作（切模式 / 吊销进行中）。
   * 精确 scope 到「正在操作的那一行」——切模式/吊销是单飞的，pendingSwitch/pendingRevoke 在 mutation 结束前
   * 一直持有目标 {runtimeId, mode}，据此只禁那一行，不再全局禁掉所有卡片所有行（P2）。
   */
  isRowBusy: (runtimeId: string, mode: RuntimeAuthMode) => boolean;
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof ApiErrorException && error.envelope.message !== ''
    ? error.envelope.message
    : fallback;
}

export function useCredentials(): CredentialsRuntimeManager {
  const runtimes = useRuntimes();
  const affectedTasks = useAffectedTasks();
  const setAuthModeMutation = useSetAuthMode();
  const revokeMutation = useRevokeRuntimeCredential();

  const [search, setSearch] = useState('');
  const authPanel = useRuntimeAuthPanel();
  const [pendingSwitch, setPendingSwitch] = useState<PendingModeSwitch | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<PendingRevokeIdentity | null>(null);

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

  const openPanel = authPanel.open;

  const reauth = useCallback(
    (runtimeId: string, method: RuntimeAuthMethod): void => {
      openPanel(runtimeId, method);
    },
    [openPanel],
  );

  const addKey = useCallback(
    (runtimeId: string): void => {
      openPanel(runtimeId, 'api-key');
    },
    [openPanel],
  );

  const closePanel = authPanel.close;

  // ⚠️ 刷新 + 提示 + 收起，三件都在共用 hook 里（向导与任务侧调的是同一份）——
  //    此前各写一遍时，向导那份只做了收起。
  const onAuthSuccess = authPanel.handleSuccess;

  const switchMode = useCallback(
    (runtimeId: string, mode: RuntimeAuthMode): SwitchModeDecision | null => {
      const card = cardOf(runtimeId);
      if (card === null) return null;
      const decision = switchModeDecision(card, mode);
      if (decision === null) return null;
      if (decision.kind === 'needs-setup') {
        // 切到未配置模式：不报错，就地展开该模式配置面板（F21-3 §5）。
        openPanel(runtimeId, decision.method);
      } else {
        setPendingSwitch({
          runtimeId,
          mode,
          title: switchModeTitle(mode),
          message: switchModeConfirmText(mode),
          confirmLabel: '切换',
        });
      }
      return decision;
    },
    [cardOf, openPanel],
  );

  const confirmSwitch = useCallback((): void => {
    if (pendingSwitch === null) return;
    const { runtimeId, mode } = pendingSwitch;
    setAuthModeMutation.mutate(
      { runtimeId, method: mode },
      {
        onSuccess: () => {
          toast.success(`已切换到${authModeLabel(mode)}`);
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
      // ⚠️ 这里**只存身份**，受影响清单在下面按 live query 现算 —— 快照会让「点开时列表还没到、
      //    到了之后弹层仍然写着查不到」永久定格在屏幕上。
      setPendingRevoke({
        runtimeId,
        runtimeName: card.displayName,
        mode,
        credentialId: row.credentialId,
        warnActiveMode: config.warnActiveMode,
        otherModeConfigured: config.otherModeConfigured,
        otherMode: config.otherMode,
      });
    },
    [cardOf],
  );

  /** 弹层对外形状：身份快照 + **当下**的受影响清单（含「算不算得出」那一位）。 */
  const pendingRevokeView = useMemo<PendingRevoke | null>(() => {
    if (pendingRevoke === null) return null;
    return {
      runtimeId: pendingRevoke.runtimeId,
      runtimeName: pendingRevoke.runtimeName,
      mode: pendingRevoke.mode,
      modeLabel: authModeLabel(pendingRevoke.mode),
      credentialId: pendingRevoke.credentialId,
      warnActiveMode: pendingRevoke.warnActiveMode,
      otherModeConfigured: pendingRevoke.otherModeConfigured,
      affected: affectedTasks.affectedFor(pendingRevoke.runtimeId),
      affectedKnown: affectedTasks.known,
      warningText: RUNTIME_REVOKE_WARNING,
      followUpText: RUNTIME_REVOKE_FOLLOW_UP,
    };
  }, [pendingRevoke, affectedTasks]);

  const confirmRevoke = useCallback((): void => {
    if (pendingRevoke === null) return;
    const { runtimeId, credentialId, warnActiveMode, otherMode } = pendingRevoke;
    revokeMutation.mutate(
      { runtimeId, credentialId },
      {
        onSuccess: () => {
          toast.success('已删除');
          setPendingRevoke(null);
          // 产品 §9：删掉的正是当前在用的那份，而另一种登录方式还留着 ⇒ 问一句要不要切过去。
          // ⛔ 不问的后果是**静默留下一个没有可用凭证的 Agent**，下次发任务才撞上。
          if (warnActiveMode && otherMode !== null) {
            setPendingSwitch({
              runtimeId,
              mode: otherMode,
              title: switchModeTitle(otherMode),
              message: switchAfterRevokeText(otherMode),
              confirmLabel: '切过去',
            });
          }
        },
        onError: (error) => {
          toast.error(errorMessageOf(error, '删除失败，请稍后重试。'));
          setPendingRevoke(null);
        },
      },
    );
  }, [pendingRevoke, revokeMutation]);

  const cancelRevoke = useCallback((): void => {
    setPendingRevoke(null);
  }, []);

  const switching = setAuthModeMutation.isPending;
  const revoking = revokeMutation.isPending;

  const isRowBusy = useCallback(
    (runtimeId: string, mode: RuntimeAuthMode): boolean => {
      if (
        switching &&
        pendingSwitch !== null &&
        pendingSwitch.runtimeId === runtimeId &&
        pendingSwitch.mode === mode
      ) {
        return true;
      }
      if (
        revoking &&
        pendingRevoke !== null &&
        pendingRevoke.runtimeId === runtimeId &&
        pendingRevoke.mode === mode
      ) {
        return true;
      }
      return false;
    },
    [switching, pendingSwitch, revoking, pendingRevoke],
  );

  const retryLoad = useCallback((): void => {
    void runtimes.refetch();
  }, [runtimes]);

  return {
    loading: runtimes.isPending,
    loadError: runtimes.isError,
    retryLoad,
    storageNote: RUNTIME_CREDENTIAL_STORAGE_NOTE,
    cards,
    search,
    setSearch,
    expandedPanel: authPanel.target,
    reauth,
    addKey,
    closePanel,
    onAuthSuccess,
    switchMode,
    pendingSwitch,
    confirmSwitch,
    cancelSwitch,
    switching,
    requestRevoke,
    pendingRevoke: pendingRevokeView,
    confirmRevoke,
    cancelRevoke,
    revoking,
    isRowBusy,
  };
}
