// 审计流筛选条的 UI state（F21-5 §5「审计筛选」行）。
//
// ⚠️ **为什么是 hook 而不是容器里的几个 useState**：`AuditStreamContainer` 被 boundaries
// 禁止 import `lib/`（`from: 'container', allow: ['view','hook','type','store','component']`），
// 而"`datetime-local` 怎么换算成 ISO"「空态那句筛选说明怎么写」都是 lib 的活。
// 于是 state 与派生一起收在这一层，容器只做装配。
//
// ⚠️ `filters` 是 `useMemo` 出来的**稳定引用**：它要进 query key，每次渲染换一个新对象
// 虽然不会改变 key 的哈希，却会让下游所有 `useMemo`/`useCallback` 白白失效。
//
// ⚠️ `fromLocal`/`toLocal` 留原样字符串而不是只存 ISO：受控的 `datetime-local` 若在
// 用户打字打到一半时被换算失败的 `undefined` 清空，输入框就再也填不进去。
import { useCallback, useMemo, useState } from 'react';
import { auditEmptyKind, describeAuditFilters, localInputToIso } from '@/lib/audit/auditStream';
import type { AuditCategory, AuditEmptyKind, AuditFilters } from '@/types/audit';

export interface UseAuditFiltersResult {
  filters: AuditFilters;
  category: AuditCategory | undefined;
  alertsOnly: boolean;
  fromLocal: string;
  toLocal: string;
  /**
   * 空列表**为什么**空（§6 三态互不相同的文案）。
   *
   * ⚠️ 这里给的是 `AuditEmptyKind` 而不是原来的 `hasActiveFilters: boolean`：
   * 一个布尔只分得出两态，而空态有三个不同的事实要说——「筛选无匹配」与
   * 「这类事件平台还没开始记」被压成同一句时，用户读到的是"镜像相关操作从来没发生过"。
   */
  emptyKind: AuditEmptyKind;
  /** 空态里那句「当前筛选条件」。 */
  filterSummary: string;
  setCategory: (next: AuditCategory | undefined) => void;
  setAlertsOnly: (next: boolean) => void;
  setFromLocal: (next: string) => void;
  setToLocal: (next: string) => void;
  /** [查看该沙箱完整时间线]：只换 `subjectId`，其余筛选保持。 */
  setSubjectId: (next: string | undefined) => void;
  clear: () => void;
}

export function useAuditFilters(initialSubjectId?: string): UseAuditFiltersResult {
  const [category, setCategory] = useState<AuditCategory | undefined>(undefined);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');
  const [subjectId, setSubjectId] = useState<string | undefined>(initialSubjectId);

  const filters = useMemo<AuditFilters>(() => {
    const from = localInputToIso(fromLocal);
    const to = localInputToIso(toLocal);
    return {
      ...(category === undefined ? {} : { category }),
      // 产品只给「仅告警」一个开关（= warn ∪ error），不是三选一（P21-5 §10.2）。
      ...(alertsOnly ? ({ severity: 'warn-and-error' } as const) : {}),
      ...(subjectId === undefined ? {} : { subjectId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    };
  }, [category, alertsOnly, subjectId, fromLocal, toLocal]);

  const clear = useCallback(() => {
    setCategory(undefined);
    setAlertsOnly(false);
    setFromLocal('');
    setToLocal('');
    setSubjectId(undefined);
  }, []);

  return {
    filters,
    category,
    alertsOnly,
    fromLocal,
    toLocal,
    emptyKind: auditEmptyKind(filters),
    filterSummary: describeAuditFilters(filters),
    setCategory,
    setAlertsOnly,
    setFromLocal,
    setToLocal,
    setSubjectId,
    clear,
  };
}
