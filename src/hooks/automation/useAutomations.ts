// 自动化规则：列表 Query + CRUD/启停 mutation（F21-7 §4/§5）。
//
// ★ **`automationKeys` 在这里，不在 `services/api/queryKeys.ts`。**
//   15 §2.1 把全部 key 工厂画在一个 `services/api/queryKeys.ts` 里，**那个文件磁盘上不存在**；
//   仓内 10 个工厂无一例外写在**拥有这条 query 的 hook 文件**里（`useAuditStream.ts` 的
//   `systemKeys` 注释已经把这条约定写死过一次）。这一轮跟仓走，不跟文档走。
//
// ⚠️ F21-7 §8 曾把「`automationKeys` 已合入 15 §2.1」标成 **✅**。那是假的：全仓搜
//   `automationKeys` 此前只命中 `useAuditStream` 里的**一处注释**，代码里一行都没有。
//   本文件是它第一次真的存在。
import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAutomation,
  deleteAutomation,
  listAutomations,
  setAutomationEnabled,
  testWebhook,
  updateAutomation,
} from '@/services/api/automation.service';
import { ApiErrorException } from '@/services/api/apiError';
import { automationRows } from '@/lib/automation/automationModel';
import { automationErrorMessage } from '@/lib/automation/automationErrorCopy';
import {
  automationAttention,
  type AutomationAttention,
} from '@/lib/automation/automationAttention';
import { resolveEnvironmentTimeZone } from '@/lib/automation/timeZone';
import {
  AUTOMATION_RULE_LIMIT,
  type AutomationDto,
  type AutomationRow,
  type CreateAutomationRequest,
  type UpdateAutomationRequest,
} from '@/types/automation';

/**
 * 自动化 query key 工厂（15 §2.1 的四把，分层原则 `[资源域, 子类型, id/参数]`）。
 *
 * ⚠️ **`runs` 与 15 §2.1 有一处刻意的不同：这里的签名是 `runs(ruleId)`，没有 `page`。**
 *    文档写的是 `runs(ruleId, page)`（每页各自一份缓存）。不照做的理由是正确性，不是省事：
 *
 *    运行历史走 `page/pageSize` 偏移分页，而这条列表是**从头部追加**的。若每页各占一把 key，
 *    第 1 页与第 2 页就是**在两个不同时刻各自拉回来的两张快照**，拼在一起是一段蒙太奇：
 *    中间新记了 3 条运行，第 2 页的头 3 条就是第 1 页的尾 3 条，界面上同一次运行出现两遍，
 *    **而且看起来完全正常**。这正是 `hooks/system/useAuditStream` 文件头 ① 点名的那个坑
 *    （"此前 `automationKeys.runs` 用的是 offset 页码，那套照抄过来会静默错位"）。
 *
 *    ⇒ 改成一把 key + `useInfiniteQuery`：所有页在同一把 key 下，invalidate 时**整体重取**，
 *      拼出来的永远是同一个时刻的快照；再叠一层按 id 去重（`dedupeRunsById`）兜住
 *      两次 fetch 之间的追加。⚠️ `useAuditStream` ② 警告的"infinite + 轮询会重拉全部页"
 *      在这里不成立：运行历史**没有 `refetchInterval`**（15 §2.2 也没给它配），
 *      重取只发生在用户主动操作之后，那时"整体一致"恰恰是我们要的。
 */
export const automationKeys = {
  all: () => ['automations'] as const,
  list: (projectId: string) => [...automationKeys.all(), 'list', { projectId }] as const,
  /** 见上：**不带 page**，页码活在 `useInfiniteQuery` 的 pageParam 里。 */
  runs: (ruleId: string) => [...automationKeys.all(), 'runs', ruleId] as const,
  run: (runId: string) => [...automationKeys.all(), 'run', runId] as const,
};

/**
 * 后端信封 → 人话。裸抛 `HTTP 500` 给用户看没有意义。
 *
 * ★ **判据从 HTTP 状态码改成信封里的码**（与 `useProjectBranches` 的裁决同一条）。
 *   旧写法两处都有问题：
 *   ① `httpStatus === 409` 一律说成"规则数已达上限" —— 后端在这个上下文里还会发别的
 *      409（规则状态机违规），那时用户会被告知一个假的原因，然后去删一条本不用删的规则；
 *   ② 其余一律 `return error.envelope.message` ⇒ 后端那三句英文原文直通用户
 *      （非法时区那条甚至带一整段解释设计取舍的英文散文）。中文兜底恒不执行，因为
 *      `message` 永远非空。
 *   ⇒ 现在按码查 `AUTOMATION_ERROR_COPY`；未知码给通用话 + traceId。
 */
export function describeAutomationError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (!(error instanceof ApiErrorException)) return '网络不通，请稍后再试。';
  return automationErrorMessage(
    error.envelope.code,
    error.envelope.traceId,
    '操作失败，请稍后重试。',
  );
}

/**
 * 自动化侧「需要用户知道的事」的只读订阅 —— **给全局横幅层用的那一位**。
 *
 * ★ **⛔ 不新拉一次数据**（与 `useGlobalBanner` 文件头纪律 ① 同一手法）：`enabled:false`
 *   ⇒ queryFn 永不执行，只读 `automationKeys.list(projectId)` 这份**已经在缓存里**的
 *   规则列表。写成一个会自己发请求的 hook，代价是每次挂载都多打一次列表接口，
 *   而横幅挂在工作台外壳上、随每一次页面加载而挂载。
 *
 * ⚠️ 缓存里没有 ⇒ `hasData:false`，含义是**「这一刻我们不知道」**，
 *   ⛔ 不是「没有问题」。判定与文案见 `lib/automation/automationAttention`。
 */
export function useAutomationAttention(projectId: string | null): AutomationAttention {
  const query = useQuery<AutomationDto[]>({
    queryKey: automationKeys.list(projectId ?? ''),
    enabled: false,
  });
  const data = query.data;
  return useMemo(() => automationAttention(data), [data]);
}

export interface UseAutomationsResult {
  rows: AutomationRow[];
  /** 原始 DTO：表单要用它回填草稿（视图模型是格式化过的字符串，回填不回去）。 */
  dtos: AutomationDto[];
  loading: boolean;
  loadErrorMessage?: string;
  actionErrorMessage?: string;
  /** 规则数已达 20（P21-7 §3.2）→ [+ 新建规则] 置灰 + 上限提示。 */
  atLimit: boolean;
  /** 正在启停的那条 id：**只禁这一行**。 */
  togglingId: string | null;
  savingId: string | null;
  create: (body: CreateAutomationRequest) => Promise<AutomationDto>;
  update: (id: string, body: UpdateAutomationRequest) => Promise<AutomationDto>;
  remove: (id: string) => Promise<void>;
  /** 启停。`true` 走 `/enable`，同时清零失败计数（03 §8.4）。 */
  toggle: (id: string, next: boolean) => void;
  sendWebhookTest: (url: string) => Promise<void>;
  webhookTestState: WebhookTestState;
  resetWebhookTest: () => void;
}

export type WebhookTestState =
  { phase: 'idle' } | { phase: 'testing' } | { phase: 'ok' } | { phase: 'error'; message: string };

export function useAutomations(projectId: string | null): UseAutomationsResult {
  const queryClient = useQueryClient();
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [webhookTestState, setWebhookTestState] = useState<WebhookTestState>({ phase: 'idle' });

  const listKey = automationKeys.list(projectId ?? '');
  const query = useQuery({
    queryKey: listKey,
    queryFn: () => listAutomations(projectId ?? ''),
    enabled: projectId !== null,
    // 15 §2.2：规则列表 60s / 10min（低频；增删改后显式 invalidate）。
    staleTime: 60_000,
    gcTime: 600_000,
  });

  const invalidateList = useCallback(() => {
    if (projectId === null) return;
    void queryClient.invalidateQueries({ queryKey: automationKeys.list(projectId) });
  }, [projectId, queryClient]);

  const createMutation = useMutation({
    mutationFn: (body: CreateAutomationRequest) => createAutomation(projectId ?? '', body),
    onSettled: invalidateList,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAutomationRequest }) =>
      updateAutomation(id, body),
    onSettled: () => {
      setSavingId(null);
      invalidateList();
    },
  });

  const removeMutation = useMutation({
    mutationFn: deleteAutomation,
    // 失败也 invalidate：404 = 那条真的没了，列表必须跟着更新，
    // 否则用户会对着一条已经不存在的规则反复点删除。
    onSettled: invalidateList,
  });

  /**
   * 启停的乐观更新（F21-7 §5 / §7.3「启停乐观」）。
   *
   * ⚠️ 乐观值不是"随便先翻个牌"：`enable` 在后端会**同时清零 `consecutive_failures`**
   *    并解除降频（03 §8.4）。只把 `enabled` 翻过来、把 3 次失败留在原地，
   *    界面会瞬间显示一条"已启用但仍标着 🟡 降频"的规则 —— 那个状态后端根本不会产生。
   */
  const toggleMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => setAutomationEnabled(id, next),
    onMutate: async ({ id, next }) => {
      if (projectId === null) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<AutomationDto[]>(listKey);
      queryClient.setQueryData<AutomationDto[]>(listKey, (old) =>
        (old ?? []).map((rule) =>
          rule.id === id
            ? {
                ...rule,
                enabled: next,
                ...(next ? { degraded: false, consecutiveFailures: 0 } : {}),
              }
            : rule,
        ),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      // 回滚。⚠️ `previous` 可能是 undefined（缓存本来就空），此时写回 undefined 是对的：
      //    那会让下面的 invalidate 去重新拉，而不是留一份我们编出来的乐观数据。
      queryClient.setQueryData(listKey, context?.previous);
    },
    onSettled: () => {
      setTogglingId(null);
      invalidateList();
    },
  });

  const webhookTestMutation = useMutation({
    mutationFn: testWebhook,
    onMutate: () => {
      setWebhookTestState({ phase: 'testing' });
    },
    onSuccess: () => {
      setWebhookTestState({ phase: 'ok' });
    },
    onError: (error) => {
      setWebhookTestState({
        phase: 'error',
        message: describeAutomationError(error) ?? '测试失败。',
      });
    },
  });

  const dtos = useMemo(() => query.data ?? [], [query.data]);
  // ⚠️ `Date.now()` 与环境时区都在 hook 里取、传进 lib：lib 保持纯函数（可测），
  //    而"现在几点"和"这台机器在哪个时区"是环境输入。与 `useRetainedVolumes` 同一处理。
  const rows = useMemo(
    () => automationRows(dtos, Date.now(), resolveEnvironmentTimeZone()),
    [dtos],
  );

  const createAsync = createMutation.mutateAsync;
  const updateAsync = updateMutation.mutateAsync;
  const removeAsync = removeMutation.mutateAsync;
  const toggleMutate = toggleMutation.mutate;
  const webhookTestAsync = webhookTestMutation.mutateAsync;

  const doToggle = useCallback(
    (id: string, next: boolean) => {
      setTogglingId(id);
      toggleMutate({ id, next });
    },
    [toggleMutate],
  );

  const doUpdate = useCallback(
    async (id: string, body: UpdateAutomationRequest) => {
      setSavingId(id);
      return updateAsync({ id, body });
    },
    [updateAsync],
  );

  const loadErrorMessage = query.isError ? describeAutomationError(query.error) : undefined;
  const actionErrorMessage =
    describeAutomationError(createMutation.error) ??
    describeAutomationError(updateMutation.error) ??
    describeAutomationError(removeMutation.error) ??
    describeAutomationError(toggleMutation.error);

  return {
    rows,
    dtos,
    loading: query.isPending && projectId !== null,
    ...(loadErrorMessage === undefined ? {} : { loadErrorMessage }),
    ...(actionErrorMessage === undefined ? {} : { actionErrorMessage }),
    atLimit: dtos.length >= AUTOMATION_RULE_LIMIT,
    togglingId,
    savingId,
    create: createAsync,
    update: doUpdate,
    remove: removeAsync,
    toggle: doToggle,
    sendWebhookTest: webhookTestAsync,
    webhookTestState,
    resetWebhookTest: useCallback(() => {
      setWebhookTestState({ phase: 'idle' });
    }, []),
  };
}
