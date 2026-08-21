// useRuntimeAuthFlow 三分支状态机（12 §4.2 用例组 B / §7.1）：各分支 idle→pending→success/rejected。
// 轮询/倒计时的时间推进细节由 lib/authFlow 纯 reducer 单测覆盖（authFlow.test），本文件覆盖 hook 编排 + 服务往返。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useRuntimeAuthFlow } from '@/hooks/useRuntimeAuthFlow';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('C · api-key（即时完成路径）', () => {
  it('submitApiKey → success + onSuccess(掩码)', async () => {
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, () =>
        HttpResponse.json({ maskedIdentifier: 'sk-...ab12', activeAuthMethod: 'api-key' }),
      ),
    );
    const onSuccess = vi.fn();
    const { result } = renderHook(() =>
      useRuntimeAuthFlow({ runtimeId: 'codex', method: 'api-key', onSuccess }),
    );
    act(() => {
      result.current.submitApiKey('sk-abc');
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('success');
    });
    expect(onSuccess).toHaveBeenCalledWith({
      maskedIdentifier: 'sk-...ab12',
      activeAuthMethod: 'api-key',
    });
  });

  it('AUTH_REJECTED（400）→ rejected + 原因列表', async () => {
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/credentials/secret`, () =>
        HttpResponse.json(
          {
            code: 'AUTH_REJECTED',
            message: '凭证被拒绝',
            retryable: false,
            details: [{ path: 'secret', code: 'INVALID', message: '额度不足' }],
          },
          { status: 400 },
        ),
      ),
    );
    const { result } = renderHook(() =>
      useRuntimeAuthFlow({ runtimeId: 'codex', method: 'api-key' }),
    );
    act(() => {
      result.current.submitApiKey('sk-abc');
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('rejected');
    });
    const state = result.current.state;
    if (state.branch === 'api-key' && state.phase === 'rejected') {
      expect(state.reasons).toContain('额度不足');
    }
  });
});

describe('B · setup-token', () => {
  it('begin → awaiting-paste → submitPaste → success', async () => {
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, () =>
        HttpResponse.json({
          challengeRef: 'chal-setup',
          method: 'setup-token',
          kind: 'paste-prompt',
          verificationUrl: 'https://x/setup',
          instructions: '粘贴授权码',
        }),
      ),
      http.post(`${API_BASE}/api/runtimes/:rt/auth/complete`, () =>
        HttpResponse.json({ maskedIdentifier: 'a***@gm' }),
      ),
    );
    const { result } = renderHook(() =>
      useRuntimeAuthFlow({ runtimeId: 'claude-code', method: 'setup-token' }),
    );
    act(() => {
      result.current.begin();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('awaiting-paste');
    });
    act(() => {
      result.current.submitPaste('pasted-code');
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('success');
    });
  });
});

describe('A · device-code', () => {
  it('begin → polling（展示设备码 + 倒计时）', async () => {
    server.use(
      http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, () =>
        HttpResponse.json({
          challengeRef: 'chal-device',
          method: 'oauth-device',
          kind: 'device-code',
          userCode: 'WDJB-MJHT',
          verificationUrl: 'https://x/device',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
          instructions: '',
        }),
      ),
      // 轮询保持 pending（本用例只验 begin→polling 迁移；success/expired 由 reducer 单测覆盖）。
      http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () =>
        HttpResponse.json({ status: 'pending' }),
      ),
    );
    const { result } = renderHook(() =>
      useRuntimeAuthFlow({ runtimeId: 'codex', method: 'oauth-device' }),
    );
    act(() => {
      result.current.begin();
    });
    await waitFor(() => {
      expect(result.current.state.phase).toBe('polling');
    });
    const state = result.current.state;
    if (state.branch === 'device-code' && state.phase === 'polling') {
      expect(state.challenge.userCode).toBe('WDJB-MJHT');
    }
    expect(result.current.secondsLeft).toBeGreaterThan(0);
  });

  // 轮询间隔（与 hook 内 POLL_INTERVAL_MS 对齐，仅用于推进 fake timers；非生产硬编码）。
  const POLL_INTERVAL_MS = 3_000;

  function deviceBeginHandler(withExpiry: boolean) {
    return http.post(`${API_BASE}/api/runtimes/:rt/auth/begin`, () =>
      HttpResponse.json({
        challengeRef: 'chal-device',
        method: 'oauth-device',
        kind: 'device-code',
        userCode: 'WDJB-MJHT',
        verificationUrl: 'https://x/device',
        ...(withExpiry ? { expiresAt: new Date(Date.now() + 900_000).toISOString() } : {}),
        instructions: '',
      }),
    );
  }

  it('poll status==="error"（后端终态）→ 停止轮询、转 error（给再次登录入口）', async () => {
    vi.useFakeTimers();
    try {
      let statusCalls = 0;
      server.use(
        deviceBeginHandler(true),
        http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () => {
          statusCalls += 1;
          return HttpResponse.json({ status: 'error' });
        }),
      );
      const { result } = renderHook(() =>
        useRuntimeAuthFlow({ runtimeId: 'codex', method: 'oauth-device' }),
      );
      await act(async () => {
        result.current.begin();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state.phase).toBe('polling');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      // 终态 error 不再当瞬时网络抖动留在 polling，而是转失败态。
      const state = result.current.state;
      expect(state.phase).toBe('error');
      if (state.branch === 'device-code' && state.phase === 'error') {
        expect(state.message).not.toBe('');
      }

      const callsAfterFail = statusCalls;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
      });
      // 已停止轮询：不再有新的 status 请求。
      expect(statusCalls).toBe(callsAfterFail);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expiresAt 缺失 → 10min 硬上限兜底强制转 expired（不无限轮询假死）', async () => {
    vi.useFakeTimers();
    try {
      server.use(
        deviceBeginHandler(false), // 后端漏发 expiresAt
        http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () =>
          HttpResponse.json({ status: 'pending' }),
        ),
      );
      const { result } = renderHook(() =>
        useRuntimeAuthFlow({ runtimeId: 'codex', method: 'oauth-device' }),
      );
      await act(async () => {
        result.current.begin();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state.phase).toBe('polling');
      // 缺 expiresAt：倒计时短路（secondsLeft=0），但不因此误终止——仍在轮询。
      expect(result.current.secondsLeft).toBe(0);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.state.phase).toBe('polling');

      // 越过 10min 硬上限 → 强制 expired（与 expiresAt 无关的兜底）。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(result.current.state.phase).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });

  it('poll status==="expired"（正常过期路径）→ expired，不回归', async () => {
    vi.useFakeTimers();
    try {
      server.use(
        deviceBeginHandler(true),
        http.get(`${API_BASE}/api/runtimes/:rt/auth/status`, () =>
          HttpResponse.json({ status: 'expired' }),
        ),
      );
      const { result } = renderHook(() =>
        useRuntimeAuthFlow({ runtimeId: 'codex', method: 'oauth-device' }),
      );
      await act(async () => {
        result.current.begin();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state.phase).toBe('polling');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(result.current.state.phase).toBe('expired');
    } finally {
      vi.useRealTimers();
    }
  });
});
