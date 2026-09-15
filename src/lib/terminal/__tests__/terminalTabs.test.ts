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
  it('没超上限时，**点过的**全留（没有任何淘汰）', () => {
    const order = ['a', 'b', 'c'];
    const activatedAt = new Map([
      ['b', 1],
      ['c', 2],
    ]);
    expect(selectMountedSessions(order, activatedAt, 'a', 6)).toEqual(order);
  });

  /**
   * ⭐ **没有激活记录 = 不挂载，哪怕远没到上限**（2026-09-15 裁决）。
   *
   * 这一条针对的是刷新：`recordShellInventory` 恢复出来的标签**刻意没有**激活记录
   * （store 那边的注释写着理由），但旧实现开头有一行
   * `if (order.length <= limit) return [...order]` —— 只要没超上限就全返回，
   * 那个"刻意不发记录"的意图被整个吃掉。后果是刷新一次同时起 N 条 WS + N 次 tmux attach。
   *
   * 变异：把那行短路加回去 ⇒ 本条红（会返回全部三个）。
   * ⚠️ 这条用 6 这个**宽松**上限，就是为了证明它与上限无关；⛔ 不要改成 2，
   *    那样短路加回来也是绿的（2 < 3 走不到短路），这条就白写了。
   */
  it('⭐ 恢复出来的标签（无激活记录）不自动挂载，哪怕名额有余', () => {
    const order = ['agent', 'restored-1', 'restored-2'];
    const activatedAt = new Map([['agent', 1]]);
    expect(selectMountedSessions(order, activatedAt, 'agent', 6)).toEqual(['agent']);
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

  it('没有激活记录的标签**没有资格**（⛔ 不是"排在最后"，也不报错）', () => {
    // ⚠️ 差别在名额有余时才看得出来：按"排在最后"处理的话 c 会被捞进来。
    const order = ['a', 'b', 'c'];
    expect(selectMountedSessions(order, new Map([['b', 7]]), 'a', 2)).toEqual(['a', 'b']);
    expect(selectMountedSessions(order, new Map([['b', 7]]), 'a', 6)).toEqual(['a', 'b']);
  });

  /**
   * ⭐ **Agent 标签不该因为"没有激活记录"而恒垫底**（2026-09-15 裁决）。
   *
   * 它不在 `shellTabsOf` 里（是 `tabs` memo 合成的），所以 `openShellTab` 那条写入路径
   * 碰不到它；而首次打开沙箱时它是**默认选中**、不走 `selectTab` ⇒ 也拿不到记录。
   * 结果：`?? 0` 让它排在所有标签之后，一超上限**它第一个出局** —— 而它恰恰是用户
   * 最可能切回去的那个（任务本身，`closable: false`）。
   *
   * 修法不是给 LRU 加特例，是**补上那条本就该有的记录**（见 `useTerminalSessions` 的
   * `useEffect`）。所以这条用例钉的是：一旦有了记录，它就按真实最近使用排序 ——
   * 下面这组里 agent 的 tick 比 shell:1 新，它必须活下来。
   * 变异：把 `useTerminalSessions` 里那个补记录的 effect 删掉 ⇒ 容器级用例红。
   */
  it('⭐ Agent 标签有了激活记录之后，按真实最近使用排序（不再恒垫底）', () => {
    const order = ['sb:agent', 'sb:shell:1', 'sb:shell:2'];
    const activatedAt = new Map([
      ['sb:shell:1', 1],
      ['sb:agent', 2],
      ['sb:shell:2', 3],
    ]);
    // 停在 shell:2，名额 2 ⇒ 留 shell:2（活跃）+ agent（次新），⛔ 不是最老的 shell:1。
    expect(selectMountedSessions(order, activatedAt, 'sb:shell:2', 2)).toEqual([
      'sb:agent',
      'sb:shell:2',
    ]);
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
