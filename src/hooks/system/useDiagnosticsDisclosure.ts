// 受控诊断 Accordion：非 ok/info 默认展开，用户手动开关由 hook 管理。
// 纯判定函数留在 lib；容器把 openIds/onOpenIdsChange 作为 props 传给 view。
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
