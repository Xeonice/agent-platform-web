import { describe, it, expect, vi, afterEach } from 'vitest';
import { reportError, setErrorReporter } from '@/lib/reportError';

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe('reportError (telemetry seam, P1-#4)', () => {
  it('dev 环境打印到 console.error（fail-fast）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reportError('boom', { a: 1 });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]?.[0]).toContain('boom');
  });

  it('注入的 reporter 被调用，拿到 message + context（生产上报端）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reporter = vi.fn();
    setErrorReporter(reporter);
    reportError('invalid_frame', { raw: { type: 'nope' } });
    expect(reporter).toHaveBeenCalledWith('invalid_frame', { raw: { type: 'nope' } });
  });

  it('reporter 抛错被吞掉，不连累主流程', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setErrorReporter(() => {
      throw new Error('reporter down');
    });
    expect(() => {
      reportError('x');
    }).not.toThrow();
  });

  it('未注入 reporter 时不抛（默认 no-op）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => {
      reportError('x');
    }).not.toThrow();
  });
});
