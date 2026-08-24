import { describe, it, expect } from 'vitest';
import {
  isProjectReady,
  cloneProgressPercent,
  formatBytes,
  cloneFailureGuidance,
} from '@/lib/project/projectClone';

describe('projectClone 派生（10 §7）', () => {
  it('isProjectReady 仅 cloneStatus=ready', () => {
    expect(isProjectReady({ cloneStatus: 'ready' })).toBe(true);
    expect(isProjectReady({ cloneStatus: 'cloning' })).toBe(false);
    expect(isProjectReady({ cloneStatus: 'failed' })).toBe(false);
  });

  it('cloneProgressPercent 优先 percent，其次**对象数**比值，否则 null', () => {
    expect(cloneProgressPercent({ phase: 'cloning', percent: 42 })).toBe(42);
    expect(cloneProgressPercent({ phase: 'cloning', percent: 150 })).toBe(100); // clamp
    // 兜底分母是 objectsTotal 而非 totalBytes——后者是幽灵字段，git clone 不报总字节数。
    expect(cloneProgressPercent({ phase: 'cloning', objectsDone: 50, objectsTotal: 200 })).toBe(25);
    expect(cloneProgressPercent({ phase: 'cloning' })).toBeNull();
    expect(cloneProgressPercent({ phase: 'cloning', objectsDone: 1, objectsTotal: 0 })).toBeNull();
    // 只有字节数、没有对象数 ⇒ 算不出百分比（走 indeterminate），不能瞎猜一个分母。
    expect(cloneProgressPercent({ phase: 'cloning', receivedBytes: 999 })).toBeNull();
  });

  it('formatBytes 人类可读', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });

  it('cloneFailureGuidance 分支：PERMISSION 需凭证不可重试、NETWORK/TIMEOUT/INTERRUPTED 可重试', () => {
    const perm = cloneFailureGuidance('CLONE_FAILED_PERMISSION');
    expect(perm.canRetry).toBe(false);
    expect(perm.needsCredentials).toBe(true);

    for (const code of ['CLONE_FAILED_NETWORK', 'TIMEOUT', 'INTERRUPTED']) {
      const g = cloneFailureGuidance(code);
      expect(g.canRetry).toBe(true);
      expect(g.needsCredentials).toBe(false);
    }

    // 未知码 → 通用重试
    const unknown = cloneFailureGuidance('WHATEVER');
    expect(unknown.canRetry).toBe(true);
  });

  it('DISK_INSUFFICIENT → 不可重试（03 §7.5 retryable=❌），保留转空', () => {
    const g = cloneFailureGuidance('DISK_INSUFFICIENT');
    expect(g.canRetry).toBe(false);
    expect(g.needsCredentials).toBe(false);
    expect(g.message).toContain('磁盘');
  });
});
