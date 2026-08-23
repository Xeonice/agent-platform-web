// 握手失败识别（三条 socket.io 通道共用）。本文件钉死一件事：
// **未授权与协议漂移必须分得开**。把 X-Schema-Hash 不匹配显示成"需要解锁"，
// 用户会去解锁一个解不了的问题；反过来把真未授权判成未知原因，解锁门就不弹了。
import { describe, it, expect } from 'vitest';
import { isUnauthorizedError, readSocketErrorCode } from '@/services/ws/socketAuth';

/** 后端 middleware 的形状：`next(err)` 前把码挂在 `err.data` 上，message 也以码开头。 */
function handshakeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { data: { code } });
}

describe('readSocketErrorCode · 三级优先级', () => {
  it('① 首选结构化的 err.data.code', () => {
    expect(readSocketErrorCode(handshakeError('SCHEMA_MISMATCH', '随便什么散文'))).toBe(
      'SCHEMA_MISMATCH',
    );
  });

  it('① 后端加新码不需要前端跟着改（结构化那条路不受白名单限制）', () => {
    expect(readSocketErrorCode(handshakeError('TENANT_SUSPENDED', 'x'))).toBe('TENANT_SUSPENDED');
  });

  it('② 没有 err.data 时退到 message 开头的码', () => {
    expect(
      readSocketErrorCode(new Error('SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0')),
    ).toBe('SCHEMA_MISMATCH');
    expect(readSocketErrorCode(new Error('UNAUTHORIZED: passcode required'))).toBe('UNAUTHORIZED');
  });

  it('③ 老后端的散文兜底', () => {
    expect(readSocketErrorCode(new Error('unauthorized'))).toBe('UNAUTHORIZED');
    expect(readSocketErrorCode('Forbidden')).toBe('UNAUTHORIZED');
    expect(readSocketErrorCode(new Error('request failed with 401'))).toBe('UNAUTHORIZED');
  });

  it('认不出来就是 undefined（传输层抖动不该被当成被拒）', () => {
    expect(readSocketErrorCode(new Error('websocket error'))).toBeUndefined();
    expect(readSocketErrorCode(new Error('timeout'))).toBeUndefined();
    expect(readSocketErrorCode(undefined)).toBeUndefined();
  });

  /**
   * 开头码的解析**刻意是白名单**而不是通用的 `/^[A-Z_]+:/`：
   * 散文里一个偶然的大写前缀会被通用正则当成码，从而绕过散文兜底，
   * 把一次真未授权判成"未知原因"——解锁门就不弹了。
   */
  it('⚠️ "ERROR: unauthorized" 这种偶然大写前缀不许吃掉散文兜底', () => {
    expect(readSocketErrorCode(new Error('ERROR: unauthorized'))).toBe('UNAUTHORIZED');
    expect(isUnauthorizedError(new Error('ERROR: unauthorized'))).toBe(true);
  });
});

describe('isUnauthorizedError · 只认未授权那一个码', () => {
  it.each([
    [
      'UNAUTHORIZED 结构化',
      handshakeError('UNAUTHORIZED', 'UNAUTHORIZED: passcode required'),
      true,
    ],
    [
      'SCHEMA_MISMATCH 结构化',
      handshakeError('SCHEMA_MISMATCH', 'SCHEMA_MISMATCH: expected sb-tasks-v1, got x'),
      false,
    ],
    ['老散文', new Error('unauthorized'), true],
    ['传输层抖动', new Error('websocket error'), false],
  ])('%s ⇒ %s', (_name, err, expected) => {
    expect(isUnauthorizedError(err)).toBe(expected);
  });

  it('后端钉住的那条：SCHEMA_MISMATCH 文案不含任何未授权特征词', () => {
    // 后端有一条测试保证这句话不含 unauthor|forbidden|passcode|401|403；
    // 这里从前端这一侧再确认一次两边的约定确实对得上。
    const message = 'SCHEMA_MISMATCH: expected sb-tasks-v1, got sb-tasks-v0';
    expect(/unauthor|forbidden|passcode|401|403/i.test(message)).toBe(false);
    expect(isUnauthorizedError(new Error(message))).toBe(false);
  });
});
