// 诊断卡「非 ok/info 默认展开」的受控 Accordion 状态（design/design-notes.md §1
// 问题 1 + §4 Phase 1 第一条）。
//
// ⚠️ **这一层存在的理由与 `useSystemStatusModels` 一样：分层铁律。** `view` 不许
// import `lib`（eslint boundaries：`view` 只能 `allow: ['view','type','component']`），
// 纯判定函数（`isDefaultExpanded` / `diffManualToggles` / `resolveOpenIds`）住在
// `lib/system/diagnosticsDisclosure.ts`，这里只是把它们接到一份 `useState` 上，
// 交给 `SystemStatusContainer` 用、再把结果（`openIds` + `onOpenIdsChange`）当成
// 两个普通 prop 传给 `DiagnosticsCardView`——view 那边因此不需要知道这套 override
// 逻辑，只管照给定的 `openIds` 渲染。
import { useCallback, useMemo, useState } from 'react';
import { diffManualToggles, resolveOpenIds } from '@/lib/system/diagnosticsDisclosure';
import type { DiagnosticItemModel } from '@/types/system';

export interface UseDiagnosticsDisclosureResult {
  /** 当前应该展开的那几项 id——直接喂给 `Accordion` 的受控 `value`。 */
  openIds: string[];
  /** 接 `Accordion` 的 `onValueChange`：只把这次真的变了的那几项记成用户 override。 */
  onOpenIdsChange: (nextOpenIds: string[]) => void;
}

export function useDiagnosticsDisclosure(
  items: readonly DiagnosticItemModel[],
): UseDiagnosticsDisclosureResult {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const openIds = useMemo(() => resolveOpenIds(items, overrides), [items, overrides]);

  const onOpenIdsChange = useCallback(
    (nextOpenIds: string[]) => {
      const changed = diffManualToggles(openIds, nextOpenIds);
      if (Object.keys(changed).length === 0) return;
      setOverrides((prev) => ({ ...prev, ...changed }));
    },
    [openIds],
  );

  return { openIds, onOpenIdsChange };
}
