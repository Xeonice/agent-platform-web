import { describe, expect, it } from 'vitest';
import { subscriptionStepModel } from '../subscriptionReadiness';
import type { RuntimeDto } from '@/types/runtimeCredential';

function rt(over: Partial<RuntimeDto> = {}): RuntimeDto {
  // ⚠️ 直接构造成契约类型，不打断言 —— 断言一旦打下去，契约改了这份替身也不会红。
  const base: RuntimeDto = {
    id: 'codex',
    displayName: 'ChatGPT（Codex）',
    vendor: 'openai',
    authMethods: ['oauth-device', 'api-key'],
    credentialStatus: 'none',
    credentials: [],
  };
  return { ...base, ...over };
}

describe('subscriptionStepModel —— 判据是「至少一个可用」', () => {
  it('⛔ 一个配好、另一个空 ⇒ 就绪（不该被用不上的那个挡住）', () => {
    const m = subscriptionStepModel([
      rt({ id: 'codex', credentialStatus: 'active', maskedIdentifier: 'a***@gmail.com' }),
      rt({ id: 'claude-code', displayName: 'Claude Code', credentialStatus: 'none' }),
    ]);
    expect(m.ready).toBe(true);
    expect(m.blockedText).toBeUndefined();
  });

  it('全都没配 ⇒ 未就绪，且那句话必须说出口', () => {
    const m = subscriptionStepModel([rt(), rt({ id: 'claude-code' })]);
    expect(m.ready).toBe(false);
    expect(m.blockedText).toContain('无法发起任何任务');
  });

  it('⛔ `expiring` 算可用 —— 它是「快到期」不是「不能用」', () => {
    // 把它算成未就绪会在一台完全能干活的机器上挡住向导，而用户能做的只有白授权一次。
    expect(subscriptionStepModel([rt({ credentialStatus: 'expiring' })]).ready).toBe(true);
  });

  it('`expired` 不算可用，且与「从未配置」分得开（两者下一步不同）', () => {
    const m = subscriptionStepModel([
      rt({ id: 'a', credentialStatus: 'expired' }),
      rt({ id: 'b', credentialStatus: 'none' }),
    ]);
    expect(m.ready).toBe(false);
    expect(m.runtimes.map((r) => r.state)).toEqual(['expired', 'none']);
  });

  it('掩码身份原样带出；⛔ 没有就不编一个', () => {
    const m = subscriptionStepModel([
      rt({ credentialStatus: 'active', maskedIdentifier: 'a***@gmail.com' }),
      rt({ id: 'b', credentialStatus: 'none' }),
    ]);
    expect(m.runtimes[0]!.maskedIdentifier).toBe('a***@gmail.com');
    expect(m.runtimes[1]!.maskedIdentifier).toBeUndefined();
  });

  it('methods 原样取后端下发的，前端不自造枚举', () => {
    const m = subscriptionStepModel([rt({ authMethods: ['setup-token'] })]);
    expect(m.runtimes[0]!.methods).toEqual(['setup-token']);
  });

  it('⛔ 一个 runtime 都没有（registry 空）⇒ 未就绪，不崩', () => {
    const m = subscriptionStepModel([]);
    expect(m.ready).toBe(false);
    expect(m.runtimes).toEqual([]);
  });
});
