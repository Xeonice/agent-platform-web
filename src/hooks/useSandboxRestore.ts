// 刷新恢复（S5 收口）：WS 帧是"错过就没了"的即时通道，**刷新后唯一能拿回任务名与失败原因的是 REST DTO**
// （`GET /api/sandboxes/:id` → `name` / `failureCode` / `failureMessage`，10 §7.3）。
//
// 本 hook 负责：持久化的 `selectedSandboxId` → 拉一次 DTO → 把状态与失败原因**种子**进 store，
// 之后仍由 /events 的 status_changed 继续推进。
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSandbox } from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';
import { useAppStore } from '@/stores';

/** sandbox query key 族（15 §2.1）。 */
export const sandboxKeys = {
  all: () => ['sandboxes'] as const,
  detail: (id: string) => [...sandboxKeys.all(), 'detail', id] as const,
};

export interface SandboxRestore {
  /** 后端派生的默认任务名（前端不派生）。 */
  name?: string;
  /** 该 id 在后端已不存在（404）：调用方回到新建入口。 */
  notFound: boolean;
  isPending: boolean;
}

/** `sandboxId === null` 时完全不发请求（Query 走 enabled，不做条件 hook）。 */
export function useSandboxRestore(sandboxId: string | null): SandboxRestore {
  const setSandboxStatus = useAppStore((s) => s.setSandboxStatus);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);

  const query = useQuery({
    queryKey: sandboxKeys.detail(sandboxId ?? ''),
    queryFn: () => getSandbox(sandboxId ?? ''),
    enabled: sandboxId !== null,
    retry: false,
  });

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
    notFound,
    isPending: sandboxId !== null && query.isPending,
  };
}
