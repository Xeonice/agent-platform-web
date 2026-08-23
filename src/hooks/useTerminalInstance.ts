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

  const attach = useCallback(async (args: AttachArgs): Promise<void> => {
    const { sessionId, container, onInput, onResize } = args;
    const existing = instances.current.get(sessionId);
    if (existing) {
      // 复用：容器变化时移动 DOM（不重新 open），并补一次 fit（08 §7.4 / §11.5）。
      const el = existing.terminal.element;
      if (el) {
        if (el.parentElement !== container) container.appendChild(el);
      }
      // 重复 attach（例如 socket 重连后重挂）：回调可能指向新的 send，刷新掉旧的。
      existing.onResize = onResize;
      doFit(existing);
      return;
    }

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
    instances.current.set(sessionId, managed);
    doFit(managed);
  }, []);

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
    if (!managed) return;
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
