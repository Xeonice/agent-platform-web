// socket.io 通道共享的握手失败识别（/terminal、/events、/tasks 三条通道复用，07 §3 规则 5 / 口令门 11 §3.1）。
//
// 后端拒绝握手的方式是 middleware `next(new Error('<CODE>: …'))`，客户端收到 `connect_error`：
//  · **首选** `err.data.code` —— socket.io 会把 `Error.data` 原样带到客户端，是结构化、不用猜的那条；
//  · 其次 message 的开头码（`UNAUTHORIZED: …` / `SCHEMA_MISMATCH: expected sb-tasks-v1, got …`）；
//  · 最后才是老后端的散文匹配。
//
// ⚠️ **为什么必须把两个码分开**：X-Schema-Hash 不匹配是版本漂移，
// 把它显示成"需要解锁"会把用户送去解锁一个解不了的问题。后端那边有一条测试钉住
// `SCHEMA_MISMATCH` 的文案不含 `unauthor|forbidden|passcode|401|403`，两边合起来才封得住。
// 传输层错误（'websocket error' / 'timeout'）三条路都不匹配，网络抖动不会被误判。

/** 老后端只给散文时的兜底特征。 */
const AUTH_PROSE = /unauthor|forbidden|passcode|401|403/i;

/**
 * 允许从 **message 开头**解析出来的码。
 *
 * 刻意是白名单而不是通用的 `/^[A-Z_]+:/`：散文里一个偶然的大写前缀（`ERROR: unauthorized`）
 * 会被通用正则当成码，从而绕过下面的散文兜底，把一次真未授权判成"未知原因"。
 * 后端新增码不需要动这里——那条路走 `err.data.code`，不受白名单限制。
 */
const HANDSHAKE_CODES = ['UNAUTHORIZED', 'SCHEMA_MISMATCH'] as const;

function readMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) return String(err.message);
  return '';
}

/** socket.io 在 `connect_error` 上带的结构化码（后端 `next(err)` 前挂在 `err.data` 上）。 */
function readStructuredCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('data' in err)) return undefined;
  const data: unknown = err.data;
  if (typeof data !== 'object' || data === null || !('code' in data)) return undefined;
  const code: unknown = data.code;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

/**
 * 握手失败的码；`undefined` = 认不出来（多半是传输层抖动，不是被拒）。
 */
export function readSocketErrorCode(err: unknown): string | undefined {
  const structured = readStructuredCode(err);
  if (structured !== undefined) return structured;

  const message = readMessage(err);
  const leading = HANDSHAKE_CODES.find(
    (code) => message === code || message.startsWith(`${code}:`) || message.startsWith(`${code} `),
  );
  if (leading !== undefined) return leading;

  return AUTH_PROSE.test(message) ? 'UNAUTHORIZED' : undefined;
}

/** 握手被口令门拒绝（未授权）⇒ 上层弹解锁门。 */
export function isUnauthorizedError(err: unknown): boolean {
  return readSocketErrorCode(err) === 'UNAUTHORIZED';
}
