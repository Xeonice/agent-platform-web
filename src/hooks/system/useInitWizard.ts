// 初始化向导的全部编排（F21-8 §4/§5）。**向导内没有任何全局 UI 状态**——步骤是本 hook 的
// 局部 state（一次性流程，无跨组件共享需求，15 §1 判定准则③）。
//
// ⚠️ **七条纪律，每一条都对应一个"改完页面看起来完全正常"的写法：**
//
//  ① **进向导直接渲染 `init-status` 里的上次检测结果，⛔ 不自动跑 `/diagnose`**（§8 约束 1）。
//     挂载即跑那一版功能上"更新"，代价是每次冷启动干等 5s×3，而结果通常与上次一模一样。
//     只有**一条历史结果都没有**（新装）或用户点 [重新检测] 时才跑。
//
//  ② **历史结果必须带上它的时刻。** 见 `connectivityVerdict.ts` 文件头 ②。
//
//  ③ **离线判定只看模型 API。** 判定在 `lib/system/connectivityVerdict.ts`，与后端
//     `assertOfflineAcknowledged` 同口径；本文件只负责把用户的 [继续] 变成
//     `acknowledgeOffline: true`。⛔ 前端不许替他填这个值——填了它，一台真的连不上模型 API
//     的机器会静默通过初始化，然后在第一个 Task 上炸。
//
//  ④ **`PUT /settings` 只存配置、不放行；只有 `POST /init` 放行**（§8 约束 2）。混用会导致
//     "填了代理还没确认资源就进了工作台"。⇒ 两个 mutation 在本文件里泾渭分明，
//     `saveProxy` 那条**碰都不碰** `systemKeys.init()` 的缓存。
//
//  ⑤ **两种 409 按码分流，⛔ 绝不"是个 409 就放行"。** 这条端点上有两种 409，处置**恰好相反**
//     （10 §6.8）：`ALREADY_INITIALIZED`（已经初始化过了 ⇒ 放行）与
//     `OFFLINE_NOT_ACKNOWLEDGED`（模型 API 全挂且没带 acknowledgeOffline ⇒ **平台一个字都没写**，
//     必须留在向导里把后端那句话说给用户看）。把 409 一律当成"已初始化 ⇒ 放行"会把一台
//     **根本没初始化**的机器放进工作台，下次刷新又被弹回向导 —— 而界面上一句错误都不会有。
//
//     ⚠️ **兜底还在，只是不再是主路**：这两个码是 2026-08 新加的，而运维方可能跑着**旧版后端**
//     （两种情况共用 `INVALID_STATE`）。⇒ 认得的码直接分流（不多打一次请求）；**认不出的 409**
//     才退回老办法：重读一次 `GET /api/system/init-status`，`initialized === true` 才放行。
//     ⛔ 兜底不许写成"认不出就放行"——那正好又变回会静默放错人的那一版。
//
//  ⑥ **[重新检测] 3s 节流的闸门是 ref 不是 state。** 连点三下发生在同一个 React 批次里，
//     此时 state 还没更新，三次点击看到的都是"没在冷却"——于是三条 SSE 流一起开。
//
//  ⑦ **整轮最多自动重试 1 次**（P21-8 §7）：自动跑的那一轮断了可以再自动跑一次，
//     第 3 次必须由用户点 [重新检测]。⛔ 无上限的自动重试在一台真的连不上的机器上
//     就是一个自己转下去的死循环。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  diagnose,
  getInitStatus,
  getResources,
  getSettings,
  init as postInit,
  putSettings,
} from '@/services/api/system.service';
import { ApiErrorException } from '@/services/api/apiError';
import { subscriptionStepModel } from '@/lib/system/subscriptionReadiness';
import type { SubscriptionStepModel } from '@/types/init';
import { RUNTIMES_QUERY_OPTIONS } from '@/hooks/credential/useRuntimes';
import { systemKeys } from '@/hooks/system/useAuditStream';
import { INIT_QUERY_OPTIONS } from '@/hooks/system/useInitGate';
import {
  connectivityCheckModel,
  connectivityFromDiagnoseDetail,
} from '@/lib/system/connectivityVerdict';
import { presetImageChainModel } from '@/lib/system/presetImageChain';
import {
  initSteps,
  nextStep,
  previousStep,
  resourceConfirmModel,
  toProxyUpdate,
} from '@/lib/system/initWizardModel';
import type {
  ConnectivityCheckModel,
  InitStepKey,
  InitStepModel,
  PresetImageChainModel,
  ProxyFormValues,
  ResourceConfirmModel,
} from '@/types/init';
import type { DiagnoseCheckFrame } from '@/types/sse-protocol';
import type { InitRequestDto, InitStatusDto } from '@/types/system';

/**
 * `POST /api/system/init` 的两种 409（10 §6.8「★ 错误码全量表」）。
 *
 * ⚠️ 写成两个具名常量而不是内联字面量，是为了让 ⑤ 那两条分支在读代码时**一眼分得出**：
 * 它们的处置恰好相反，而 `'ALREADY_INITIALIZED'` 与 `'OFFLINE_NOT_ACKNOWLEDGED'`
 * 内联在 if 里时长得太像。
 */
export const INIT_ALREADY_INITIALIZED = 'ALREADY_INITIALIZED';
export const INIT_OFFLINE_NOT_ACKNOWLEDGED = 'OFFLINE_NOT_ACKNOWLEDGED';

/** P21-8 §7：[重新检测] 3s 内不可重复点击。 */
export const RECHECK_THROTTLE_MS = 3_000;
/** ⑦ 自动跑的轮次上限（首轮 + 自动重试 1 次）。 */
export const MAX_AUTO_RUNS = 2;

const EMPTY_PROXY: ProxyFormValues = { httpProxy: '', httpsProxy: '', noProxy: '' };

interface DiagnoseRun {
  phase: PresetImageChainModel['phase'];
  /** `outbound-network` 那一帧（Step1 用）。 */
  outbound?: DiagnoseCheckFrame;
  /** `preset-image` 那一帧（Step3 用）。 */
  preset?: DiagnoseCheckFrame;
  /** 本轮结果的时刻（ISO），供 ② 那行「上次检测：…」使用。 */
  at?: string;
}

export interface UseInitWizardResult {
  step: InitStepKey;
  steps: InitStepModel[];
  /** Step2 是否进入本次流程（出网有失败项才展开，P21-8 §2）。 */
  proxyActive: boolean;

  connectivity: ConnectivityCheckModel;
  isChecking: boolean;
  recheck: () => void;
  /** >0 = 节流冷却中，view 拿它显示倒计时并 disable 按钮。 */
  recheckCooldownSec: number;

  proxyInitial: ProxyFormValues;
  saveProxyAndRecheck: (values: ProxyFormValues) => void;
  isSavingProxy: boolean;
  proxyError: string | null;

  /** 用户在 `OfflineNotice` 上点过 [继续]（③：只有他点过，才允许带 acknowledgeOffline）。 */
  offlineAcknowledged: boolean;
  acknowledgeOffline: () => void;

  presetImage: PresetImageChainModel;

  /** Step4 订阅配置。`undefined` = runtime 列表还没到。 */
  subscription: SubscriptionStepModel | undefined;
  subscriptionError: boolean;

  resource: ResourceConfirmModel | undefined;
  resourceError: boolean;

  goNext: () => void;
  goBack: () => void;
  /** 上一步（`undefined` = 已在第一步，view 据此不渲染 [上一步]）。 */
  previousStep: InitStepKey | undefined;

  finish: () => void;
  isFinishing: boolean;
  /** 保存失败的人话原因；非 null ⇒ `InitErrorPanel` + [重试]，**且不放行**。 */
  finishError: string | null;
}

export function useInitWizard(): UseInitWizardResult {
  const client = useQueryClient();
  const [step, setStep] = useState<InitStepKey>('connectivity');
  const [run, setRun] = useState<DiagnoseRun>({ phase: 'idle' });
  const [offlineAcknowledged, setOfflineAcknowledged] = useState(false);
  const [recheckCooldownSec, setRecheckCooldownSec] = useState(0);
  const [finishError, setFinishError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lastRunAtRef = useRef(0);
  const autoRunsRef = useRef(0);

  // ① 首载判定 + 上次检测结果。缓存已由 `AppBootGate` 填好，这里只是订阅同一个 key。
  const initStatus = useQuery(INIT_QUERY_OPTIONS);
  // 代理回填。⚠️ 用 `settings` 而不是 `init-status`：前者才带 `proxyConfig`。
  const settings = useQuery({
    queryKey: systemKeys.settings(),
    queryFn: getSettings,
    staleTime: 60_000,
  });
  // Step4 才要资源；`enabled` 让前三步不白白打这一次请求。
  const resources = useQuery({
    queryKey: systemKeys.resources(),
    queryFn: getResources,
    staleTime: 15_000,
    enabled: step === 'resource',
  });

  // Step4「订阅配置」：runtime 列表 + 各自凭证状态（P21-8 §2）。
  // ⚠️ **复用 `runtimeKeys.list()`，不另起一个 key**：凭证页与拦截面板用的是同一份缓存，
  //    授权成功后它们的 invalidate 会顺带把这一步刷新 —— 另起一个 key 就得自己再接一次
  //    失效链，而漏接的表现是「授权成功了，向导这一步还显示未配置」。
  const runtimes = useQuery({
    ...RUNTIMES_QUERY_OPTIONS,
    // ⚠️ 提前一步开始取（`preset-image` 时就取）：这一步一进来就要显示状态，
    //    等到进来才发请求会让列表闪一下空态。
    enabled: step === 'subscription' || step === 'preset-image',
  });

  // ——— 一轮 `/diagnose`：Step1 与 Step3 共用同一条流（§5「不新增端点」）———
  const diagnoseRun = useMutation({
    retry: 0,
    mutationFn: async (): Promise<void> => {
      // 掐掉上一条流（连点 / 保存代理后立刻重检）。旧流的迟到回调因此不会再写进 state。
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const write = (next: (prev: DiagnoseRun) => DiagnoseRun): void => {
        if (controller.signal.aborted) return;
        setRun(next);
      };
      write(() => ({ phase: 'running' }));

      try {
        await diagnose(
          {
            onStart: () => {
              /* 向导只关心两项，清单帧无需落地（八项占位是 F21-5 那张卡的事）。 */
            },
            onCheck: (frame) => {
              if (frame.id === 'outbound-network') write((prev) => ({ ...prev, outbound: frame }));
              if (frame.id === 'preset-image') write((prev) => ({ ...prev, preset: frame }));
            },
            onDone: () => {
              write((prev) => ({ ...prev, phase: 'done', at: new Date().toISOString() }));
            },
          },
          controller.signal,
        );
      } catch (error) {
        // ⚠️ **已到达项一条不动**（与 F21-5 §8 同一条）：网络抖一下不该没收用户刚拿到的结论。
        write((prev) => ({ ...prev, phase: 'aborted' }));
        throw error;
      }
    },
  });

  const runDiagnose = diagnoseRun.mutate;
  const isChecking = diagnoseRun.isPending;

  const startRun = useCallback(
    (auto: boolean): void => {
      if (auto) {
        if (autoRunsRef.current >= MAX_AUTO_RUNS) return; // ⑦
        autoRunsRef.current += 1;
      } else {
        // ⑥ 闸门用 ref 读实时时刻：同一批次里的连点都会被这一句挡住。
        if (Date.now() - lastRunAtRef.current < RECHECK_THROTTLE_MS) return;
        setRecheckCooldownSec(Math.ceil(RECHECK_THROTTLE_MS / 1000));
      }
      // ⚠️ **必须在这里同步打时刻，⛔ 不能等到 `mutationFn` 里**：`mutate()` 是异步调度的，
      //    等到 mutationFn 跑起来时，同一批次里的第二、三下点击**早就已经过了闸门**。
      //    （这条是实测出来的：打在 mutationFn 里那一版，连点 3 次发了 3 个请求。）
      lastRunAtRef.current = Date.now();
      runDiagnose(undefined, {
        onError: () => {
          // 断流已写进 `run.phase = 'aborted'` 并由 UI 呈现；这里只让 rejection 不上抛。
          //
          // ⑦ **自动重试挂在这条错误路径上，而不是"等 effect 发现这一轮失败了再补一次"。**
          //    后者实测不成立：MSW 快到 React 根本没渲染出 `isPending: true` 那一帧，
          //    于是 effect 的依赖数组前后完全相同、永远不会重跑 —— 自动重试静默地没有发生，
          //    而界面上只是多了一句「诊断中断」（看起来完全正常）。
          //    次数上限仍由 `autoRunsRef` 把着：第 3 次不再自动触发。
          if (auto) startRunRef.current?.(true);
        },
      });
    },
    [runDiagnose],
  );

  // `startRun` 自引用（⑦ 的自动重试）走 ref，避免 useCallback 依赖自己。
  const startRunRef = useRef<((auto: boolean) => void) | null>(null);
  useEffect(() => {
    startRunRef.current = startRun;
  }, [startRun]);

  // 冷却倒计时（view 显示「N 秒后可重新检测」）。⚠️ 它只是**显示**，闸门在 ⑥ 那个 ref 上。
  useEffect(() => {
    if (recheckCooldownSec <= 0) return;
    const timer = setTimeout(() => {
      setRecheckCooldownSec((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [recheckCooldownSec]);

  // 离开向导时掐掉在跑的流（诊断只读，中止无副作用）。
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const historyRows = initStatus.data?.lastConnectivityCheck;
  const hasHistory = historyRows !== undefined && historyRows.length > 0;

  // ——— ① / ⑦ 自动跑的两种情形 ———
  //  · 首屏一条历史结果都没有（新装）——否则**不跑**，直接渲染历史。
  //  · 进到 Step3 而这一轮还没有镜像结论——镜像那条没有"历史"可读，只能现跑。
  //
  // ⚠️ 判定**写在 effect 体内**而不是抽成一个 `needsAutoRun` 布尔量：抽出去时依赖数组里
  //    只剩那个布尔，而它在"断流之后"与"断流之前"都是 true —— 于是 effect 不会重跑，
  //    ⑦ 的自动重试根本不会发生（实测：只跑了 1 轮）。把 `isChecking` 与两个结果一起放进
  //    依赖，一轮跑完（isChecking 由 true 落回 false）才会重新评估。
  useEffect(() => {
    if (!initStatus.isSuccess) return;
    if (isChecking) return;
    const needsConnectivity = step === 'connectivity' && !hasHistory && run.outbound === undefined;
    const needsPreset = step === 'preset-image' && run.preset === undefined;
    if (!needsConnectivity && !needsPreset) return;
    startRun(true);
  }, [initStatus.isSuccess, isChecking, step, hasHistory, run.outbound, run.preset, startRun]);

  // ——— Step1 的模型：本轮结果优先，否则历史（② 两者都带时刻，界面上分得出来）———
  const connectivity = useMemo<ConnectivityCheckModel>(() => {
    const fresh = run.outbound;
    if (fresh !== undefined) {
      const rows = connectivityFromDiagnoseDetail(fresh.detail);
      if (rows !== undefined) {
        return connectivityCheckModel({
          rows,
          ...(run.at === undefined ? {} : { checkedAt: run.at }),
          fromHistory: false,
        });
      }
    }
    return connectivityCheckModel({
      rows: historyRows,
      ...(initStatus.data?.lastConnectivityCheckAt === undefined
        ? {}
        : { checkedAt: initStatus.data.lastConnectivityCheckAt }),
      fromHistory: true,
    });
  }, [run.outbound, run.at, historyRows, initStatus.data?.lastConnectivityCheckAt]);

  const presetImage = useMemo(
    () =>
      presetImageChainModel({
        phase: isChecking ? 'running' : run.phase,
        ...(run.preset === undefined ? {} : { frame: run.preset }),
      }),
    [isChecking, run.phase, run.preset],
  );

  // Step2 只在出网有失败项时进入流程（P21-8 §2）。
  const proxyActive = connectivity.verdict !== 'ok';

  // ——— ④ `PUT /settings`：只存配置。⛔ 这条 mutation 碰都不碰 `systemKeys.init()` ———
  const saveProxy = useMutation({
    retry: 0,
    mutationFn: (values: ProxyFormValues) => putSettings(toProxyUpdate(values)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: systemKeys.settings() });
    },
  });

  const saveProxyMutate = saveProxy.mutate;
  const saveProxyAndRecheck = useCallback(
    (values: ProxyFormValues): void => {
      saveProxyMutate(values, {
        onSuccess: () => {
          // 存完再测：不然 [重新检测] 测的永远是上一次的配置。
          // ⚠️ 这一次是**用户动作触发**的，走节流那条路（第二下点击会被 ⑥ 挡住）。
          startRun(false);
        },
      });
    },
    [saveProxyMutate, startRun],
  );

  /**
   * 放行：「目标状态已达成」，把他卡在向导里显示错误既没道理也没出路。
   *
   * ⚠️ 这里**不再重读 `init-status`**：码本身已经是答案（⑤），而放行之后 `InitStatusDto`
   * 的其余字段（上次检测结果）没有任何消费方 —— `AppBootGate` 只读 `initialized`。
   */
  const admit = useCallback(
    (status?: InitStatusDto): void => {
      setFinishError(null);
      client.setQueryData<InitStatusDto>(
        systemKeys.init(),
        (prev) =>
          status ?? (prev === undefined ? { initialized: true } : { ...prev, initialized: true }),
      );
    },
    [client],
  );

  /** ⑤ 两种 409 按码分流；认不出的 409（旧版后端）才退回「重读 init-status」那条兜底。 */
  const handleFinishError = useCallback(
    async (error: unknown): Promise<void> => {
      if (!(error instanceof ApiErrorException) || error.httpStatus !== 409) {
        setFinishError(messageOf(error));
        return;
      }
      if (error.envelope.code === INIT_ALREADY_INITIALIZED) {
        admit();
        return;
      }
      if (error.envelope.code === INIT_OFFLINE_NOT_ACKNOWLEDGED) {
        // ⛔ **不放行**。后端标了 `sideEffectFree: true`：`initialized` 仍是 false，
        //    这台机器还没被初始化。message 里已经写清了两条出路，原样上 `InitErrorPanel`。
        setFinishError(messageOf(error));
        return;
      }
      // 兜底：**旧版后端**（两种 409 共用 `INVALID_STATE`），或任何本前端认不出的 409。
      // 此时码问不出答案，只能回去问状态本身。
      try {
        const status = await getInitStatus();
        if (status.initialized) {
          admit(status);
          return;
        }
      } catch {
        // 连 init-status 都读不到 ⇒ 按普通失败处理（下面那行），⛔ 不放行。
      }
      setFinishError(messageOf(error));
    },
    [admit],
  );

  // ——— ④ `POST /init`：唯一放行的那条 ———
  const finishInit = useMutation({
    retry: 0, // 一次性、非幂等：自动重试等于制造 409（15 §2.2 `mutations.retry: 0`）。
    mutationFn: (body: InitRequestDto) => postInit(body),
    onSuccess: (data) => {
      setFinishError(null);
      client.setQueryData(systemKeys.init(), data);
    },
    onError: (error) => {
      void handleFinishError(error);
    },
  });

  const finishMutate = finishInit.mutate;
  const finish = useCallback((): void => {
    setFinishError(null);
    finishMutate({
      // ③ 只有用户在 `OfflineNotice` 上点过 [继续] 才带上它。
      ...(offlineAcknowledged ? { acknowledgeOffline: true } : {}),
      // ⚠️ **刻意不带 `proxyConfig`**：代理已由 Step2 的 `PUT /settings` 落库，而后端
      //    `markInitialized(proxy = undefined)` 明确不动已存的那份。在这里再拼一次，
      //    就得回答"用户没填的字段传什么"——而那正是 `putSettings` 注释里点名的那个坑。
    });
  }, [finishMutate, offlineAcknowledged]);

  const prevStep = previousStep(step, proxyActive);

  const goNext = useCallback((): void => {
    const next = nextStep(step, proxyActive);
    if (next !== undefined) setStep(next);
  }, [step, proxyActive]);

  const goBack = useCallback((): void => {
    if (prevStep !== undefined) setStep(prevStep);
  }, [prevStep]);

  const proxyInitial = useMemo<ProxyFormValues>(() => {
    const proxy = settings.data?.proxyConfig;
    if (proxy === undefined) return EMPTY_PROXY;
    return {
      httpProxy: proxy.httpProxy ?? '',
      httpsProxy: proxy.httpsProxy ?? '',
      noProxy: proxy.noProxy ?? '',
    };
  }, [settings.data?.proxyConfig]);

  return {
    step,
    steps: initSteps(step, proxyActive),
    proxyActive,

    connectivity,
    isChecking,
    recheck: useCallback(() => {
      startRun(false);
    }, [startRun]),
    recheckCooldownSec,

    proxyInitial,
    saveProxyAndRecheck,
    isSavingProxy: saveProxy.isPending,
    proxyError: saveProxy.error === null ? null : messageOf(saveProxy.error),

    offlineAcknowledged,
    acknowledgeOffline: useCallback(() => {
      setOfflineAcknowledged(true);
    }, []),

    presetImage,

    subscription: runtimes.data === undefined ? undefined : subscriptionStepModel(runtimes.data),
    subscriptionError: runtimes.isError,

    resource: resourceConfirmModel(resources.data),
    resourceError: resources.isError,

    goNext,
    goBack,
    previousStep: prevStep,

    finish,
    isFinishing: finishInit.isPending,
    finishError,
  };
}

/** 后端信封的 `message` 已是人话（10 §6.8），原样上 UI；非信封错误退到 `Error.message`。 */
function messageOf(error: unknown): string {
  if (error instanceof ApiErrorException) return error.envelope.message;
  if (error instanceof Error) return error.message;
  return '未知错误';
}
