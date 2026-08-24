import { describe, it, expect } from 'vitest';
import { expiryState, formatDaysLeft } from '@/lib/credential/credentialExpiry';

const NOW = Date.parse('2026-08-19T00:00:00.000Z');
const days = (n: number): string => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString();

describe('expiryState（F21-3 §5/§9 边界）', () => {
  it('剩 8 天 → ok', () => {
    expect(expiryState(days(8), NOW)).toBe('ok');
  });
  it('剩 7 天（等号）→ ok（≥7 天绿勾）', () => {
    expect(expiryState(days(7), NOW)).toBe('ok');
  });
  it('剩 6 天 → warning（<7 天）', () => {
    expect(expiryState(days(6), NOW)).toBe('warning');
  });
  it('剩 0 / 负 → expired', () => {
    expect(expiryState(days(0), NOW)).toBe('expired');
    expect(expiryState(days(-1), NOW)).toBe('expired');
  });
  it('expiresAt 为 null（API Key）→ noExpiry', () => {
    expect(expiryState(null, NOW)).toBe('noExpiry');
    expect(expiryState(undefined, NOW)).toBe('noExpiry');
  });
});

describe('formatDaysLeft（P21-3 §9：整数天向下取整）', () => {
  it('>0 → 剩 N 天（向下取整）', () => {
    expect(formatDaysLeft(days(6) /* 6d 整 */, NOW)).toBe('剩 6 天');
    // 6.9 天 → floor → 剩 6 天
    expect(formatDaysLeft(new Date(NOW + 6.9 * 24 * 3600 * 1000).toISOString(), NOW)).toBe(
      '剩 6 天',
    );
  });
  it('不足 1 天 → 剩 <1 天', () => {
    expect(formatDaysLeft(new Date(NOW + 5 * 3600 * 1000).toISOString(), NOW)).toBe('剩 <1 天');
  });
  it('≤0 → 已过期', () => {
    expect(formatDaysLeft(days(0), NOW)).toBe('已过期');
    expect(formatDaysLeft(days(-2), NOW)).toBe('已过期');
  });
  it('无有效期 → undefined（不渲染倒计时）', () => {
    expect(formatDaysLeft(null, NOW)).toBeUndefined();
  });
});
