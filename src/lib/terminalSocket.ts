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

export function buildTerminalSocketConfig(
  base: string,
  sandboxId: string,
  schemaHash = WS_SCHEMA_HASH,
): TerminalSocketConfig {
  return {
    uri: `${normalizeOrigin(base)}${TERMINAL_NAMESPACE}`,
    // cols/rows 先给默认值，精确尺寸后续经 resize 帧同步（08 §4，S1 best-effort）。
    query: { sandboxId, cols: '80', rows: '24', xSchemaHash: schemaHash },
  };
}
