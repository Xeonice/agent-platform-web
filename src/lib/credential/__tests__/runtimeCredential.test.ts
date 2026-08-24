import { describe, it, expect } from 'vitest';
import {
  runtimeCardModel,
  switchModeDecision,
  revokeConfirmConfig,
  methodToMode,
} from '@/lib/credential/runtimeCredential';
import type { RuntimeDto } from '@/types/runtimeCredential';

const NOW = Date.parse('2026-08-19T00:00:00.000Z');
const in30d = new Date(NOW + 30 * 24 * 3600 * 1000).toISOString();

/** codex：帐号授权已配置（生效，剩 30 天）；API Key 未配置（不在 credentials[]）。 */
const codex: RuntimeDto = {
  id: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  authMethods: ['oauth-device', 'api-key'],
  credentialStatus: 'active',
  maskedIdentifier: 'a***@gmail.com',
  expiresAt: in30d,
  activeAuthMethod: 'account',
  credentials: [
    {
      credentialId: 'rc-1',
      mode: 'account',
      maskedIdentifier: 'a***@gmail.com',
      status: 'ok',
      expiresAt: in30d,
    },
  ],
};

describe('methodToMode', () => {
  it('帐号授权方式 → account；api-key → api-key', () => {
    expect(methodToMode('oauth-device')).toBe('account');
    expect(methodToMode('setup-token')).toBe('account');
    expect(methodToMode('api-key')).toBe('api-key');
  });
});

describe('runtimeCardModel（逐模式 credentials[] 映射）', () => {
  it('生效帐号授权行挂掩码 + credentialId + 有效期；API Key 行未配置', () => {
    const model = runtimeCardModel(codex, NOW);
    expect(model.rows).toHaveLength(2);
    const account = model.rows.find((r) => r.mode === 'account');
    expect(account).toMatchObject({
      active: true,
      configured: true,
      maskedIdentifier: 'a***@gmail.com',
      credentialId: 'rc-1',
      expiryLabel: '剩 30 天',
      expiryState: 'ok',
    });
    const apiKey = model.rows.find((r) => r.mode === 'api-key');
    expect(apiKey).toMatchObject({ active: false, configured: false });
    // 未配置行不挂掩码/凭证 id，不渲染倒计时。
    expect(apiKey?.maskedIdentifier).toBeUndefined();
    expect(apiKey?.credentialId).toBeUndefined();
    expect(apiKey?.expiryLabel).toBeUndefined();
    expect(model.hasAnyCredential).toBe(true);
  });

  it('两模式都已配置（一生效一留存）→ 两行各自掩码 + credentialId', () => {
    const both: RuntimeDto = {
      ...codex,
      credentials: [
        {
          credentialId: 'rc-1',
          mode: 'account',
          maskedIdentifier: 'a***@gmail.com',
          status: 'ok',
          expiresAt: in30d,
        },
        { credentialId: 'rc-2', mode: 'api-key', maskedIdentifier: 'sk-...ab12', status: 'ok' },
      ],
    };
    const model = runtimeCardModel(both, NOW);
    const apiKey = model.rows.find((r) => r.mode === 'api-key');
    expect(apiKey).toMatchObject({
      configured: true,
      active: false,
      credentialId: 'rc-2',
      maskedIdentifier: 'sk-...ab12',
    });
    // API Key 无 expiresAt → 不渲染倒计时。
    expect(apiKey?.expiryLabel).toBeUndefined();
  });

  it('API Key 已配置且过期状态 → expiryState expired', () => {
    const dto: RuntimeDto = {
      ...codex,
      activeAuthMethod: 'api-key',
      credentials: [
        {
          credentialId: 'rc-2',
          mode: 'api-key',
          maskedIdentifier: 'sk-...ab12',
          status: 'expired',
        },
      ],
    };
    const apiKey = runtimeCardModel(dto, NOW).rows.find((r) => r.mode === 'api-key');
    expect(apiKey?.expiryState).toBe('expired');
  });

  it('无凭证 runtime（credentials []）→ 两行均未配置', () => {
    const none: RuntimeDto = {
      id: 'claude-code',
      displayName: 'Claude Code',
      vendor: 'Anthropic',
      authMethods: ['setup-token', 'api-key'],
      credentialStatus: 'none',
      credentials: [],
    };
    const model = runtimeCardModel(none, NOW);
    expect(model.hasAnyCredential).toBe(false);
    expect(model.rows.every((r) => !r.configured)).toBe(true);
  });
});

describe('switchModeDecision（F21-3 §5）', () => {
  it('切到已配置但未生效模式 → confirm', () => {
    const both: RuntimeDto = {
      ...codex,
      activeAuthMethod: 'account',
      credentials: [
        {
          credentialId: 'rc-1',
          mode: 'account',
          maskedIdentifier: 'a***@gmail.com',
          status: 'ok',
          expiresAt: in30d,
        },
        { credentialId: 'rc-2', mode: 'api-key', maskedIdentifier: 'sk-...ab12', status: 'ok' },
      ],
    };
    const model = runtimeCardModel(both, NOW);
    expect(switchModeDecision(model, 'api-key')).toEqual({ kind: 'confirm', mode: 'api-key' });
  });

  it('切到未配置模式 → needs-setup（不报错）', () => {
    const model = runtimeCardModel(codex, NOW);
    expect(switchModeDecision(model, 'api-key')).toEqual({
      kind: 'needs-setup',
      mode: 'api-key',
      method: 'api-key',
    });
  });

  it('切到已生效模式 → null（无操作）', () => {
    const model = runtimeCardModel(codex, NOW);
    expect(switchModeDecision(model, 'account')).toBeNull();
  });
});

describe('revokeConfirmConfig（F21-3 §5：生效模式 warnActiveMode）', () => {
  it('吊销生效中模式 → warnActiveMode:true；另一模式未配置 → otherModeConfigured:false', () => {
    const model = runtimeCardModel(codex, NOW);
    expect(revokeConfirmConfig(model, 'account')).toMatchObject({
      warnActiveMode: true,
      otherModeConfigured: false,
    });
  });
});
