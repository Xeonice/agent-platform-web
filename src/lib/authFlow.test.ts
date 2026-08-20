import { describe, it, expect } from 'vitest';
import {
  authFlowReducer,
  branchOfMethod,
  initialAuthFlowState,
  apiKeyExpectedPrefix,
  apiKeyPrefixValid,
  type AuthFlowState,
} from '@/lib/authFlow';
import type { AuthChallenge } from '@/types/runtimeCredential';

const deviceChallenge: AuthChallenge = {
  challengeRef: 'c1',
  method: 'oauth-device',
  kind: 'device-code',
  userCode: 'WDJB-MJHT',
  verificationUrl: 'https://x/device',
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  instructions: '',
};
const pasteChallenge: AuthChallenge = {
  challengeRef: 'c2',
  method: 'setup-token',
  kind: 'paste-prompt',
  verificationUrl: 'https://x/setup',
  instructions: '',
};

describe('branchOfMethod', () => {
  it('方式 → 分支', () => {
    expect(branchOfMethod('oauth-device')).toBe('device-code');
    expect(branchOfMethod('setup-token')).toBe('setup-token');
    expect(branchOfMethod('api-key')).toBe('api-key');
  });
});

describe('A · device-code：idle→pending→success/expired', () => {
  it('idle → BEGIN_START → BEGIN_SUCCESS(polling) → SUCCESS', () => {
    let s: AuthFlowState = initialAuthFlowState('device-code');
    s = authFlowReducer(s, { type: 'BEGIN_START' });
    expect(s).toEqual({ branch: 'device-code', phase: 'starting' });
    s = authFlowReducer(s, { type: 'BEGIN_SUCCESS', challenge: deviceChallenge });
    expect(s.phase).toBe('polling');
    s = authFlowReducer(s, { type: 'SUCCESS', maskedIdentifier: 'a***@gm' });
    expect(s).toEqual({ branch: 'device-code', phase: 'success', maskedIdentifier: 'a***@gm' });
  });

  it('polling → POLL_EXPIRED → expired（保留 challenge，可 [重新获取]）', () => {
    let s: AuthFlowState = {
      branch: 'device-code',
      phase: 'polling',
      challenge: deviceChallenge,
      pollError: false,
    };
    s = authFlowReducer(s, { type: 'POLL_EXPIRED' });
    expect(s).toEqual({ branch: 'device-code', phase: 'expired', challenge: deviceChallenge });
    // 重新获取 → 重走 begin
    s = authFlowReducer(s, { type: 'BEGIN_START' });
    expect(s.phase).toBe('starting');
  });

  it('POLL_NETWORK_ERROR 只标记 pollError，不改 phase（不消耗倒计时）', () => {
    const start: AuthFlowState = {
      branch: 'device-code',
      phase: 'polling',
      challenge: deviceChallenge,
      pollError: false,
    };
    const s = authFlowReducer(start, { type: 'POLL_NETWORK_ERROR' });
    expect(s).toEqual({ ...start, pollError: true });
  });

  it('BEGIN_ERROR → error', () => {
    const s = authFlowReducer(initialAuthFlowState('device-code'), {
      type: 'BEGIN_ERROR',
      message: '失败',
    });
    expect(s).toEqual({ branch: 'device-code', phase: 'error', message: '失败' });
  });
});

describe('B · setup-token：idle→awaiting-paste→success/error', () => {
  it('BEGIN_SUCCESS → awaiting-paste → PASTE_SUBMIT_START → SUCCESS', () => {
    let s: AuthFlowState = initialAuthFlowState('setup-token');
    s = authFlowReducer(s, { type: 'BEGIN_START' });
    s = authFlowReducer(s, { type: 'BEGIN_SUCCESS', challenge: pasteChallenge });
    expect(s).toEqual({
      branch: 'setup-token',
      phase: 'awaiting-paste',
      challenge: pasteChallenge,
      submitting: false,
    });
    s = authFlowReducer(s, { type: 'PASTE_SUBMIT_START' });
    expect(s).toMatchObject({ phase: 'awaiting-paste', submitting: true });
    s = authFlowReducer(s, { type: 'SUCCESS' });
    expect(s).toEqual({ branch: 'setup-token', phase: 'success' });
  });

  it('PASTE_SUBMIT_ERROR → 回 awaiting-paste 带 error', () => {
    let s: AuthFlowState = {
      branch: 'setup-token',
      phase: 'awaiting-paste',
      challenge: pasteChallenge,
      submitting: true,
    };
    s = authFlowReducer(s, { type: 'PASTE_SUBMIT_ERROR', message: '授权码无效' });
    expect(s).toMatchObject({ phase: 'awaiting-paste', submitting: false, error: '授权码无效' });
  });
});

describe('C · api-key：即时完成 / rejected', () => {
  it('APIKEY_SUBMIT_START → SUCCESS', () => {
    let s: AuthFlowState = initialAuthFlowState('api-key');
    s = authFlowReducer(s, { type: 'APIKEY_SUBMIT_START' });
    expect(s).toEqual({ branch: 'api-key', phase: 'submitting' });
    s = authFlowReducer(s, { type: 'SUCCESS', maskedIdentifier: 'sk-...ab12' });
    expect(s).toEqual({ branch: 'api-key', phase: 'success', maskedIdentifier: 'sk-...ab12' });
  });

  it('APIKEY_REJECTED → rejected（就地红字 + 原因列表）', () => {
    let s: AuthFlowState = { branch: 'api-key', phase: 'submitting' };
    s = authFlowReducer(s, { type: 'APIKEY_REJECTED', message: '被拒绝', reasons: ['无权限'] });
    expect(s).toEqual({
      branch: 'api-key',
      phase: 'rejected',
      message: '被拒绝',
      reasons: ['无权限'],
    });
  });

  it('RESET → 回 idle', () => {
    const s = authFlowReducer({ branch: 'api-key', phase: 'submitting' }, { type: 'RESET' });
    expect(s).toEqual({ branch: 'api-key', phase: 'idle' });
  });
});

describe('apiKeyPrefix（前缀格式提示）', () => {
  it('Codex sk- / Claude Code sk-ant-', () => {
    expect(apiKeyExpectedPrefix('codex')).toBe('sk-');
    expect(apiKeyExpectedPrefix('claude-code')).toBe('sk-ant-');
  });
  it('前缀不匹配 → false；空串不提示', () => {
    expect(apiKeyPrefixValid('codex', 'oops')).toBe(false);
    expect(apiKeyPrefixValid('codex', 'sk-abc')).toBe(true);
    expect(apiKeyPrefixValid('claude-code', 'sk-abc')).toBe(false);
    expect(apiKeyPrefixValid('codex', '')).toBe(true);
  });
});
