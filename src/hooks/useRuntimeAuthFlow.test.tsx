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
});
