import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, body, deferred, project, provider, runtime, sandbox } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import { useAppStore, partializeAppState } from '@/stores';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
function launch(overview = false) {
  useAppStore.setState({ currentModal: 'newTask' });
  return mount(
    <SandboxTerminalContainer
      wsBaseUrl="ws://localhost:3001"
      projectId="project-a"
      projectName="acme-web"
      projectSourceType="git"
      launchProjectId={overview ? null : 'project-a'}
      projects={[
        project(),
        project({ id: 'project-empty', name: '空项目', sourceType: 'empty' }),
        project({ id: 'project-cloning', name: '正在克隆', cloneStatus: 'cloning' }),
      ]}
    />,
  );
}
async function pick() {
  fireEvent.click(await screen.findByRole('radio', { name: /Codex/ }));
}
describe('LCH · explicit project/Agent selection through admission', () => {
  it('AC-LCH-001/002: overview requires a project and an Agent; blocked primary remains focusable and sends no POST', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, () => {
        sent();
        return HttpResponse.json(sandbox({ status: 'pending' }));
      }),
    );
    launch(true);
    await screen.findByRole('radio', { name: /Codex/ });
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    expect(screen.getByLabelText('项目')).toHaveValue('');
    expect(screen.getByRole('option', { name: '正在克隆（克隆中）' })).toBeDisabled();
    primary.focus();
    expect(primary).toHaveFocus();
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(primary);
    expect(sent).not.toHaveBeenCalled();
  });
  it('AC-LCH-003/004: changing project preserves Agent/prompt, resets branch and omits it for empty projects', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        sent(await body(request));
        return HttpResponse.json(
          sandbox({ status: 'pending', hasRun: false, projectId: 'project-empty' }),
          { status: 201 },
        );
      }),
    );
    launch();
    await pick();
    const branches = await screen.findByLabelText('分支（可选）');
    fireEvent.change(branches, { target: { value: 'feat/login-refresh' } });
    fireEvent.change(screen.getByLabelText('任务指令（可选）'), {
      target: { value: '修复登录状态' },
    });
    fireEvent.change(screen.getByLabelText('项目'), { target: { value: 'project-empty' } });
    expect(screen.queryByLabelText('分支（可选）')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('修复登录状态');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        projectId: 'project-empty',
        runtime: 'codex',
        initialPrompt: '修复登录状态',
      });
    });
    await screen.findByTestId('sandbox-startup-progress');
    expect(useAppStore.getState().selectedProjectId).toBe('project-empty');
  });
  it('AC-LCH-005/006: pending clears local instruction, locks dismissal, then branch rejection restores it without creating an object', async () => {
    const gate = deferred();
    server.use(
      http.post(`${API}/api/sandboxes`, async () => {
        await gate.promise;
        return HttpResponse.json(
          {
            code: 'BRANCH_NOT_FOUND',
            message: 'remote disappeared',
            retryable: false,
            sideEffectFree: true,
          },
          { status: 400 },
        );
      }),
    );
    launch();
    await pick();
    fireEvent.change(screen.getByLabelText('任务指令（可选）'), {
      target: { value: '保留这段本地指令' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await screen.findByRole('button', { name: '创建中…' });
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    act(gate.release);
    expect(await screen.findByRole('alert')).toHaveTextContent('本次请求未创建任何任务');
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('保留这段本地指令');
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
    expect(JSON.stringify(partializeAppState(useAppStore.getState()))).not.toContain(
      '保留这段本地指令',
    );
  });
  it('AC-LCH-007: RESOURCE_EXHAUSTED uses real registered/max capacity, including stopped tasks', async () => {
    server.use(
      http.post(`${API}/api/sandboxes`, () =>
        HttpResponse.json(
          { code: 'RESOURCE_EXHAUSTED', message: 'full', retryable: true },
          { status: 429 },
        ),
      ),
    );
    launch();
    await pick();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('8 / 8');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('停止任务不会腾出名额');
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
  it('AC-LCH-008: a host without TTY blocks before POST and gives a factual destination', async () => {
    const sent = vi.fn();
    server.use(
      http.get(`${API}/api/providers`, () =>
        HttpResponse.json([
          { ...provider, capabilities: { ...provider.capabilities, spawnTty: false } },
        ]),
      ),
      http.post(`${API}/api/sandboxes`, () => {
        sent();
        return HttpResponse.json(sandbox());
      }),
    );
    launch();
    await pick();
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(primary);
    expect(sent).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('改发无头任务');
  });
  it('AC-LCH-003/AC-AUTH-001.4: credential expansion alone starts no helper and scrolls the actual panel into the form body', async () => {
    const begin = vi.fn();
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      server.use(
        http.get(`${API}/api/runtimes`, () =>
          HttpResponse.json([runtime({ credentialStatus: 'none' })]),
        ),
        http.post(`${API}/api/runtimes/codex/auth/begin`, () => {
          begin();
          return HttpResponse.json({});
        }),
      );
      launch();
      await pick();
      expect(begin).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('auth-gate-start'));
      const panel = document.getElementById('launch-auth-panel');
      expect(panel).not.toBeNull();
      await waitFor(() => {
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
      });
      expect(scroll.mock.contexts).toContain(panel);
      expect(within(panel!).getByRole('button', { name: '开始帐号登录' })).toBeInTheDocument();
      expect(begin).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});
