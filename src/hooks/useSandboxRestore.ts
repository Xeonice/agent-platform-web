// 刷新恢复（S5 收口）：WS 帧是"错过就没了"的即时通道，**刷新后唯一能拿回任务名与失败原因的是 REST DTO**
// （`GET /api/sandboxes/:id` → `name` / `failureCode` / `failureMessage`，10 §7.3）。
//
// 本 hook 负责：持久化的 `selectedSandboxId` → 拉一次 DTO → 把状态与失败原因**种子**进 store，
// 之后仍由 /events 的 status_changed 继续推进。
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSandbox } from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';
import { useAppStore } from '@/stores';

/**
 * 终态：不会再有后续变化的三个。`stopping` / `destroying` 是过渡态,马上会落到
 * `stopped` / `destroyed`,不算。
 *
 * ⚠️ 与 `createSandboxStatusSlice` 的 `INSTALL_TERMINAL_STATUSES` **不是一回事**:
 * 那张表回答的是"装 CLI 的进度还有没有意义"(所以 `running` / `idle` 也在里面),
 * 这里回答的是"这条沙箱的故事讲完了没有"。共用会把还活着的沙箱判成旧记录。
 */
const TERMINAL_STATUSES = new Set(['failed', 'stopped', 'destroyed']);

/**
 * 终态沙箱**自动恢复**的时效上限。超过这个时长的一条已结束沙箱,冷启动时不再顶到首屏
 * (它仍在列表里,点得到),避免上一轮的失败伪装成这一轮的结果。
 *
 * 取 30 分钟的理由:这个刷新恢复特性服务的是"刷新一下别丢失败原因",实际间隔是秒到分钟;
 * 而"几小时后重新打开"已经是另一件事。仍在跑的沙箱**不受此限**——无头任务有 2h/4h 档,
 * 关掉标签页两小时后回来,那条选中理应还在。
 */
const TERMINAL_RESTORE_TTL_MS = 30 * 60 * 1000;

/** sandbox query key 族（15 §2.1）。 */
export const sandboxKeys = {
  all: () => ['sandboxes'] as const,
  detail: (id: string) => [...sandboxKeys.all(), 'detail', id] as const,
};

export interface SandboxRestore {
  /** 后端派生的默认任务名（前端不派生）。 */
  name?: string;
  /** 沙箱的 runtime（S6：无头任务 POST 路径里的 `:rt` 取它，前端不另造选择器）。 */
  runtime?: string;
  /** 沙箱实际跑在哪个 provider 档位上（S6：据此精确判定 headlessTask 能力位）。 */
  provider?: string;
  /** 该 id 在后端已不存在（404）：调用方回到新建入口。 */
  notFound: boolean;
  isPending: boolean;
}

/** `sandboxId === null` 时完全不发请求（Query 走 enabled，不做条件 hook）。 */
export function useSandboxRestore(sandboxId: string | null): SandboxRestore {
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);
  const status = useAppStore((s) =>
    sandboxId === null ? undefined : s.sandboxStatuses[sandboxId]?.status,
  );

  // 陈旧的终态选中:超过 TTL 就不再自动恢复。**在发请求之前判**——既不用打一次注定
  // 只为渲染一张幽灵卡的请求,也让容器立刻回到新建入口。
  //
  // ⚠️ 这个判断**只在挂载时算一次**(useState 惰性初值),不是每次渲染重算:下面清空选中
  // 会连带把戳置回 null(换选中不该继承旧时钟),若每次渲染重算,戳一没了 `staleTerminal`
  // 就翻回 false、query 立刻被重新 enable,那次本该省掉的请求照样发出去。语义上它本来
  // 也是个冷启动时刻的判断——"我这次打开页面,存着的这条选中还算数吗"。
  // ⚠️ **依赖一个时序前提**:惰性初值只在组件真正首次挂载时算一次,而 zustand persist
  // 的 rehydrate 即便用同步 localStorage 也是走 `.then()` 落地的 —— 页面刚起时 store
  // 会先短暂停在默认值(戳为 null)。若本 hook 在那几个 microtask 之内就完成首次渲染,
  // `staleTerminal` 会被永久锁成 false,整个 TTL 保护静默失效。
  //
  // 今天不触发,是因为 `SandboxTerminalContainer` 只在 `selectedProject !== null` 时
  // 才挂载,而它依赖 `useProjects()` 的网络请求 —— 网络 I/O 天然比那几个 microtask
  // 慢得多。但这是**别处的实现细节**在替这里兜底:哪天有人为了首屏更快把这个容器改成
  // 不等项目列表就挂载,保护会无声失效,且没有任何测试会红。
  const [staleTerminal] = useState(() => {
    const at = useAppStore.getState().selectedSandboxTerminalAt;
    return at !== null && Date.now() - at > TERMINAL_RESTORE_TTL_MS;
  });
  useEffect(() => {
    if (staleTerminal) setSelectedSandboxId(null);
  }, [staleTerminal, setSelectedSandboxId]);

  const query = useQuery({
    queryKey: sandboxKeys.detail(sandboxId ?? ''),
    queryFn: () => getSandbox(sandboxId ?? ''),
    enabled: sandboxId !== null && !staleTerminal,
    retry: false,
  });

  // 第一次观察到选中的这条进入终态 ⇒ 打时间戳。**只在戳还是 null 时写**:每次冷启动
  // 都会重新种子一遍状态,若每次都刷新这个戳,时钟永远归零、也就永远不会过期。
  const markTerminal = useAppStore((s) => s.markSelectedSandboxTerminal);
  useEffect(() => {
    if (status !== undefined && TERMINAL_STATUSES.has(status)) markTerminal();
  }, [status, markTerminal]);

  const data = query.data;
  useEffect(() => {
    if (data === undefined) return;
    // **只在 store 尚无该沙箱记录时种子**：DTO 可能比内存里的 WS 推送旧（focus refetch 等），
    // 覆盖会把用户已经看到的最新状态打回去。读 getState 而不订阅，避免种子写入触发自身重跑。
    if (useAppStore.getState().sandboxStatuses[data.id] !== undefined) return;
    setSandboxStatus(data.id, data.status, {
      // 失败原因两条通道写同一字段：这里是**刷新恢复**那条（DTO 才带自由文本细节）。
      failureCode: data.failureCode,
      failureMessage: data.failureMessage,
    });
  }, [data, setSandboxStatus]);

  const notFound = query.error instanceof ApiErrorException && query.error.httpStatus === 404;
  useEffect(() => {
    // 沙箱已被销毁/清理：清掉持久化的选中，免得每次刷新都去打一个必 404 的请求。
    // 只对 404 生效——网络抖动不该把用户的选中状态抹掉。
    if (notFound) setSelectedSandboxId(null);
  }, [notFound, setSelectedSandboxId]);

  return {
    ...(data?.name === undefined ? {} : { name: data.name }),
    ...(data?.runtime === undefined ? {} : { runtime: data.runtime }),
    ...(data?.provider === undefined ? {} : { provider: data.provider }),
    notFound,
    isPending: sandboxId !== null && !staleTerminal && query.isPending,
  };
}
