// 全局横幅栈的取数与判定编排（F21-8 §4 / 07 §8.4）。
//
// ⚠️ **四条纪律：**
//
//  ① **⛔ 不新拉一次数据。** 离线判定要的那份出网快照，`AppBootGate` 在放行之前就已经
//     拉过了（`systemKeys.init()`，`staleTime/gcTime` 均为 `Infinity`）。这里订阅**同一个
//     key、同一份选项** ⇒ 零额外请求。写成 `useQuery({queryKey: systemKeys.init(), queryFn})`
//     再给一个不同的 staleTime，界面上完全一样，代价是每次挂载都多打一次 init-status，
//     而它是首屏关键路径上的那一条。
//
//  ② **⛔ 不轮询。** `lastConnectivityCheck` 是**上次检测的快照**，不是一条活探针 ——
//     再拉一次读到的还是同一行，只是多花一次往返。真正的刷新只有一条路：用户点 [重新检测]
//     （§4 里那个按钮），它跑的是 `/diagnose`。⇒ 刷新是显式动作，不是后台定时器。
//
//  ③ **诊断结果优先于 init-status 的历史。** 用户点 [重新检测] → 在系统状态页跑完一轮 →
//     回工作台，横幅必须跟着变。只读 `init-status` 的话它永远停在冷启动那一刻的结论：
//     网络已经修好了，红条还挂着说 Agent 不可用 —— 而那正是他刚刚花了 15 秒去验证的事。
//     ⚠️ 只**读** `systemKeys.diagnose()` 缓存，⛔ 不写、也不自己起流（所有者在
//     `useSystemStatus`，见那边的 `DIAGNOSE_CACHE_OPTIONS`）。
//
//  ④ **`init-status` 读失败 ⇒ 说"读不到"，⛔ 不说"离线"。** 判定与文案在
//     `lib/system/globalBanner.ts` ①，这里只负责把「401（口令门）」摘出去：那条路上用户
//     该看到的是解锁框，在它背后再压一条红色横幅只会让人以为解锁之外还坏了别的东西。
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { INIT_QUERY_OPTIONS } from '@/hooks/system/useInitGate';
import { DIAGNOSE_CACHE_OPTIONS } from '@/hooks/system/useSystemStatus';
import { useAppStore } from '@/stores';
import { ApiErrorException } from '@/services/api/apiError';
import {
  connectivityCheckModel,
  connectivityFromDiagnoseDetail,
} from '@/lib/system/connectivityVerdict';
import {
  OFFLINE_ACTION_DISABLED_REASON,
  bannerStackModel,
  globalBanners,
  pruneDismissed,
} from '@/lib/system/globalBanner';
import type { BannerId, BannerStackModel, GlobalBannerModel } from '@/types/banner';
import type { ConnectivityCheckModel } from '@/types/init';
import type { DiagnoseRunState } from '@/types/system';

/** 出网快照 + 「平台状态读不到」的那句人话。两者都可能缺席，且**缺席的含义不同**。 */
interface ConnectivitySnapshot {
  connectivity: ConnectivityCheckModel;
  statusUnavailableReason?: string;
}

function useConnectivitySnapshot(): ConnectivitySnapshot {
  // ① 同一个 key、同一份选项 ⇒ 与 `AppBootGate` 共用一次请求。
  const init = useQuery(INIT_QUERY_OPTIONS);
  // ③ 只读订阅：`enabled:false`，queryFn 永不执行。
  const diagnose = useQuery<DiagnoseRunState>(DIAGNOSE_CACHE_OPTIONS);
  // ④ 401 由 `AccessGateContainer` 负责；这里闭嘴。
  const accessLocked = useAppStore((s) => s.accessLocked);

  const fresh = diagnose.data?.results['outbound-network'];
  const initData = init.data;
  const initError = init.error;

  return useMemo(() => {
    const freshRows =
      fresh === undefined ? undefined : connectivityFromDiagnoseDetail(fresh.detail);

    if (freshRows !== undefined) {
      return {
        connectivity: connectivityCheckModel({
          rows: freshRows,
          // 诊断帧不带时刻；这一轮是"刚刚"跑的，不编一个假时间戳出来。
          fromHistory: false,
        }),
      };
    }

    const connectivity = connectivityCheckModel({
      rows: initData?.lastConnectivityCheck,
      ...(initData?.lastConnectivityCheckAt === undefined
        ? {}
        : { checkedAt: initData.lastConnectivityCheckAt }),
      fromHistory: true,
    });

    // ④ 401 ⇒ 一个字都不说（解锁框正在浮出）。
    const unauthorized =
      accessLocked || (initError instanceof ApiErrorException && initError.httpStatus === 401);
    if (initError === null || unauthorized) return { connectivity };

    return { connectivity, statusUnavailableReason: messageOf(initError) };
  }, [fresh, initData, initError, accessLocked]);
}

export interface GlobalBannerApi {
  model: BannerStackModel;
  /** 显式关闭一条（🔴 阻断类只在**本次会话**内生效，见 `types/banner.ts`）。 */
  dismiss: (id: BannerId) => void;
  /** 横幅动作：置「进系统状态页就跑一轮诊断」的意图位。跳转由 container 做。 */
  requestRecheck: () => void;
}

export function useGlobalBanner(): GlobalBannerApi {
  const snapshot = useConnectivitySnapshot();
  const [dismissed, setDismissed] = useState<BannerId[]>([]);
  const requestDiagnoseAutorun = useAppStore((s) => s.requestDiagnoseAutorun);

  const banners = useMemo<GlobalBannerModel[]>(
    () =>
      globalBanners({
        connectivity: snapshot.connectivity,
        ...(snapshot.statusUnavailableReason === undefined
          ? {}
          : { statusUnavailableReason: snapshot.statusUnavailableReason }),
      }),
    [snapshot],
  );

  // 回收已消失那条的关闭记录 —— 否则"关闭"会变成永久的（见 `pruneDismissed` 注释）。
  // ⚠️ 在**渲染期**算而不是在 effect 里 set：effect 会晚一帧，那一帧里横幅已经该出现却还被
  //    过滤掉；而 `dismissed` 只在真的变化时才 set（下面那个 `!==` 比较），不会打循环。
  const live = useMemo(() => pruneDismissed(dismissed, banners), [dismissed, banners]);
  if (live.length !== dismissed.length) setDismissed(() => live);

  const model = useMemo(() => bannerStackModel(banners, live), [banners, live]);

  const dismiss = useCallback((id: BannerId): void => {
    setDismissed((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  return { model, dismiss, requestRecheck: requestDiagnoseAutorun };
}

export interface OfflineModeApi {
  /** 模型 API 全不可达（且**确实测过**）。 */
  offline: boolean;
  /**
   * 发起类入口的置灰理由（P21-8 §7 清单里的 tooltip 文案）；`undefined` = 不因离线而置灰。
   *
   * ⚠️ **只置灰不隐藏**（P21-8 §7）：用户配好网络后不该需要重装才能重新看到入口。
   */
  disabledReason?: string;
}

/**
 * 「离线模式」这一个事实的对外出口 —— 横幅与 [+ 新任务] 置灰**读同一份判定**。
 *
 * ⚠️ 分成两个布尔各算各的时，界面上会出现红条说 Agent 不可用、而 [+ 新任务] 照样能点，
 * 或者反过来。两者是同一句话的两半。
 */
export function useOfflineMode(): OfflineModeApi {
  const { connectivity } = useConnectivitySnapshot();
  const offline = connectivity.hasResult && connectivity.verdict === 'offline';
  return offline ? { offline, disabledReason: OFFLINE_ACTION_DISABLED_REASON } : { offline };
}

/** 后端信封的 `message` 已是人话（10 §6.8）；非信封错误退到 `Error.message`。 */
function messageOf(error: unknown): string {
  if (error instanceof ApiErrorException) return error.envelope.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}
