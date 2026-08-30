// 放行判定（F21-8 §2「判定位置」）：`AppBootGate` 唯一的取数口。
//
// ⚠️ **首载读的是 `GET /api/system/init-status` 而不是 `/settings`**（§8 约束 1）：前者顺带
// 带回上次出网检测结果，进向导可以直接渲染历史、不重跑一轮 —— 用户不必每次冷启动都干等 5s×3。
//
// ⚠️ `staleTime / gcTime` 均为 `Infinity`（15 §2.2）：这是一次性放行判定，完成后由
// `POST /api/system/init` 的 mutation `setQueryData` 置 true，⛔ 不靠重新拉取。
// 拉取一次就够了——它在一次会话里不会自己变。
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getInitStatus } from '@/services/api/system.service';
import { systemKeys } from '@/hooks/system/useAuditStream';
import type { InitStatusDto } from '@/types/system';

export const INIT_QUERY_OPTIONS = {
  queryKey: systemKeys.init(),
  queryFn: getInitStatus,
  staleTime: Infinity,
  gcTime: Infinity,
  // ⚠️ **不重试**。这条 query 的失败是"后端没起来 / 口令门拦下了"，两者都不是重试能解决的，
  //    而每多一次重试就把首屏骨架多按住几秒（默认全局 retry 是 2 次指数退避）。
  //    失败时 `AppBootGate` 的处置见那边的注释：**放行**，不是卡在骨架上。
  retry: false,
} as const;

/** `initialized` 与它的加载态。**判定只在这里读一次**，其余地方一律读缓存。 */
export function useInitGate(): UseQueryResult<InitStatusDto> {
  return useQuery(INIT_QUERY_OPTIONS);
}
