// 诊断卡「非 ok/info 默认展开」的受控 state（design/design-notes.md §4 Phase 1）。
// 纯函数层面的穷举在 `lib/system/__tests__/diagnosticsDisclosure.test.ts`，这里只测
// 这一层 hook 独有的东西：state 接线、override 的持久化、以及重渲染时新到达的结果
// 照旧吃默认值（不是被上一次的 override 快照"焊死"）。
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDiagnosticsDisclosure } from '@/hooks/system/useDiagnosticsDisclosure';
import type { DiagnosticItemModel } from '@/types/system';

function item(
  id: DiagnosticItemModel['id'],
  status: DiagnosticItemModel['status'],
): DiagnosticItemModel {
  return { id, label: id, status };
}

describe('useDiagnosticsDisclosure', () => {
  it('初始 openIds 等于「非 ok/info」默认集合', () => {
    const items = [item('container-runtime', 'ok'), item('port-conflict', 'fail')];
    const { result } = renderHook(() => useDiagnosticsDisclosure(items));
    expect(result.current.openIds).toEqual(['port-conflict']);
  });

  it('调 onOpenIdsChange 收起一项 ⇒ openIds 更新，且只影响那一项', () => {
    const items = [item('container-runtime', 'fail'), item('port-conflict', 'fail')];
    const { result, rerender } = renderHook(({ items: i }) => useDiagnosticsDisclosure(i), {
      initialProps: { items },
    });
    expect(result.current.openIds).toEqual(['container-runtime', 'port-conflict']);

    act(() => {
      result.current.onOpenIdsChange(['port-conflict']);
    });
    rerender({ items });
    expect(result.current.openIds).toEqual(['port-conflict']);
  });

  it('⭐ 手动收起一项之后，另一项新到达的结果不受连累——照旧吃新的默认值', () => {
    // 场景：a、b 都在跑；用户手动收起 a（此时 a 已经是 fail）；随后 b 的结果才到达
    // （fail）——b 从没被手动碰过，必须照默认规则展开。
    const first = [item('container-runtime', 'fail'), item('port-conflict', undefined)];
    const { result, rerender } = renderHook(({ items: i }) => useDiagnosticsDisclosure(i), {
      initialProps: { items: first },
    });
    expect(result.current.openIds).toEqual(['container-runtime', 'port-conflict']); // pending 也默认展开

    act(() => {
      result.current.onOpenIdsChange(['port-conflict']); // 收起 container-runtime
    });

    const second = [item('container-runtime', 'fail'), item('port-conflict', 'fail')];
    rerender({ items: second });
    // ⚠️ MUTATION：若 override 逻辑把"当前展开的其它项"也一并冻结，port-conflict
    //    到达 fail 结果后仍会展开（它本来就在 openIds 里，行为凑巧一致）——
    //    真正会被这条抓到的是 container-runtime 不会被错误地重新展开。
    expect(result.current.openIds).toEqual(['port-conflict']);
  });

  it('不调用 onOpenIdsChange ⇒ openIds 跟着 items 的状态变化自动更新（没有 override）', () => {
    const first = [item('port-conflict', undefined)];
    const { result, rerender } = renderHook(({ items: i }) => useDiagnosticsDisclosure(i), {
      initialProps: { items: first },
    });
    expect(result.current.openIds).toEqual(['port-conflict']); // pending 默认展开

    const second = [item('port-conflict', 'ok')];
    rerender({ items: second });
    expect(result.current.openIds).toEqual([]); // ok 默认收起，且没人手动碰过
  });
});
