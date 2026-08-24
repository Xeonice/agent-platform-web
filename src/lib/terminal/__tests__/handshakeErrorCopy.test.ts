// 握手码 → 人话 + "还值不值得重连"。这份表存在的唯一理由是把**两类完全不同的失败**分开：
// 可自愈的（未授权）继续重连，确定性的（协议漂移）停手并叫人刷新。
import { describe, it, expect } from 'vitest';
import {
  describeHandshakeErrorCode,
  isRetryableHandshakeError,
} from '@/lib/terminal/handshakeErrorCopy';

describe('describeHandshakeErrorCode', () => {
  it('SCHEMA_MISMATCH 的人话指向**刷新页面**，且明说重连没用', () => {
    const copy = describeHandshakeErrorCode('SCHEMA_MISMATCH');
    expect(copy?.message).toMatch(/刷新页面/);
    expect(copy?.message).toMatch(/重连不会解决/);
    expect(copy?.retryable).toBe(false);
  });

  it('⚠️ SCHEMA_MISMATCH 的文案不含任何"未授权"特征词（否则前后端两侧的约定就白定了）', () => {
    const copy = describeHandshakeErrorCode('SCHEMA_MISMATCH');
    expect(/unauthor|forbidden|passcode|解锁|口令/i.test(copy?.message ?? '')).toBe(false);
  });

  it('UNAUTHORIZED 是可自愈的：文案指向解锁，且仍然值得重连', () => {
    const copy = describeHandshakeErrorCode('UNAUTHORIZED');
    expect(copy?.message).toMatch(/解锁/);
    expect(copy?.retryable).toBe(true);
  });

  it('未收录的码返回 undefined（把兜底留给调用点的通道语境）', () => {
    expect(describeHandshakeErrorCode('TENANT_SUSPENDED')).toBeUndefined();
    expect(describeHandshakeErrorCode(undefined)).toBeUndefined();
    expect(describeHandshakeErrorCode('')).toBeUndefined();
  });
});

describe('isRetryableHandshakeError', () => {
  it('未知码按**可重连**处理：前端不认识的新码，多敲几次门比永久断线安全', () => {
    expect(isRetryableHandshakeError('TENANT_SUSPENDED')).toBe(true);
    expect(isRetryableHandshakeError(undefined)).toBe(true);
  });

  it('只有确定性失败才停手', () => {
    expect(isRetryableHandshakeError('SCHEMA_MISMATCH')).toBe(false);
    expect(isRetryableHandshakeError('UNAUTHORIZED')).toBe(true);
  });
});
