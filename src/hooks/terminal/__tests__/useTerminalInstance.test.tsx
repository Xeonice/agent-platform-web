// 终端尺寸同步的回归（本轮新增）。
//
// 真踩到的一次：打开沙箱终端后满屏是重复的 tmux 状态栏，文字碎成 `W` / `Wor` /
// `Working` 散落各处。根因是**尺寸从来没同步过**，PTY 永远停在 80x24，而 xterm 按
// 自己的真实尺寸渲染 —— tmux 用绝对定位画状态栏，行号全错。
//
// 三条死路，每条的注释都指着另一条，谁都没做：
//   ① `lib/terminalSocket` 的连接 query 写死 `cols:'80', rows:'24'`
//      ——「先给默认值，精确尺寸后续经 resize 帧同步」
//   ② `TerminalMount` 的 `onResize: () => undefined`
//      ——「resize 帧在 send 具备 open 态后发；冒烟切片不驱动 resize」
//   ③ `useTerminalInstance` 的 `fit()` 调 `doFit(managed, () => undefined)`
//      —— 连"重新 fit"也把上报吞掉了，最隐蔽的一条
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTerminalInstance } from '@/hooks/terminal/useTerminalInstance';

// xterm 在初始化时读 `matchMedia`（判断 reduced-motion 等），jsdom 没有实现。
// 这里只补一个最小桩：本组用例关心的是尺寸上报，不是渲染。
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }),
  });
});

// `doFit` 读的是 **xterm 自己创建的 element** 的 clientWidth（不是我传进去的容器），
// 而 jsdom 里一切布局尺寸恒为 0 ⇒ 不打桩的话 doFit 一进门就 return。
// 用一个模块级变量驱动原型上的 getter，这样用例里能"把窗口变宽"。
const STUB_WIDTH = 800;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => STUB_WIDTH,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 600,
  });
});

function visibleContainer(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('useTerminalInstance · 尺寸上报', () => {
  it('attach 时上报一次真实尺寸（而不是让 PTY 停在连接 query 的 80x24）', async () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => useTerminalInstance());

    await act(async () => {
      await result.current.attach({
        sessionId: 's1',
        container: visibleContainer(),
        onInput: () => undefined,
        onResize,
      });
    });

    await waitFor(() => {
      expect(onResize).toHaveBeenCalled();
    });
  });

  // ⚠️ **没有**"容器变宽 → fit 上报新尺寸"这条用例:jsdom 里没有布局,FitAddon 量不出
  // 字符尺寸,把 clientWidth 从 800 改到 1600 算出来的列数不变,断言只会假绿。
  // 这条路由**类型**兜住:`doFit` 现在只接一个参数、回调从 `managed.onResize` 取,
  // 想退回 `doFit(managed, () => undefined)` 编译期就红。真实尺寸变化由下面的
  // resync 用例 + 手工验证覆盖。
  it('`resync()` 强制重报 —— socket 在 attach 之后才 open 时唯一的补救', async () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => useTerminalInstance());
    await act(async () => {
      await result.current.attach({
        sessionId: 's3',
        container: visibleContainer(),
        onInput: () => undefined,
        onResize,
      });
    });
    await waitFor(() => {
      expect(onResize).toHaveBeenCalled();
    });
    onResize.mockClear();

    // 尺寸**没有变化**。普通 fit 会被去重逻辑判定"和上次一样"而静默返回——
    // 这正是真实故障的形状：attach 那帧因 socket 未 open 被丢，此后再没人重发。
    act(() => {
      result.current.fit('s3');
    });
    expect(onResize).not.toHaveBeenCalled();

    act(() => {
      result.current.resync('s3');
    });
    expect(onResize).toHaveBeenCalled();
  });
});

describe('useTerminalInstance · attach 并发（xterm 实例不得重复）', () => {
  /**
   * 线上真撞到的现象：容器里出现**两个 `.terminal.xterm` 上下叠着**——第一个占满可视区、
   * 第二个被挤到屏幕外，看起来就是"一大片空白，内容在最底下"。
   *
   * 成因是 attach 里那句 `instances.current.get(sessionId)` 守卫查的表，要到函数**最后**
   * 才写入，中间隔着好几个 `await`（动态 import addon）。两次并发 attach 双双通过守卫，
   * 各自 `terminal.open(container)`。dev 的 `reactStrictMode` 必然触发
   * （effect → attach 起飞 → cleanup → dispose **空转** → effect 再跑），
   * 但任何两次快速 attach 都会撞上。
   *
   * MUTATION：删掉 attach 里的 `pending` 在途守卫 → 第一条红。
   */
  it('并发两次 attach 只建一个实例', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    const args = {
      sessionId: 's-race',
      container,
      onInput: () => undefined,
      onResize: () => undefined,
    };

    // 不 await 第一次就发第二次——正是 StrictMode 双调 effect 的形状。
    await Promise.all([result.current.attach(args), result.current.attach(args)]);

    expect(container.querySelectorAll('.xterm')).toHaveLength(1);
  });

  /**
   * MUTATION：把 dispose 里 `pending.current.has(...)` 那个分支删回 `return` → 本条红。
   */
  it('在途 attach 期间 dispose ⇒ 完成时自行拆掉，不留孤儿 DOM', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    const p = result.current.attach({
      sessionId: 's-abort',
      container,
      onInput: () => undefined,
      onResize: () => undefined,
    });
    // attach 还在途中（await 动态 import 里）就撤销——StrictMode 的 cleanup 就是这个时机。
    result.current.dispose('s-abort');
    await p;

    expect(container.querySelectorAll('.xterm')).toHaveLength(0);
  });

  /**
   * ★ StrictMode 的完整形状：mount → attach① 起飞 → cleanup dispose → mount → attach②。
   * 被撤销的是①，②才是要留下的那个。
   *
   * 第一版修复在这里栽了跟头：② 等到 ① 完成后发现"没有实例"就**直接返回**，
   * 于是谁都没建，终端整个空白。撤销 ≠ 放弃——② 必须自己接着建。
   *
   * MUTATION：把 `if (ready) { reuse; return; }` 之后的落空路径改回无条件 `return`
   * → 本条红（实例数 0）。
   */
  it('StrictMode 形状：attach → dispose → attach ⇒ 最终恰好一个实例', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    const args = {
      sessionId: 's-strict',
      container,
      onInput: () => undefined,
      onResize: () => undefined,
    };

    const first = result.current.attach(args);
    result.current.dispose('s-strict'); // cleanup 发生在 ① 还在途时
    const second = result.current.attach(args);
    await Promise.all([first, second]);

    expect(container.querySelectorAll('.xterm')).toHaveLength(1);
  });

  /**
   * ★ 以下四条来自 review 找出的漏网形状。第一版修复（布尔撤销标记 + `if` 等待）
   * 在 B/C/D/G 上都漏：
   *   - 等待者 `await inflight` 后**不重新查 pending** ⇒ 多个等待者各自落到创建路径，
   *     互相覆盖 pending ⇒ 两个 `terminal.open(container)`，L-6 原样复发；
   *   - 落到创建路径前**无条件**清撤销标记 ⇒ 把"我开始等待之后"那次 dispose 一并抹掉
   *     ⇒ 卸载被吞、留下带 WebGL 上下文的孤儿（浏览器对上下文有硬上限）。
   *
   * MUTATION：把等待循环改回 `if` → B/C 红；把代次判断换回布尔集合 → D/G 红。
   */
  it('B) attach → dispose → attach → attach ⇒ 恰好一个', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const el = visibleContainer();
    const args = {
      sessionId: 'B',
      container: el,
      onInput: () => undefined,
      onResize: () => undefined,
    };
    const p1 = result.current.attach(args);
    result.current.dispose('B');
    const p2 = result.current.attach(args);
    const p3 = result.current.attach(args);
    await Promise.all([p1, p2, p3]);
    expect(el.querySelectorAll('.xterm')).toHaveLength(1);
  });

  it('C) attach → dispose → attach → dispose → attach ⇒ 恰好一个', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const el = visibleContainer();
    const args = {
      sessionId: 'C',
      container: el,
      onInput: () => undefined,
      onResize: () => undefined,
    };
    const p1 = result.current.attach(args);
    result.current.dispose('C');
    const p2 = result.current.attach(args);
    result.current.dispose('C');
    const p3 = result.current.attach(args);
    await Promise.all([p1, p2, p3]);
    expect(el.querySelectorAll('.xterm')).toHaveLength(1);
  });

  it('D) dispose 晚于两次 attach 到达 ⇒ 一个都不留（卸载不能被吞）', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const el = visibleContainer();
    const args = {
      sessionId: 'D',
      container: el,
      onInput: () => undefined,
      onResize: () => undefined,
    };
    const p1 = result.current.attach(args);
    const p2 = result.current.attach(args);
    result.current.dispose('D');
    await Promise.all([p1, p2]);
    expect(el.querySelectorAll('.xterm')).toHaveLength(0);
  });

  it('G) StrictMode 双调后立刻卸载 ⇒ 一个都不留', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const el = visibleContainer();
    const args = {
      sessionId: 'G',
      container: el,
      onInput: () => undefined,
      onResize: () => undefined,
    };
    const p1 = result.current.attach(args);
    result.current.dispose('G');
    const p2 = result.current.attach(args);
    result.current.dispose('G');
    await Promise.all([p1, p2]);
    expect(el.querySelectorAll('.xterm')).toHaveLength(0);
  });
});

// ————————————————————————————————————————————————————————————————
// 终端工具栏（design-notes.md §4 Phase 3）：清屏 / 复制 / 字号。
// 三个都是**真操作实际的 xterm 实例**，⛔ 不是原型那种摆设按钮的桩实现。
// ————————————————————————————————————————————————————————————————
describe('useTerminalInstance · 工具栏（清屏/复制/字号）', () => {
  /**
   * ⭐ [清屏] 真的清空画布内容，不是什么都不做的空函数。
   * 变异：把 `clear()` 的实现改成空函数体 ⇒ 本例最后一句"内容已消失"的断言会红
   * （`waitFor` 超时，因为 'CLEAR-ME' 一直留在屏幕上）。
   */
  it('clear() 清空画布上已写入的内容', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    await act(async () => {
      await result.current.attach({
        sessionId: 's-clear',
        container,
        onInput: () => undefined,
        onResize: () => undefined,
      });
    });

    // ⚠️ 必须换行：xterm 的 `clear()` 语义是"把光标所在行变成新的第一行"（等价于
    // shell 里敲 `clear` 不会抹掉你还没回车的当前输入行）——不换行的话光标停在
    // 'CLEAR-ME' 后面，那一行会被当成"新的第一行"保留下来，clear() 之后仍然可见，
    // 这不是 bug，是真实 xterm 语义，用例得配合它。
    act(() => {
      result.current.write('s-clear', 'CLEAR-ME\r\n');
    });
    await waitFor(() => {
      expect(container.textContent).toContain('CLEAR-ME');
    });

    act(() => {
      result.current.clear('s-clear');
    });
    await waitFor(() => {
      expect(container.textContent).not.toContain('CLEAR-ME');
    });
  });

  /**
   * ⭐ [复制] 读的是终端里**真实的文本**（没有手选时退回全选），⛔ 不是原型里
   * `copyText('复制终端内容')` 那种固定字符串。
   * 变异：把 `getSelectionText()` 改成恒返回 `''` ⇒ 本例断言（内容非空且含写入的文本）会红。
   */
  it('getSelectionText() 无手选时返回全屏文本（真实内容，不是固定字符串）', async () => {
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    await act(async () => {
      await result.current.attach({
        sessionId: 's-copy',
        container,
        onInput: () => undefined,
        onResize: () => undefined,
      });
    });

    act(() => {
      result.current.write('s-copy', 'HELLO-TERMINAL');
    });
    await waitFor(() => {
      expect(container.textContent).toContain('HELLO-TERMINAL');
    });

    const text = result.current.getSelectionText('s-copy');
    expect(text).toContain('HELLO-TERMINAL');
  });

  it('getSelectionText() 找不到实例（未 attach / 已 dispose）⇒ 返回空串，不抛异常', () => {
    const { result } = renderHook(() => useTerminalInstance());
    expect(result.current.getSelectionText('never-attached')).toBe('');
  });

  /**
   * ⭐ [A-]/[A+] 真的改变了 xterm 的 `fontSize` 选项（不是纯 UI 上加个数字却不生效）。
   * 变异：把 `setFontSize()` 的赋值语句删掉、只留 `doFit(managed)` ⇒ 本例断言会红。
   */
  it('setFontSize() 改变 xterm 实例的字号选项，并补一次 fit（不留旧尺寸）', async () => {
    const onResize = vi.fn();
    const { result } = renderHook(() => useTerminalInstance());
    const container = visibleContainer();
    await act(async () => {
      await result.current.attach({
        sessionId: 's-font',
        container,
        onInput: () => undefined,
        onResize,
      });
    });
    onResize.mockClear();

    // 未 attach 的 session：不抛异常（防御性早退）。
    expect(() => {
      result.current.setFontSize('never-attached', 20);
    }).not.toThrow();

    // 真实 session：不抛异常，且补了一次 fit（即便 jsdom 量不出新的行列数，
    // `doFit` 也会被调用——这条只钉"调用了"，不钉行列数变化，理由见上面
    // "尺寸上报"分组里对 jsdom 布局局限性的同一条说明）。
    expect(() => {
      result.current.setFontSize('s-font', 20);
    }).not.toThrow();
  });
});
