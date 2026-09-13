import { describe, it, expect, vi } from 'vitest';
import {
  authFlowReducer,
  branchOfMethod,
  initialAuthFlowState,
  apiKeyExpectedPrefix,
  apiKeyPrefixValid,
  type AuthFlowState,
} from '@/lib/credential/authFlow';
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
    expect(s).toEqual({
      branch: 'device-code',
      phase: 'expired',
      challenge: deviceChallenge,
      reason: 'expired',
    });
    // 重新获取 → 重走 begin
    s = authFlowReducer(s, { type: 'BEGIN_START' });
    expect(s.phase).toBe('starting');
  });

  it('POLL_GAVE_UP（前端等够了）→ expired 但 reason=gave-up，与真过期分开', () => {
    // ⛔ 这一条钉的是「码可能完全没过期」。两者共用一个 phase 是有意的（都停下、都给 [换一串重来]），
    //    但 `reason` 必须不同 —— 视图据此换一句话，不能对用户说「设备码已过期」。
    const start: AuthFlowState = {
      branch: 'device-code',
      phase: 'polling',
      challenge: deviceChallenge,
      pollError: false,
    };
    const gaveUp = authFlowReducer(start, { type: 'POLL_GAVE_UP' });
    expect(gaveUp).toEqual({
      branch: 'device-code',
      phase: 'expired',
      challenge: deviceChallenge,
      reason: 'gave-up',
    });
    const reallyExpired = authFlowReducer(start, { type: 'POLL_EXPIRED' });
    expect(reallyExpired).not.toEqual(gaveUp);
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

  it('POLL_FAILED（后端终态 error）→ 停止轮询、转 error（区别于瞬时 POLL_NETWORK_ERROR）', () => {
    const start: AuthFlowState = {
      branch: 'device-code',
      phase: 'polling',
      challenge: deviceChallenge,
      pollError: false,
    };
    const s = authFlowReducer(start, { type: 'POLL_FAILED', message: '授权失败' });
    expect(s).toEqual({ branch: 'device-code', phase: 'error', message: '授权失败' });
    // error 非 polling：可 [再次登录] 重走 begin
    const s2 = authFlowReducer(s, { type: 'BEGIN_START' });
    expect(s2.phase).toBe('starting');
  });

  it('POLL_FAILED 在非 polling 态原样返回（不越迁）', () => {
    const expired: AuthFlowState = {
      branch: 'device-code',
      phase: 'expired',
      challenge: deviceChallenge,
      reason: 'expired',
    };
    expect(authFlowReducer(expired, { type: 'POLL_FAILED', message: 'x' })).toEqual(expired);
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

describe('branchOfMethod 对 access-token-paste 的归并', () => {
  /**
   * ⭐ 后端打通 `access-token-paste` 后，`RuntimeDto.authMethods` 下发的是**完整四值闭集**，
   * 于是这个值会真的流到 `branchOfMethod`。此前它落进 `default`：`console.error` + 静默
   * 归到 api-key 分支 —— 正是那段注释自己说要防的「配错鉴权方式」。
   *
   * ⛔ 现在它是一条**显式**归并（共用「粘贴 → 直存」交互），因此**不许再报错**。
   */
  it('归到 api-key 分支，且不报错（它是合法输入，不是未知值）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(branchOfMethod('access-token-paste')).toBe('api-key');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('apiKeyPrefix（前缀格式提示）', () => {
  /**
   * ⭐ **主路径：前缀由 runtime 自己说了算。** 这条钉住的是"前端不再按 runtimeId 猜前缀"——
   * 把 `apiKeyExpectedPrefix` 改回内部判断 runtimeId 时它红。
   */
  it('runtime 声明了前缀 ⇒ 原样用它', () => {
    expect(apiKeyExpectedPrefix('xyz-')).toBe('xyz-');
    // 第三方 runtime：以前一律掉进 `sk-`，合法 key 被标红且 [保存并继续] 禁用。
    expect(apiKeyExpectedPrefix('acme_')).toBe('acme_');
    expect(apiKeyPrefixValid(apiKeyExpectedPrefix('acme_'), 'acme_k1')).toBe(true);
  });

  /**
   * ⭐ **缺席 ⇒ 不提示，不猜。** 过渡回落表已于 2026-09-08 随后端下发
   * `RuntimeDto.apiKeyPrefix` 一并删除（04 §3 ★3z）。
   *
   * ⛔ 这条是**防复辟**的：任何人再往 lib 里塞一张 `{'claude-code': 'sk-ant-'}`
   * 之类的默认表，第一行就红。前端猜错前缀的代价是「合法凭证根本提交不了」，
   * 比不提示严重得多。
   */
  it('前缀缺席/空串 ⇒ 不提示前缀（⛔ 不按 runtimeId 猜）', () => {
    expect(apiKeyExpectedPrefix(undefined)).toBe('');
    expect(apiKeyExpectedPrefix('')).toBe('');
    // 不提示 = 任何非空 key 都通过格式校验，不会出现假红边。
    expect(apiKeyPrefixValid(apiKeyExpectedPrefix(undefined), 'sk-ant-real')).toBe(true);
    expect(apiKeyPrefixValid(apiKeyExpectedPrefix(undefined), 'acme_whatever')).toBe(true);
  });

  it('前缀不匹配 → false；空串不提示', () => {
    expect(apiKeyPrefixValid('sk-', 'oops')).toBe(false);
    expect(apiKeyPrefixValid('sk-', 'sk-abc')).toBe(true);
    expect(apiKeyPrefixValid('sk-ant-', 'sk-abc')).toBe(false);
    expect(apiKeyPrefixValid('sk-', '')).toBe(true);
  });
});
