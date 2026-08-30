// 系统状态页四张卡的取数与诊断编排（F21-5 §4/§5、15 §2.1/§2.2）。
//
// ⚠️ **三条纪律，每一条都对应一个"改完页面看起来完全正常"的写法：**
//
//  ① **诊断结果写 `systemKeys.diagnose()` 缓存，不是组件局部 state。** 产品要求是"切走
//     再回来结果仍在"（F21-5 §4 非阻塞那一行）——而用户切走的目的，恰恰是照着结果去改
//     配置。放局部 state 时页面表现毫无差别，只有"回来"那一下八项全没了。
//     ⇒ `staleTime: Infinity` + `gcTime: 30min`（15 §2.2），且这条 query **没有 queryFn
//     会被调用**：它的数据只由 SSE 流 `setQueryData` 写入。
//
//  ② **诊断 mutation 不锁 UI。** 运行中其它区域照常可交互（§7.3「诊断非阻塞」）：
//     这里只把"正在跑"透出去给 [重新诊断] 那一个按钮，⛔ 不产出任何全页 disabled/遮罩。
//
//  ③ **重入保护是"掐掉旧流"而不是"忽略新点击"。** 连点两下时，忽略第二下会让用户以为
//     按钮坏了；两条流同时写同一个缓存则会产生交错的脏结果（F21-5 §9.3 缺口 #20）。
//     ⇒ 新的一轮先 `abort()` 上一条，再开新的；旧流的回调因此不会再落进缓存。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DiagnoseStreamAborted,
  diagnose,
  getProviders,
  getResources,
} from '@/services/api/system.service';
import { systemKeys } from '@/hooks/system/useAuditStream';
import { useAppStore } from '@/stores';
import {
  applyDiagnoseCheck,
  applyDiagnoseDone,
  applyDiagnoseStart,
  beginDiagnose,
  markDiagnoseAborted,
} from '@/lib/system/diagnoseModel';
import type { DiagnoseRunState, SystemProvidersDto, SystemResourcesDto } from '@/types/system';

/** 15 §2.2：运维看板 15s stale + 30s 轮询。 */
export const SYSTEM_STALE_MS = 15_000;
export const SYSTEM_POLL_MS = 30_000;
/** 15 §2.2：诊断结果跨路由保留半小时。 */
export const DIAGNOSE_GC_MS = 30 * 60_000;

/**
 * 诊断结果缓存的**只读订阅口**。`enabled: false` ⇒ `queryFn` 永不执行；组件仍然订阅这个
 * key，SSE 每 `setQueryData` 一次就重渲染一次。
 *
 * ⚠️ **抽成常量是为了让第二个订阅方（`useGlobalBanner`）用同一份选项**。同一个 queryKey
 * 被两处用不同的 `gcTime` 声明时，缓存什么时候被回收取决于哪个观察者先卸载 —— 表现是
 * 「从系统状态页跑完诊断、回工作台，横幅有时更新有时不更新」，而两次操作一模一样。
 * ⛔ 第二个订阅方**只读不写**：诊断流的唯一所有者是本文件的 mutation（它有掐旧流的重入保护）。
 */
export const DIAGNOSE_CACHE_OPTIONS = {
  queryKey: systemKeys.diagnose(),
  queryFn: (): never => {
    throw new Error('诊断结果只由 SSE 流写入缓存，不经 queryFn 拉取');
  },
  enabled: false,
  staleTime: Infinity,
  gcTime: DIAGNOSE_GC_MS,
} as const;

export interface UseSystemStatusResult {
  resources: SystemResourcesDto | undefined;
  resourcesError: boolean;
  providers: SystemProvidersDto | undefined;
  providersError: boolean;
  isLoading: boolean;
  /** 手动 [刷新]：两个 query 一起重取。 */
  refresh: () => void;
  isRefreshing: boolean;

  /** 诊断的**唯一**真相源（Query 缓存）；`undefined` = 这个会话还没跑过。 */
  diagnoseState: DiagnoseRunState | undefined;
  runDiagnose: () => void;
  isDiagnosing: boolean;
  /**
   * 服务端 `X-Schema-Hash` 与本仓认识的对不上。
   * ⚠️ **它是提示不是拦截**：帧照常渲染（`sse-protocol.ts` 里那条"告知不是门"）。
   */
  schemaMismatch: string | null;
}

export function useSystemStatus(): UseSystemStatusResult {
  const client = useQueryClient();
  const [schemaMismatch, setSchemaMismatch] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resources = useQuery({
    queryKey: systemKeys.resources(),
    queryFn: getResources,
    staleTime: SYSTEM_STALE_MS,
    refetchInterval: SYSTEM_POLL_MS,
  });

  const providers = useQuery({
    queryKey: systemKeys.providers(),
    queryFn: getProviders,
    staleTime: SYSTEM_STALE_MS,
    refetchInterval: SYSTEM_POLL_MS,
  });

  // ——— 诊断结果：只读缓存的订阅口（选项见 `DIAGNOSE_CACHE_OPTIONS`）———
  const diagnoseCache = useQuery<DiagnoseRunState>(DIAGNOSE_CACHE_OPTIONS);

  const diagnoseMutation = useMutation({
    // ⚠️ `retry: 0`：诊断是"用户点一下跑一轮"，自动重试会在他已经看到中断提示之后
    //    悄悄再跑一轮，把界面上的结论换掉（F21-5 §7.1 hooks ③）。
    retry: 0,
    mutationFn: async (): Promise<void> => {
      // ③ 掐掉上一条流（连点/快速重跑）。
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const key = systemKeys.diagnose();
      const write = (next: (prev: DiagnoseRunState | undefined) => DiagnoseRunState): void => {
        // 旧流的迟到回调不许再落进缓存（否则两轮结果交错）。
        if (controller.signal.aborted) return;
        client.setQueryData<DiagnoseRunState>(key, next);
      };

      write(beginDiagnose);
      try {
        await diagnose(
          {
            onStart: (frame) => {
              write(() => applyDiagnoseStart(frame));
            },
            onCheck: (frame) => {
              write((prev) =>
                prev === undefined ? beginDiagnose(prev) : applyDiagnoseCheck(prev, frame),
              );
            },
            onDone: (frame) => {
              write((prev) =>
                prev === undefined ? beginDiagnose(prev) : applyDiagnoseDone(prev, frame),
              );
            },
            onSchemaMismatch: setSchemaMismatch,
          },
          controller.signal,
        );
      } catch (error) {
        // ⚠️ **已到达项一条不动**（F21-5 §8）：只把阶段翻成 `aborted`，UI 据此在
        //    已有结果上方挂一句「诊断中断 [重新诊断]」。
        write((prev) => (prev === undefined ? beginDiagnose(prev) : markDiagnoseAborted(prev)));
        throw error;
      }
    },
  });

  // 离开页面时掐掉在跑的流（诊断只读，中止无副作用；02 §5.3）。
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const mutate = diagnoseMutation.mutate;
  const runDiagnose = useCallback(() => {
    mutate(undefined, {
      onError: (error) => {
        // 断流已在 mutationFn 里写进缓存并由 UI 呈现；其余错误（如 500）同理，
        // 这里只是让 mutation 的 rejection 不变成 unhandled。
        if (error instanceof DiagnoseStreamAborted) return;
      },
    });
  }, [mutate]);

  // ——— 全局横幅的 [重新检测] 落地点（F21-5 §2「从横幅 [诊断] 进入 → 自动开始诊断」）———
  //
  // ⚠️ **横幅自己不跑诊断**。它跑得起来（`system.service.ts` 的 `diagnose()` 谁都能调），
  //    但那会造出**第二个写 `systemKeys.diagnose()` 的所有者** —— 而重入保护（掐掉旧流）
  //    只存在于本文件那条 mutation 里，两条流并行时会把交错的脏结果写进同一个缓存。
  //    何况在工作台点一下之后 5–15 秒内界面上什么都不会发生（八项结果流进一个没人渲染的缓存）。
  //    ⇒ 横幅只**表达意图**（store 上一个瞬时位）+ 跳这一页，诊断仍然只有一个所有者。
  //
  // ⚠️ 用 store 而不是 `?autorun=1`：F21-5 §2 把 query 参数标成「（可选）」。而 URL 那条要
  //    `useSearchParams()`，在 App Router 的静态路由上必须额外套 Suspense 才能过 `next build` ——
  //    为一个一次性的瞬时意图换来一个构建期陷阱不划算。代价是深链 `?autorun=1` 不生效，
  //    但今天没有任何地方产出那种链接。
  //
  // ⚠️ **先清标志再跑**：反过来写时，`runDiagnose()` 引起的重渲染里标志还是 true，
  //    effect 会再跑一轮（StrictMode 下必现）。
  const autorunRequested = useAppStore((s) => s.diagnoseAutorunRequested);
  const clearAutorun = useAppStore((s) => s.clearDiagnoseAutorun);
  useEffect(() => {
    if (!autorunRequested) return;
    clearAutorun();
    runDiagnose();
  }, [autorunRequested, clearAutorun, runDiagnose]);

  const refetchResources = resources.refetch;
  const refetchProviders = providers.refetch;
  const refresh = useCallback(() => {
    void refetchResources();
    void refetchProviders();
  }, [refetchResources, refetchProviders]);

  return {
    resources: resources.data,
    resourcesError: resources.isError,
    providers: providers.data,
    providersError: providers.isError,
    isLoading: resources.isPending || providers.isPending,
    refresh,
    isRefreshing: resources.isFetching || providers.isFetching,
    diagnoseState: diagnoseCache.data,
    runDiagnose,
    isDiagnosing: diagnoseMutation.isPending,
    schemaMismatch,
  };
}
