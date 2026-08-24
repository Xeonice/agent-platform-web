// WS **握手**被拒的人话（三条通道共用的接收侧收尾，07 §3 规则 5 / 口令门 11 §3.1）。
//
// 分工：`services/ws/socketAuth.ts` 负责**认出码**（结构化 `err.data.code` 优先，散文兜底），
// 本文件负责**把码翻成人话**，并回答一个同样要紧的问题：**这个码值不值得继续重连**。
//
// ⚠️ 为什么"值不值得重连"必须和文案放在一起：
// `SCHEMA_MISMATCH` 是前端**编译期固化**的 schema hash 与后端对不上（14 §2 的运行时兜底那条）。
// 它对每一次重连的答案都完全一样 —— 重试 8 次只是把同一次失败重复 8 遍，然后给用户一个
// 「手动重连」按钮，而那个按钮**永远**不可能成功。唯一的出路是刷新页面拿新前端。
// 反过来 `UNAUTHORIZED` 是可自愈的（解锁拿到 cookie，下次握手就过），必须继续退避重连。
// 把这两类混为一谈，就会得到"弹一扇解不开的解锁门"或"按一个永远按不通的重连键"。

/** 握手失败码的呈现口径。 */
export interface HandshakeErrorCopy {
  /** 人话（已含"现在该做什么"）。 */
  message: string;
  /**
   * 是否值得继续自动重连。
   * `false` = 客户端自身状态导致的确定性失败，重试无意义 ⇒ 上层应停手并给出真正的出路。
   */
  retryable: boolean;
}

/**
 * 通道级握手码 → 人话。取值来自后端 socket.io 握手 middleware：
 * `UNAUTHORIZED`（口令门）/ `SCHEMA_MISMATCH`（X-Schema-Hash 不一致）。
 *
 * ⚠️ **未收录的码返回 `undefined`**，由调用点给通道语境的兜底 —— 后端随时可能加新码
 * （`readSocketErrorCode` 走 `err.data.code` 那条路不受任何白名单限制），
 * 这里给一句放之四海的兜底反而会把新码盖成一句废话。
 */
const HANDSHAKE_ERROR_COPY: Readonly<Record<string, HandshakeErrorCopy>> = {
  UNAUTHORIZED: {
    message: '连接未通过口令校验，解锁后会自动接上。',
    // 可自愈：cookie 就位后下一次重连即通过（useAccessGate 的解锁门正是这么设计的）。
    retryable: true,
  },
  SCHEMA_MISMATCH: {
    message: '页面版本与后端不一致（前端不是最新的），请刷新页面；重连不会解决这个问题。',
    // **确定性失败**：hash 固化在这份前端产物里，重连多少次都是同一个结果。
    retryable: false,
  },
};

export function describeHandshakeErrorCode(
  code: string | undefined,
): HandshakeErrorCopy | undefined {
  if (code === undefined || code === '') return undefined;
  return HANDSHAKE_ERROR_COPY[code];
}

/**
 * 这个握手码还值不值得自动重连。
 *
 * **未知码一律按可重连处理**：后端加了新码而前端还不认识时，"继续退避重连"是安全的默认
 * （最坏是多敲几次门），而"当场停手"会把一次可能自愈的故障变成永久断线。
 */
export function isRetryableHandshakeError(code: string | undefined): boolean {
  return describeHandshakeErrorCode(code)?.retryable ?? true;
}
