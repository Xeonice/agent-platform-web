// 「非 ok/info 默认展开」的判定与受控 Accordion 状态计算
// （design/design-notes.md §1 问题 1「信息密度高」+ §4 Phase 1 第一条）。
//
// ⚠️ **判定覆盖八态，不是只覆盖诊断卡用得到的那六个。** 诊断项本身只会落在
// ok/info/warn/fail/timeout/`pending`（未到达）这六种上，但这条纪律的原话是「非
// ok/info 都默认展开」——`StatusPill`（`components/ui/status-pill.tsx`）的八态
// （另外两态 `skipped`/`unknown` 用在向导步骤条 / 沙箱环境卡）迟早会复用同一条判定。
// ⇒ `isDefaultExpanded` 吃的是同一个八态闭集，不是另开一个只覆盖六态的窄类型。
//
// ⚠️ **这里不 import `StatusPillStatus`。** `lib` 层的依赖方向禁止指向 `component`
// 层（`eslint.config.js` boundaries：`lib` 只能 `allow: ['lib','type']`）——即使只是
// type-only import 也一样。⇒ `DisclosureStatus` 在这里**独立声明**同一份八态字面量，
// 用例（`__tests__/diagnosticsDisclosure.test.ts`）额外钉了一条
// `DISCLOSURE_STATUSES` 与 `STATUS_PILL_STATUSES` 逐字相同，两边其中一边加了新状态
// 忘了同步另一边，那条用例先红。
//
// ⚠️ **override 只记「用户手动碰过的那几项」，不是整份快照。** 点开一项就把其余
// 七项的当前展开状态也顺手记成 override，会让"没手动碰过的项继续吃默认值"这条
// 语义失效——后续到达的新结果（比如某一项从 pending 变成 fail）就再也扳不动它的
// 展开状态了。`diffManualToggles` 只返回本次真正变化的那几个 id。
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
