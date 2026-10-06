// 诊断 Accordion 的默认展开与手动 override 计算：非 ok/info 默认展开。
// DisclosureStatus 覆盖八态；lib 不依赖 component，保持纯逻辑与表现层分离。
import type { DiagnosticItemModel } from '@/types/system';

/** 与 `components/ui/status-pill.tsx` 的 `STATUS_PILL_STATUSES` 同一份闭集。 */
export const DISCLOSURE_STATUSES = [
  'ok',
  'info',
  'warn',
  'fail',
  'timeout',
  'pending',
  'skipped',
  'unknown',
] as const;

export type DisclosureStatus = (typeof DISCLOSURE_STATUSES)[number];

/** 唯一的判定：`ok`/`info` 默认收起，其余六态（含还没到达的 `pending`）默认展开。 */
export function isDefaultExpanded(status: DisclosureStatus): boolean {
  return status !== 'ok' && status !== 'info';
}

/** 首次渲染（或整轮重新诊断把 override 清空之后）的默认展开集合。 */
export function defaultOpenIds(items: readonly DiagnosticItemModel[]): string[] {
  return items.filter((item) => isDefaultExpanded(item.status ?? 'pending')).map((item) => item.id);
}

/**
 * 用户在 Accordion 上手动展开/收起了哪几项——**只**返回这一次真正变化的那几个 id。
 *
 * 入参是 Radix Accordion `type="multiple"` 受控 value 的前后两份快照
 * （`onValueChange` 给的是完整的新数组，不是一个 diff）。
 */
export function diffManualToggles(
  prevOpenIds: readonly string[],
  nextOpenIds: readonly string[],
): Record<string, boolean> {
  const prevSet = new Set(prevOpenIds);
  const nextSet = new Set(nextOpenIds);
  const changed: Record<string, boolean> = {};
  for (const id of new Set([...prevSet, ...nextSet])) {
    const wasOpen = prevSet.has(id);
    const isOpen = nextSet.has(id);
    if (wasOpen !== isOpen) changed[id] = isOpen;
  }
  return changed;
}

/** 当前应该展开的那一份清单：手动 override 优先，没被碰过的项继续吃「非 ok/info」默认值。 */
export function resolveOpenIds(
  items: readonly DiagnosticItemModel[],
  overrides: Readonly<Record<string, boolean>>,
): string[] {
  return items
    .filter((item) => overrides[item.id] ?? isDefaultExpanded(item.status ?? 'pending'))
    .map((item) => item.id);
}
