import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/acceptance/support/server';
import { CredentialsContainer } from '@/containers/credential/CredentialsContainer';
import { AuthGateContainer } from '@/containers/credential/AuthGateContainer';
import { UnlockFormView } from '@/views/access/UnlockForm.view';
import { useAppStore } from '@/stores';
import type { RuntimeDto, RuntimeCredentialDeletionPreview } from '@/types/runtimeCredential';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/settings/credentials',
  useSearchParams: () => new URLSearchParams(),
}));
const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const runtimes: RuntimeDto[] = ['codex', 'claude-code'].map((id) => ({
  id,
  displayName: id === 'codex' ? 'Codex' : 'Claude Code',
  vendor: id === 'codex' ? 'OpenAI' : 'Anthropic',
  authMethods: [id === 'codex' ? 'oauth-device' : 'setup-token', 'api-key'],
  credentialStatus: 'active',
  activeAuthMethod: 'account',
  credentials: [
    {
      credentialId: `${id}-account`,
      mode: 'account',
      status: 'ok',
      maskedIdentifier: 'a***@example.com',
    },
    { credentialId: `${id}-key`, mode: 'api-key', status: 'ok', maskedIdentifier: 'sk-…f3a9' },
  ],
}));
function mount(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
beforeEach(() => {
  window.history.replaceState({}, '', '/settings/credentials');
  useAppStore.getState().setPendingProjectCreate(null);
  server.use(
    http.get(`${base}/api/runtimes`, () => HttpResponse.json(runtimes)),
    http.get(`${base}/api/credentials`, () => HttpResponse.json([])),
    http.get(`${base}/api/projects`, () => HttpResponse.json([])),
  );
});
afterEach(cleanup);
async function codexCard() {
  return screen.findByRole('group', { name: 'Codex' });
}

describe('新版凭证验收 · 真实容器与HTTP边界', () => {
  it('AC-AUTH-003.1/003.4：StrictMode展开不启动helper，点开始一次，切标签取消同challenge', async () => {
    const begins = vi.fn(),
      cancels = vi.fn();
    server.use(
      http.post(`${base}/api/runtimes/codex/auth/begin`, () => {
        begins();
        return HttpResponse.json({
          kind: 'device-code',
          method: 'oauth-device',
          challengeRef: 'challenge-actual',
          userCode: 'WDJB-MJHT',
          verificationUrl: 'https://example.test/authorize',
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          instructions: '授权',
        });
      }),
      http.delete(`${base}/api/runtimes/codex/auth/sessions/:ref`, ({ params }) => {
        cancels(params['ref']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(
      <StrictMode>
        <AuthGateContainer
          runtimeId="codex"
          runtimeName="Codex"
          vendor="OpenAI"
          methods={['oauth-device', 'api-key']}
        />
      </StrictMode>,
    );
    expect(begins).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '开始帐号登录' }));
    await screen.findByLabelText('设备码');
    expect(begins).toHaveBeenCalledTimes(1);
    const account = screen.getByRole('tab', { name: '帐号登录' });
    account.focus();
    fireEvent.keyDown(account, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'API Key' })).toHaveFocus();
    await waitFor(() => {
      expect(cancels).toHaveBeenCalledWith('challenge-actual');
    });
    expect(screen.queryByLabelText('设备码')).not.toBeInTheDocument();
  });

  it('AC-CRD-002.1/002.3/002.4：绑定查询失败不冒充0，重试同一框显示idle和等待输入', async () => {
    let count = 0;
    server.use(
      http.get(`${base}/api/runtimes/codex/credentials/codex-account/deletion-preview`, () => {
        if (++count === 1)
          return HttpResponse.json(
            { code: 'INTERNAL', message: '不可读', retryable: true },
            { status: 500 },
          );
        return HttpResponse.json({
          affectedTasks: [
            {
              id: 'idle-task',
              name: '真实空闲任务',
              runtime: 'codex',
              status: 'idle',
              headless: false,
            },
            {
              id: 'waiting-task',
              name: '真实等待任务',
              runtime: 'codex',
              status: 'waiting_input',
              headless: false,
            },
          ],
          preparingTasks: [
            {
              id: 'prepare-task',
              name: '准备任务',
              runtime: 'codex',
              status: 'creating',
              headless: false,
            },
          ],
        } satisfies RuntimeCredentialDeletionPreview);
      }),
    );
    mount(<CredentialsContainer />);
    fireEvent.click(within(await codexCard()).getAllByRole('button', { name: '删除' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: '删除 Codex 的帐号登录？' });
    await within(dialog).findByRole('button', { name: '重试读取' });
    expect(within(dialog).queryByText(/现在没有任务/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '删除凭证' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: '重试读取' }));
    await within(dialog).findByText('会销毁这 2 个任务');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).getByText('真实空闲任务 · Codex · 空闲')).toBeInTheDocument();
    expect(within(dialog).getByText('真实等待任务 · Codex · 等待你输入')).toBeInTheDocument();
    expect(within(dialog).getByText('准备任务 · Codex · 准备中')).toBeInTheDocument();
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
  });

  it('AC-CRD-002.6/005.4：取消/ESC不删除，真实绑定预检只针对点选凭证', async () => {
    const deleted = vi.fn(),
      requested = vi.fn();
    server.use(
      http.get(`${base}/api/runtimes/:rt/credentials/:id/deletion-preview`, ({ params }) => {
        requested(params['rt'], params['id']);
        return HttpResponse.json({
          affectedTasks: [],
          preparingTasks: [],
        } satisfies RuntimeCredentialDeletionPreview);
      }),
      http.delete(`${base}/api/runtimes/:rt/credentials/:id`, ({ params }) => {
        deleted(params['id']);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(<CredentialsContainer />);
    fireEvent.click(within(await codexCard()).getAllByRole('button', { name: '删除' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus();
    });
    await within(dialog).findByText('现在没有任务在用这份凭证，不会销毁任何任务。');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(deleted).not.toHaveBeenCalled();
    expect(requested).toHaveBeenCalledWith('codex', 'codex-account');
  });

  it('AC-CRD-012.1/012.2：各Agent单选独立，确认前保持原使用方式', async () => {
    const switched = vi.fn();
    server.use(
      http.put(`${base}/api/runtimes/:rt/auth-mode`, () => {
        switched();
        return HttpResponse.json({});
      }),
    );
    mount(<CredentialsContainer />);
    await codexCard();
    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(2);
    for (const group of groups)
      expect(within(group).getByRole('radio', { name: /帐号登录/ })).toBeChecked();
    fireEvent.click(within(groups[0]!).getByRole('radio', { name: /API Key/ }));
    await screen.findByRole('dialog', { name: '切换到 API Key' });
    expect(within(groups[0]!).getByRole('radio', { name: /帐号登录/, hidden: true })).toBeChecked();
    expect(within(groups[1]!).getByRole('radio', { name: /帐号登录/, hidden: true })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(switched).not.toHaveBeenCalled();
  });
});

describe('新版访问口令字段验收', () => {
  it('AC-ACC-004.2/004.3/005.3：trim后提交，错误/锁定保留输入，锁定不发送', () => {
    const submit = vi.fn();
    function Host() {
      const [locked, setLocked] = useState(false);
      return (
        <>
          <UnlockFormView
            onSubmit={submit}
            errorMessage="口令不对，再试一次。"
            lockedForMinutes={locked ? 5 : 0}
          />
          <button
            onClick={() => {
              setLocked(true);
            }}
          >
            模拟锁定响应
          </button>
        </>
      );
    }
    mount(<Host />);
    const input = screen.getByLabelText('访问口令');
    fireEvent.change(input, { target: { value: '  synthetic-passcode  ' } });
    fireEvent.click(screen.getByRole('button', { name: '解锁' }));
    expect(submit).toHaveBeenCalledWith('synthetic-passcode');
    fireEvent.click(screen.getByRole('button', { name: '模拟锁定响应' }));
    expect(input).toHaveValue('  synthetic-passcode  ');
    expect(screen.getByRole('button', { name: '解锁' })).toBeDisabled();
    fireEvent.submit(input.closest('form')!);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('约 5 分钟后再试');
  });
});
