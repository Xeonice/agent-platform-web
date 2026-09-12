// 「非 ok/info 默认展开」（design/design-notes.md §1 问题 1 + §4 Phase 1 第一条）。
import { describe, it, expect } from 'vitest';
import { STATUS_PILL_STATUSES } from '@/components/ui/status-pill';
import {
  DISCLOSURE_STATUSES,
  defaultOpenIds,
  diffManualToggles,
  isDefaultExpanded,
  resolveOpenIds,
  type DisclosureStatus,
} from '@/lib/system/diagnosticsDisclosure';
import type { DiagnosticItemModel } from '@/types/system';

// ⚠️ 测试文件不受 boundaries 分层依赖方向约束（eslint.config.js 说明），这里刻意跨层
// 拉一次 `components/ui/status-pill` 的 `STATUS_PILL_STATUSES`，只用来**钉住**
// `lib` 里独立声明的 `DISCLOSURE_STATUSES` 与它逐字相同——两边其中一份加了新状态
// 忘了同步另一份，这条用例先红（`lib` 生产代码本身不许 import `component`，见
// `diagnosticsDisclosure.ts` 文件头）。
it('DISCLOSURE_STATUSES 与 StatusPill 的八态闭集逐字相同', () => {
  expect(DISCLOSURE_STATUSES).toEqual(STATUS_PILL_STATUSES);
});

describe('isDefaultExpanded：覆盖八态里的每一态，不是只测 ok 和 fail 两头', () => {
  const EXPECTED: Readonly<Record<DisclosureStatus, boolean>> = {
    ok: false,
    info: false,
    warn: true,
    fail: true,
    timeout: true,
    pending: true,
    skipped: true,
    unknown: true,
  };

  // ⚠️ 用闭集本身驱动用例，而不是手抄一份状态列表——闭集加新状态时这里会自动补测，
  //    不会出现"新状态漏测但用例照样绿"的窟窿。
  it.each(DISCLOSURE_STATUSES)('%s', (status) => {
    expect(isDefaultExpanded(status)).toBe(EXPECTED[status]);
  });

  it('八态一个不少地跑过（防止上面的 it.each 因为闭集变空而悄悄归零）', () => {
    expect(DISCLOSURE_STATUSES.length).toBe(8);
  });
});

function item(
  id: DiagnosticItemModel['id'],
  status: DiagnosticItemModel['status'],
): DiagnosticItemModel {
  return { id, label: id, status };
}

describe('defaultOpenIds：只挑非 ok/info 的项', () => {
  it('ok/info 不进默认展开集合，其余状态（含 pending）都进', () => {
    const items = [
      item('container-runtime', 'ok'),
      item('preset-image', 'info'),
      item('data-root-fs', 'warn'),
      item('port-conflict', 'fail'),
      item('outbound-network', 'timeout'),
      item('ws-loopback', undefined), // 未到达 ⇒ pending
    ];
    expect(defaultOpenIds(items)).toEqual([
      'data-root-fs',
      'port-conflict',
      'outbound-network',
      'ws-loopback',
    ]);
  });
});

describe('diffManualToggles：只报"这次真的变了"的那几个 id', () => {
  it('新增展开的 id 记为 true', () => {
    expect(diffManualToggles(['a'], ['a', 'b'])).toEqual({ b: true });
  });

  it('收起的 id 记为 false', () => {
    expect(diffManualToggles(['a', 'b'], ['a'])).toEqual({ b: false });
  });

  it('没变化 ⇒ 空对象（⚠️ 不能把"没动过的 a"也写进 override，见文件头）', () => {
    expect(diffManualToggles(['a'], ['a'])).toEqual({});
  });
});

describe('resolveOpenIds：override 优先，没被碰过的项继续吃默认值', () => {
  it('全部没 override ⇒ 等价于 defaultOpenIds', () => {
    const items = [item('container-runtime', 'ok'), item('port-conflict', 'fail')];
    expect(resolveOpenIds(items, {})).toEqual(defaultOpenIds(items));
  });

  it('用户手动收起了默认展开的一项 ⇒ 只影响这一项', () => {
    const items = [item('port-conflict', 'fail'), item('data-root-fs', 'warn')];
    expect(resolveOpenIds(items, { 'port-conflict': false })).toEqual(['data-root-fs']);
  });

  it('用户手动展开了默认收起的一项 ⇒ 只影响这一项，其余仍吃默认值', () => {
    const items = [item('container-runtime', 'ok'), item('port-conflict', 'fail')];
    expect(resolveOpenIds(items, { 'container-runtime': true })).toEqual([
      'container-runtime',
      'port-conflict',
    ]);
  });

  it('⭐ 后到达的新结果（override 之外的项状态变了）照旧吃新的默认值', () => {
    // 场景：用户手动收起了 a（当时是 fail），随后 b 的结果才刚刚到达（fail）——
    // b 从没被手动碰过，必须照默认规则展开，不能被 a 的 override "连坐"。
    const items = [item('port-conflict', 'fail'), item('outbound-network', 'fail')];
    expect(resolveOpenIds(items, { 'port-conflict': false })).toEqual(['outbound-network']);
  });
});
