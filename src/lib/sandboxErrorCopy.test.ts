import { describe, it, expect } from 'vitest';
import {
  describeSandboxError,
  isZeroSideEffectRejection,
  capabilityRejectionMessage,
  SANDBOX_ENDED_COPY,
} from '@/lib/sandboxErrorCopy';

describe('错误码 → 人话 + 可操作建议（P22 §1）', () => {
  it('每条已知码都同时给「发生了什么」和「现在能做什么」（禁止裸抛错误码）', () => {
    for (const code of [
      'INSTALL_FAILED',
      'IMAGE_CONTRACT_VIOLATION',
      'IMAGE_PULL_FAILED',
      'MANIFEST_INVALID',
      'RESOURCE_EXHAUSTED',
      'PROVIDER_UNAVAILABLE',
      'TIMEOUT',
      'INVALID_STATE',
    ]) {
      const copy = describeSandboxError({ code });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.advice.length).toBeGreaterThan(0);
      expect(copy.actions.length).toBeGreaterThan(0);
      // 人话面里不出现裸错误码。
      expect(copy.title).not.toContain(code);
    }
  });

  it('INSTALL_FAILED：已落库、中途失败 → **给 [重试]** + 换预装镜像的建议', () => {
    const copy = describeSandboxError({ code: 'INSTALL_FAILED' });
    expect(copy.title).toContain('运行时 CLI 安装失败');
    expect(copy.actions.map((a) => a.key)).toContain('retry');
    expect(copy.actions.some((a) => a.label.includes('镜像'))).toBe(true);
  });

  it('IMAGE_CONTRACT_VIOLATION：缺 tmux → **不给 [重试]**（重试不会改变镜像内容）', () => {
    const copy = describeSandboxError({ code: 'IMAGE_CONTRACT_VIOLATION' });
    expect(copy.title).toContain('缺少 tmux');
    expect(copy.actions.map((a) => a.key)).not.toContain('retry');
    expect(copy.actions).toHaveLength(1);
    expect(copy.actions[0]?.label).toContain('换一张含 tmux 的镜像');
  });

  it('未知码 / 无码：仍给人话 + 可点动作（异步失败拿不到码时的兜底）', () => {
    const unknown = describeSandboxError({ code: 'WHATEVER' });
    expect(unknown.actions.length).toBeGreaterThan(0);
    const noCode = describeSandboxError({});
    expect(noCode.code).toBe('UNKNOWN');
    expect(noCode.actions.length).toBeGreaterThan(0);
  });

  it('ended 与 failed 分开：结束态不复用失败文案', () => {
    expect(SANDBOX_ENDED_COPY.title).not.toContain('❌');
    expect(SANDBOX_ENDED_COPY.actions.map((a) => a.key)).toEqual(['reconfigure']);
  });
});

describe('零副作用拒绝（409 能力静态校验）≠ 创建失败可重试', () => {
  it('只有 409 + 能力码算零副作用；其它状态码/错误码不算', () => {
    expect(isZeroSideEffectRejection(409, 'UNSUPPORTED_CAPABILITY')).toBe(true);
    // 同一个码但不是 409 → 不当零副作用处理（避免把已落库的失败误判成"什么都没发生"）。
    expect(isZeroSideEffectRejection(500, 'UNSUPPORTED_CAPABILITY')).toBe(false);
    // 409 但不是能力码（如状态冲突）→ 走普通失败路径。
    expect(isZeroSideEffectRejection(409, 'INVALID_STATE')).toBe(false);
    // INSTALL_FAILED 是已落库、中途失败，绝不能被当成零副作用。
    expect(isZeroSideEffectRejection(409, 'INSTALL_FAILED')).toBe(false);
  });

  it('就地提示明说"未创建任何任务"，且不含任何重试语义', () => {
    const msg = capabilityRejectionMessage({ message: 'provider boxlite 不支持 snapshot' });
    expect(msg).toContain('未创建任何任务');
    expect(msg).toContain('改选');
    expect(msg).not.toContain('重试创建');
    expect(msg).not.toContain('重新创建');
  });
});
