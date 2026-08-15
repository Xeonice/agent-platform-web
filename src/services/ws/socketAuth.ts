// socket.io 通道共享的未授权识别（/terminal 与 /events 复用，07 §3 规则 5 / 口令门 11 §3.1）。
// 服务端中间件 `next(new Error('unauthorized'))` → 客户端 connect_error 的 err.message 携带该文案；
// 传输层错误（'websocket error' / 'timeout'）不匹配，避免网络抖动被误判为需要解锁。
export function isUnauthorizedError(err: unknown): boolean {
  let message = '';
  if (typeof err === 'string') message = err;
  else if (typeof err === 'object' && err !== null && 'message' in err) {
    message = String(err.message);
  }
  return /unauthor|forbidden|passcode|401|403/i.test(message);
}
