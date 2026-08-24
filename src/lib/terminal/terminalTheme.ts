// 终端主题 / 字体栈 / Terminal options 常量（08 §7.3）。纯常量，无副作用，唯一被 useTerminalInstance 消费。

/** 产品规定：全局暗色，终端区纯黑底（P21 §3）。前景/选区色集中在此，避免散落。 */
export const TERMINAL_THEME = {
  background: '#000000',
  foreground: '#e5e5e5',
  cursor: '#e5e5e5',
  selectionBackground: '#3a3a3a',
} as const;

/** 等宽字体栈，必须以 monospace 收尾，否则回落比例字体会导致列对不齐（08 §7.3）。 */
export const TERMINAL_FONT_FAMILY =
  "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export const DEFAULT_TERMINAL_FONT_SIZE = 14;

/** LRU 并发实例上限（webgl 渲染器下 4–6，留 WebGL 上下文预算余量，08 §5.2）。 */
export const TERMINAL_LRU_LIMIT_WEBGL = 6;
/** canvas 渲染器无上下文约束，可放宽（08 §5.2）。 */
export const TERMINAL_LRU_LIMIT_CANVAS = 10;

export interface TerminalOptions {
  scrollback: number;
  fontFamily: string;
  fontSize: number;
  cursorBlink: boolean;
  allowProposedApi: boolean;
  convertEol: boolean;
  macOptionIsMeta: boolean;
  scrollOnUserInput: boolean;
  windowsMode: boolean;
  theme: typeof TERMINAL_THEME;
}

/**
 * 构造 xterm Terminal 的 options（08 §7.3）。抽成纯函数便于单测（12 §3.2）。
 * 注意：类型故意不 import `@xterm/*`（那是 useTerminalInstance 的唯一 import 点），此处只描述形状。
 */
export function buildTerminalOptions(fontSize = DEFAULT_TERMINAL_FONT_SIZE): TerminalOptions {
  return {
    scrollback: 5000,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize,
    cursorBlink: true,
    allowProposedApi: true, // addon-unicode11 前置条件（08 §1.3）
    convertEol: false, // pty 输出已含 \r\n，开启会重复换行
    macOptionIsMeta: true,
    scrollOnUserInput: true,
    windowsMode: false,
    theme: TERMINAL_THEME,
  };
}
