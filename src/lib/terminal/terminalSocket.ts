// socket.io /terminal 连接描述（纯函数，可单测）。socket.io 用 namespace + query options，不再手拼 ws://…?… 整串。
// query 键名对齐后端契约：schema-hash 是 `xSchemaHash`（不是 schemaHash）；后端也接受 auth.xSchemaHash / header x-schema-hash，用 query 最简单。
// socketSessionKey 由 ptySocket 在重连时并入 query（此处只给基础 query）。
import type { TerminalSocketConfig } from '@/types/terminal';

export const WS_SCHEMA_HASH = 'sb-terminal-v1';

export const TERMINAL_NAMESPACE = '/terminal';

export type { TerminalSocketConfig };

/** socket.io 用 http(s) origin（内部自行升级到 ws）；容忍传入 ws(s):// 并归一化。 */
export function normalizeOrigin(base: string): string {
  return base
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://')
    .replace(/\/+$/, '');
}

/** xterm 尚未 fit 出真实尺寸时的占位（**不应该被用到**，见下方说明）。 */
export const FALLBACK_TERMINAL_SIZE = { cols: 80, rows: 24 } as const;

/**
 * ★ `size` 必须是**已 fit 出来的真实尺寸**。
 *
 * 这里的 `cols/rows` 决定容器里 **PTY 的出生尺寸**，而 agent CLI 一启动就按它画欢迎
 * 横幅/边框。终端协议里没有"回流"——已经吐出的字节不会因为后来的 resize 重排，
 * 所以事后补一帧 resize **救不回**第一屏：它会一直保持出生时的宽度。
 *
 * 此前这里写死 `80x24` 并在注释里说"精确尺寸后续经 resize 帧同步"。resize 帧确实会发
 * （`TerminalMount` 的 `resync`），但那只对**之后**的输出有效，于是宽屏上看到的是一个
 * 80 列的窄框浮在一大片空白里。调用方现在负责先 fit 再连（`TerminalMount`）。
 */
export function buildTerminalSocketConfig(
  base: string,
  sandboxId: string,
  size: { cols: number; rows: number } = FALLBACK_TERMINAL_SIZE,
  schemaHash = WS_SCHEMA_HASH,
): TerminalSocketConfig {
  return {
    uri: `${normalizeOrigin(base)}${TERMINAL_NAMESPACE}`,
    query: {
      sandboxId,
      cols: String(size.cols),
      rows: String(size.rows),
      xSchemaHash: schemaHash,
    },
  };
}
