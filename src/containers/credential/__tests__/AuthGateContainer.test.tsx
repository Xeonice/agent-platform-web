// AuthGateContainer 的「已连上」成功态回归（此前全仓零覆盖——`grep 已连上` 只命中过 view 文件本身）。
//
// 本轮只改了一件事：`✅ 已连上` 这句文案拼进字符串的 emoji 拆成了结构化的 lucide `<Check>`
// 图标 + 纯文本（07 §4.1：图标是装饰，语义留在文字里）。这条用例钉住"真的换成了图标组件"，
// 不是只锁文案——纯文案断言在"emoji 字符"与"lucide 组件"两种写法下都会绿，锁不住图标本身。
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AuthFlowState } from '@/lib/credential/authFlow';
import type { RuntimeAuthFlow } from '@/hooks/credential/useRuntimeAuthFlow';

const authFlowState = vi.hoisted<{ current: AuthFlowState }>(() => ({
  current: { branch: 'device-code', phase: 'idle' },
}));

vi.mock('@/hooks/credential/useRuntimeAuthFlow', () => ({
  useRuntimeAuthFlow: (): RuntimeAuthFlow => ({
    state: authFlowState.current,
    secondsLeft: null,
    expectedPrefix: '',
    isApiKeyPrefixValid: () => true,
    begin: () => undefined,
    refetchChallenge: () => undefined,
    submitPaste: () => undefined,
    submitApiKey: () => undefined,
    reset: () => undefined,
  }),
}));

import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';

describe('AuthGateContainer · 成功态', () => {
  it('⭐ phase=success ⇒ 渲染 Check 图标 + 「已连上」，不是拼进文案的 emoji', () => {
    authFlowState.current = { branch: 'device-code', phase: 'success' };
    render(<AuthGateContainer runtimeId="codex" runtimeName="Codex" methods={['oauth-device']} />);

    const success = screen.getByTestId('auth-gate-success');
    expect(success).toHaveTextContent('已连上');
    // MUTATION：把 `<Check>` 换回 ✅ 字符或换成另一个图标 ⇒ 这条先红。
    expect(success.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('phase 不是 success 时不渲染这一行（防止误判成"总是显示"）', () => {
    authFlowState.current = { branch: 'device-code', phase: 'idle' };
    render(<AuthGateContainer runtimeId="codex" runtimeName="Codex" methods={['oauth-device']} />);
    expect(screen.queryByTestId('auth-gate-success')).toBeNull();
  });
});
