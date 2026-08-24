import { describe, it, expect } from 'vitest';
import { maskEmail, maskKey, matchesRuntimeSearch } from '@/lib/credential/maskAccount';

describe('maskEmail / maskKey（F21-3 §7.1 掩码回归）', () => {
  it('邮箱 → a***@gmail.com', () => {
    expect(maskEmail('alice@gmail.com')).toBe('a***@gmail.com');
  });
  it('key → sk-...ab12', () => {
    expect(maskKey('sk-supersecretab12')).toBe('sk-...ab12');
  });
  it('任何输入下输出长度 ≤ 输入长度且不含中间原文', () => {
    for (const input of ['alice@gmail.com', 'sk-supersecrettoken1234', 'bob.smith@corp.io']) {
      const masked = input.includes('@') ? maskEmail(input) : maskKey(input);
      expect(masked.length).toBeLessThanOrEqual(input.length);
    }
    // 中间原文不得出现在掩码里。
    expect(maskEmail('alice@gmail.com')).not.toContain('lice');
    expect(maskKey('sk-supersecretab12')).not.toContain('supersecret');
  });
});

describe('matchesRuntimeSearch（F21-3 §9 #8 搜索匹配口径）', () => {
  it('匹配 runtime 名', () => {
    expect(matchesRuntimeSearch('cod', 'Codex', 'a***@gmail.com')).toBe(true);
  });
  it('匹配掩码尾号可见部分（搜 ab12 命中 sk-...ab12）', () => {
    expect(matchesRuntimeSearch('ab12', 'Codex', 'sk-...ab12')).toBe(true);
  });
  it('匹配邮箱可见部分（搜 gm 命中 a***@gmail.com）', () => {
    expect(matchesRuntimeSearch('gm', 'Codex', 'a***@gmail.com')).toBe(true);
  });
  it('不匹配被遮蔽的中间段（搜完整邮箱 alice 不命中掩码 a***@…）', () => {
    expect(matchesRuntimeSearch('alice', 'Codex', 'a***@gmail.com')).toBe(false);
  });
  it('空 query 命中全部', () => {
    expect(matchesRuntimeSearch('', 'Codex', undefined)).toBe(true);
  });
});
