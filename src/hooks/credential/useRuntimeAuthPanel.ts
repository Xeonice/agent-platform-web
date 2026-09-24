// 三处宿主共用的「授权面板展开态」（F07 §6.1：凭证页卡片内嵌 / 初始化向导 / 任务侧闸门）。
//
// ── 它修的是什么 ──────────────────────────────────────────────────────────────
// 三处早就共用同一个 `AuthGateContainer`，但**只共用了组件，没共用交互模型**：
// 凭证页与向导的面板由用户点开（`expandedPanel` / `expandedRuntime` 都是本地 UI 状态），
// 任务侧那一份却直接拿服务端的 `credentialStatus` 算 —— `authBlocked` 为真就挂载。
//
// ⛔ 而面板**挂载即发起登录**（`AuthBranchSlot` 的 effect 在 `phase === 'idle'` 时调
// `begin()`，那段是三处共用的、本身没错），后端 `beginAuth` 每次都新开一个 CLI 会话、
// **既不去重也不取消上一个**。两者一叠加，「选中一个没配凭证的 runtime」这种纯浏览动作
// 就会真的在 helper 容器里拉起一个登录进程。
//
// 2026-09-24 真机实测（新建任务面板里点三下单选框：claude-code → codex → claude-code，
// 全程没碰任何授权按钮）：helper 里堆出 3 个隔离会话、2 个并存的 `claude setup-token`、
// 35 个 chrome 进程（`claude setup-token` 会 `xdg-open`，而 AIO 镜像自带桌面），
// 内存 94MB → 479MB / 512MB（93.6%）—— 再点几下整个 helper 就 OOM，届时连凭证刷新
// 和别的 runtime 登录一起死。
//
// ⇒ 展开态收到这一处，三处共用：**面板在不在，只能由人决定**（`open` / `close`），
//   ⛔ 不许由服务端状态算出来。`credentialStatus` 仍然决定「拦不拦」，但拦下来之后
//   给的是一个按钮，不是一个已经跑起来的登录会话。
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { notifyRuntimeAuthConfigured } from '@/hooks/credential/useRuntimeAuthMutations';
import type { RuntimeAuthMethod } from '@/types/runtimeCredential';

/** 就地展开的授权面板定位（哪个 runtime，可选哪个方式）。 */
export interface RuntimeAuthPanelTarget {
  runtimeId: string;
  /**
   * 指定方式打开 —— 凭证页按「行」展开需要它（帐号授权行 / API Key 行各自对应一个 tab）。
   * ⚠️ 缺席是**合法**的：向导与任务侧按 runtime 整体展开，用面板自己的默认 tab。
   */
  method?: RuntimeAuthMethod;
}

export interface RuntimeAuthPanel {
  /** 当前展开的目标；`null` = 没有面板在场。 */
  target: RuntimeAuthPanelTarget | null;
  /** 这个 runtime 的面板是否展开着（宿主按 runtime 渲染时用）。 */
  isOpenFor: (runtimeId: string) => boolean;
  /** 用户要求展开（点「配置」/「重新授权」/「开始登录」）。 */
  open: (runtimeId: string, method?: RuntimeAuthMethod) => void;
  /** 收起（点「收起」/「取消」/切走 runtime）。 */
  close: () => void;
  /**
   * 授权成功：刷新 runtime 两族 + toast + 收起面板，**三件一起**。
   *
   * ⚠️ 这三件此前在凭证页与向导各写一遍，向导那份只做了收起 —— 凭证已落库、界面却
   * 无声无息（`notifyRuntimeAuthConfigured` 的注释记着那次）。收进来就不会再漏。
   */
  handleSuccess: () => void;
}

/**
 * @param successMessage 授权成功的 toast 文案；缺席用 `notifyRuntimeAuthConfigured` 的默认值。
 */
export function useRuntimeAuthPanel(successMessage?: string): RuntimeAuthPanel {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<RuntimeAuthPanelTarget | null>(null);

  const open = useCallback((runtimeId: string, method?: RuntimeAuthMethod): void => {
    // ⚠️ 不写 `{ runtimeId, method }` —— 仓库开着 `exactOptionalPropertyTypes`，
    //    显式的 `method: undefined` 与「没有 method」不是一回事。
    setTarget(method === undefined ? { runtimeId } : { runtimeId, method });
  }, []);

  const close = useCallback((): void => {
    setTarget(null);
  }, []);

  const handleSuccess = useCallback((): void => {
    if (successMessage === undefined) notifyRuntimeAuthConfigured(queryClient);
    else notifyRuntimeAuthConfigured(queryClient, successMessage);
    setTarget(null);
  }, [queryClient, successMessage]);

  const isOpenFor = useCallback(
    (runtimeId: string): boolean => target?.runtimeId === runtimeId,
    [target],
  );

  return { target, isOpenFor, open, close, handleSuccess };
}
