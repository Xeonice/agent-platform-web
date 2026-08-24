// **唯一 import `@xterm/*` 的文件**（08 §2.1）：Terminal 实例创建/挂载/addon/配置/fit/写入批处理/dispose。
// ESLint no-restricted-imports 对其余目录禁 @xterm/*（eslint.config.js）。
import { useCallback, useMemo, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css'; // CSS 随 terminal chunk 注入（08 §2.3），不放全局 layout
import { WriteBatcher } from '@/lib/writeBatcher';
import { buildTerminalOptions } from '@/lib/terminalTheme';
import type { RendererKind } from '@/stores/createTerminalRegistrySlice';

interface ManagedInstance {
  terminal: Terminal;
  fit: FitAddon;
  batcher: WriteBatcher;
  renderer: RendererKind;
  lastReportedSize: { cols: number; rows: number } | null;
  /** attach 时传入的上报回调；`fit()` / `resync()` 复用它,不再各自传一个。 */
  onResize: (cols: number, rows: number) => void;
}

export interface AttachArgs {
  sessionId: string;
  container: HTMLDivElement;
  fontSize?: number;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
}

export interface TerminalInstanceApi {
  attach(args: AttachArgs): Promise<void>;
  write(sessionId: string, data: string): void;
  fit(sessionId: string): void;
  /** 清掉去重记录后重报当前尺寸（socket 刚 open 时用，理由见实现处注释）。 */
  resync(sessionId: string): void;
  getRenderer(sessionId: string): RendererKind | undefined;
  dispose(sessionId: string): void;
}

/** 管理会话粒度的 xterm 实例。实例活在 React 树外（存 ref，不进 state），08 §7.4。 */
export function useTerminalInstance(): TerminalInstanceApi {
  const instances = useRef(new Map<string, ManagedInstance>());
  /** 在途 attach（key = sessionId）。见 attach 里的竞态守卫。 */
  const pending = useRef(new Map<string, Promise<void>>());
  /** attach 在途期间被 dispose 的会话：完成时自行拆掉，不留孤儿 DOM。 */
  const disposedWhilePending = useRef(new Set<string>());

  /**
   * 已建实例的复用路径：容器变了就移动 DOM，刷新回调，补一次 fit。
   * 抽成函数是因为"等在途 attach 完成后"也要走同一条路（见 attach 的竞态守卫）。
   */
  const reuse = useCallback((managed: ManagedInstance, args: AttachArgs): void => {
    const el = managed.terminal.element;
    if (el && el.parentElement !== args.container) args.container.appendChild(el);
    managed.onResize = args.onResize;
    doFit(managed);
  }, []);

  const attach = useCallback(
    async (args: AttachArgs): Promise<void> => {
      const { sessionId, container, onInput, onResize } = args;
      const existing = instances.current.get(sessionId);
      if (existing) {
        // 复用：容器变化时移动 DOM（不重新 open），并补一次 fit（08 §7.4 / §11.5）。
        // 重复 attach（例如 socket 重连后重挂）：回调可能指向新的 send，由 reuse 刷新。
        reuse(existing, args);
        return;
      }

      /**
       * ★ 竞态守卫。上面那句 `instances.current.get(sessionId)` 查的表，是在本函数
       * **最后**才写入的——中间隔着好几个 `await`（动态 import addon）。于是两次并发
       * attach 会**双双通过守卫**，各自 `new XTerm()` + `terminal.open(container)`，
       * 容器里就留下**两个 xterm 实例上下叠着**：第一个占满可视区，第二个被挤到屏幕外，
       * 看起来就是"一大片空白，内容在最底下"。
       *
       * dev 下 `reactStrictMode: true` 必然触发：effect → attach 起飞 → cleanup →
       * `dispose`（表里还没东西，**空转**）→ effect 再跑 → 第二次 attach。
       * 但这不是 dev 专属——任何两次快速 attach（重挂、容器换父）都会撞上。
       */
      const inflight = pending.current.get(sessionId);
      if (inflight) {
        await inflight;
        const ready = instances.current.get(sessionId);
        if (ready) {
          reuse(ready, args);
          return;
        }
        // ⚠️ 在途那次被 dispose 撤销了（它会自行拆掉，见下方 disposed 分支）。
        // **不能就此返回** —— StrictMode 的 mount→cleanup→mount 正是这个形状：
        // 撤销的是第一次，第二次才是真正要留下的那个。这里落到下面自己建。
      }

      // 轮到我建了：清掉可能残留的撤销标记，否则会把这一次也误拆。
      disposedWhilePending.current.delete(sessionId);

      let settle!: () => void;
      pending.current.set(
        sessionId,
        new Promise<void>((res) => {
          settle = res;
        }),
      );

      try {
        // xterm.css 由 TerminalContainer 静态 import（随 terminal chunk 一起，08 §2.3）。
        const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ]);

        const terminal = new XTerm(buildTerminalOptions(args.fontSize));
        terminal.open(container); // 必须先 open 再 loadAddon（08 §7.2）
        const fit = new Fit();
        terminal.loadAddon(fit);

        const { Unicode11Addon } = await import('@xterm/addon-unicode11');
        terminal.loadAddon(new Unicode11Addon());
        terminal.unicode.activeVersion = '11';

        const { WebLinksAddon } = await import('@xterm/addon-web-links');
        terminal.loadAddon(new WebLinksAddon());

        let renderer: RendererKind = 'dom';
        try {
          const { WebglAddon } = await import('@xterm/addon-webgl');
          const webgl = new WebglAddon();
          terminal.loadAddon(webgl);
          renderer = 'webgl';
        } catch {
          try {
            const { CanvasAddon } = await import('@xterm/addon-canvas');
            terminal.loadAddon(new CanvasAddon());
            renderer = 'canvas';
          } catch {
            renderer = 'dom'; // 两 addon 都失败，xterm 自然回落 DOM（08 §1.2）
          }
        }

        terminal.onData((d: string) => {
          onInput(d);
        });

        const batcher = new WriteBatcher({
          write: (merged) => {
            terminal.write(merged);
          },
        });
        const managed: ManagedInstance = {
          terminal,
          fit,
          batcher,
          renderer,
          lastReportedSize: null,
          onResize,
        };
        // 在途期间被 dispose 了 ⇒ 这一份没人要，就地拆掉，绝不落进容器。
        if (disposedWhilePending.current.has(sessionId)) {
          disposedWhilePending.current.delete(sessionId);
          batcher.flushAndCancel();
          terminal.dispose();
          return;
        }
        instances.current.set(sessionId, managed);
        doFit(managed);
      } finally {
        pending.current.delete(sessionId);
        settle();
      }
    },
    [reuse],
  );

  const write = useCallback((sessionId: string, data: string): void => {
    instances.current.get(sessionId)?.batcher.push(data);
  }, []);

  const fit = useCallback((sessionId: string): void => {
    const managed = instances.current.get(sessionId);
    if (managed) doFit(managed);
  }, []);

  /**
   * 强制重报当前尺寸(清掉去重记录再 fit)。
   *
   * 为什么需要它:连接 query 里的 `cols/rows` 是**写死的 80x24**,真实尺寸靠 resize 帧
   * 补。但 `attach` 时 socket 往往还没 open,那一帧发不出去(`send` 未 open 即丢弃);
   * 等 socket open 了,尺寸没变过 ⇒ 去重逻辑判定"和上次一样"直接返回,于是那一帧**永远
   * 不会重发**,PTY 就此停在 80x24。socket 一 open 就调这个。
   */
  const resync = useCallback((sessionId: string): void => {
    const managed = instances.current.get(sessionId);
    if (!managed) return;
    managed.lastReportedSize = null;
    doFit(managed);
  }, []);

  const getRenderer = useCallback(
    (sessionId: string): RendererKind | undefined => instances.current.get(sessionId)?.renderer,
    [],
  );

  const dispose = useCallback((sessionId: string): void => {
    const managed = instances.current.get(sessionId);
    if (!managed) {
      // ★ 表里没有**不等于没有东西要清**：attach 可能正在途中（它要到最后才写表）。
      // 此前这里直接 return —— 于是 StrictMode 的 mount→cleanup→mount 里，cleanup
      // 空转、在途那次照常把 xterm 挂进容器，留下一个谁也不认识的孤儿实例。
      if (pending.current.has(sessionId)) disposedWhilePending.current.add(sessionId);
      return;
    }
    managed.batcher.flushAndCancel(); // flush → dispose 顺序（08 §11.7）
    managed.terminal.dispose();
    instances.current.delete(sessionId);
  }, []);

  // 返回值必须 useMemo 稳定引用：否则每次渲染都是新对象，下游 useCallback([term,...])
  // 身份抖动 → useSandboxTerminalSocket 连接 effect 反复 close+重连（08 §7.4）。
  return useMemo(
    () => ({ attach, write, fit, resync, getRenderer, dispose }),
    [attach, write, fit, resync, getRenderer, dispose],
  );
}

/**
 * 隐藏容器不 fit；相同尺寸不上报（08 §4.1 纪律 1/2）。
 *
 * ⚠️ 回调从参数改为**从 managed 上取**:此前 `fit()` 这条路传的是 `() => undefined`,
 * 于是"重新 fit"永远不会把新尺寸报出去——三条死路里最隐蔽的一条。
 */
function doFit(managed: ManagedInstance): void {
  const el = managed.terminal.element;
  if (!el || el.clientWidth === 0) return;
  managed.fit.fit();
  const { cols, rows } = managed.terminal;
  const last = managed.lastReportedSize;
  if (last !== null && last.cols === cols && last.rows === rows) return;
  managed.lastReportedSize = { cols, rows };
  managed.onResize(cols, rows);
}
