// 终端标签的纯逻辑（08 §5.2/§5.3）。
import { describe, it, expect } from 'vitest';
import {
  AGENT_TAB_LABEL,
  selectMountedSessions,
  shellTabLabel,
  shellTabSeqOf,
  TERMINAL_INSTANCE_LIMIT,
} from '@/lib/terminal/terminalTabs';

describe('selectMountedSessions —— LRU 该留下谁', () => {
  it('没超上限时全留（没有任何淘汰）', () => {
    const order = ['a', 'b', 'c'];
    expect(selectMountedSessions(order, new Map(), 'a', 6)).toEqual(order);
  });

  it('⭐ **活跃会话永不淘汰**，哪怕它是最久未激活的那个', () => {
    // 少了这条，在上限边缘会出现"刚切过去就被自己挤掉"（08 §5.3 纪律 1）。
    const order = ['a', 'b', 'c'];
    const activatedAt = new Map([
      ['a', 1],
      ['b', 9],
      ['c', 8],
    ]);
    expect(selectMountedSessions(order, activatedAt, 'a', 2)).toEqual(['a', 'b']);
  });

  it('淘汰最久未激活的，留下的**保持原顺序**（不按激活序号重排）', () => {
    // 顺序一抖 React 就会搬 DOM，而终端实例挂在那些 DOM 上。
    const order = ['t1', 't2', 't3', 't4'];
    const activatedAt = new Map([
      ['t1', 1],
      ['t2', 5],
      ['t3', 2],
      ['t4', 9],
    ]);
    expect(selectMountedSessions(order, activatedAt, 't1', 3)).toEqual(['t1', 't2', 't4']);
  });

  it('没有激活记录的标签按"最久未用"处理（而不是报错/优先保留）', () => {
    const order = ['a', 'b', 'c'];
    expect(selectMountedSessions(order, new Map([['b', 7]]), 'a', 2)).toEqual(['a', 'b']);
  });

  it('上限落在 08 §5.2 说的 4–6 区间里（WebGL 上下文预算）', () => {
    // 放宽到 8–10 要等"按实际 renderer 动态取值"落地；在那之前这个数字不许偷偷变大：
    // 接近浏览器上下文上限时最早的上下文会被**静默**回收（切回去画面是黑的，零报错）。
    expect(TERMINAL_INSTANCE_LIMIT).toBeGreaterThanOrEqual(4);
    expect(TERMINAL_INSTANCE_LIMIT).toBeLessThanOrEqual(6);
  });
});

describe('标签名', () => {
  it('⭐ 第一个标签叫「Agent」，**不叫**「终端 1」/「Term-1」', () => {
    // 它背后是 Task 自己那个会话（关不掉、里面跑的是 agent）。叫成「终端 1」会把这个
    // 区别抹掉，用户会以为它跟旁边几个一样随手可关。术语按 P21-1 §9：runtime → Agent。
    expect(AGENT_TAB_LABEL).toBe('Agent');
    expect(AGENT_TAB_LABEL).not.toMatch(/终端|Term/);
    // ⛔ 也不许出现被禁的词（P21-1 §9）。
    expect(AGENT_TAB_LABEL).not.toMatch(/sandbox|容器/i);
  });

  it('用户自己开的叫「终端 N」，N 来自 sessionId 里的序号', () => {
    expect(shellTabLabel(2)).toBe('终端 2');
    expect(shellTabSeqOf('sb-1:shell:3')).toBe(3);
  });

  it('序号取不到时回 0（一个明显不对劲的名字，而不是伪装成正常的 1）', () => {
    expect(shellTabSeqOf('sb-1:shell:abc')).toBe(0);
    expect(shellTabSeqOf('nonsense')).toBe(0);
  });
});
