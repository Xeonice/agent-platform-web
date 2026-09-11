// socket.io /terminal 连接描述（纯函数，可单测）。socket.io 用 namespace + query options，不再手拼 ws://…?… 整串。
// query 键名对齐后端契约：schema-hash 是 `xSchemaHash`（不是 schemaHash）；后端也接受 auth.xSchemaHash / header x-schema-hash，用 query 最简单。
// socketSessionKey 由 ptySocket 在重连时并入 query（此处只给基础 query）。
import type { TerminalSessionKind } from '@/types/ws-protocol';
import type { TerminalSocketConfig } from '@/types/terminal';

// ⚠️ v1 → v2：多终端标签（06 §5）——`session` 多了 `shellId?`、客户端多了
//    `close_shell{shellId}`。
// ⚠️ v2 → v3：刷新后恢复标签（06 §5.5）——服务端多了 `shells{shells}`。
// ⚠️ v3 → v4：标签能选跑什么 CLI（06 §5.6）——握手多了 `kind=runtime` + `?runtimeId=`，
//    清单元素从裸 id 变成 `{shellId, runtimeId?}`。
// 这个字面量必须与 api 的 `WS_SCHEMA_HASH` **逐字相同**，否则每一次握手都会被判协议漂移。
export const WS_SCHEMA_HASH = 'sb-terminal-v4';

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

/**
 * 给一份基础连接描述打上「连哪一个会话」的标记（06 §5）。
 *
 * ⚠️ **`shellId` 只在已经知道的时候才带**。一个全新的用户标签什么都不带 ⇒ 后端现生成
 * 一个并随 `session` 首帧回传；那之后这个标签被 LRU 淘汰再重建时，带上它就能接回
 * **同一个** tmux 会话，而不是又开一个（那会在沙箱里堆孤儿）。
 *
 * ⛔ 前端**永远不自造** `shellId`：它是服务端生成的（审计 P2-9），而且会进后端
 * `tmux -s` 的 argv。这里只会把后端给过的值原样带回去。
 *
 * ⚠️ agent 那一支**不带 `kind`**（而不是带 `kind=agent`）：缺省就是 agent，少一个
 * 参数就少一次"两处都得改对"的机会，也让旧连接串与新的逐字一致。
 */
export function withTerminalTarget(
  config: TerminalSocketConfig,
  target: { kind: TerminalSessionKind; shellId?: string; runtimeId?: string },
): TerminalSocketConfig {
  if (target.kind === 'agent') return config;
  return {
    uri: config.uri,
    query: {
      ...config.query,
      kind: target.kind,
      ...(target.shellId === undefined || target.shellId === '' ? {} : { shellId: target.shellId }),
      // ⚠️ `runtime` 那一支**必须**带 runtimeId（后端会因缺它而拒握手）：
      //    「开哪个 CLI」是寻址的一部分，不是可选装饰。
      ...(target.kind === 'runtime' && target.runtimeId !== undefined && target.runtimeId !== ''
        ? { runtimeId: target.runtimeId }
        : {}),
    },
  };
}
