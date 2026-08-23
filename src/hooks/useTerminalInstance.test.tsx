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
import { useTerminalInstance } from '@/hooks/useTerminalInstance';

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
