import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { AppFrameContainer } from '@/containers/workbench/AppFrameContainer';
import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { useAppStore } from '@/stores';
import { API, project, sandbox } from './support/fixtures';
import { mount } from './support/mount';
import { server } from './support/server';
import type { AttachArgs } from '@/hooks/terminal/useTerminalInstance';

const engine = vi.hoisted(() => ({
  attach: vi.fn((args: AttachArgs) => {
    args.onResize(80, 24);
    return Promise.resolve();
  }),
  fit: vi.fn(),
  dispose: vi.fn(),
  resync: vi.fn(),
  write: vi.fn(),
  clear: vi.fn(),
  getSelectionText: vi.fn((id: string) => `selection from ${id}`),
  setFontSize: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
// Only the xterm engine and external socket transport are scripted boundaries. Actual
// TerminalMount tool handlers, portal, tabs, restoration/lifecycle, menus and HTTP operations run.
vi.mock('@/hooks/terminal/useTerminalInstance', () => ({
  useTerminalInstance: () => engine,
  MIN_TERMINAL_FONT_SIZE: 10,
  MAX_TERMINAL_FONT_SIZE: 24,
}));
vi.mock('@/containers/terminal/TerminalContainer', async () => ({
  TerminalContainer: (await import('@/containers/terminal/TerminalMount')).default,
}));
vi.mock('socket.io-client', () => ({
  io: () => ({ on: () => undefined, emit: () => undefined, disconnect: () => undefined }),
}));

const clipboard = vi.fn(() => Promise.resolve());
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: clipboard },
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function runningTask() {
  server.use(
    http.get(`${API}/api/projects`, () => HttpResponse.json([project({ taskCount: 1 })])),
    http.get(`${API}/api/sandboxes`, () => HttpResponse.json([sandbox()])),
    http.get(`${API}/api/sandboxes/task-a`, () => HttpResponse.json(sandbox())),
  );
  useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'task-a' });
  return mount(
    <AppFrameContainer>
      <WorkbenchContainer />
    </AppFrameContainer>,
  );
}

describe('WB/TRM/SBX · running task terminal chrome', () => {
  it('the terminal tabs start the task content without a duplicate menu strip; the header still shows the locked image and stops the task', async () => {
    const stopped = vi.fn();
    let isStopped = false;
    const image = 'ghcr.io/acme/locked-agent:2026-10-05';
    server.use(
      http.get(`${API}/api/projects`, () => HttpResponse.json([project({ taskCount: 1 })])),
      http.get(`${API}/api/sandboxes`, () =>
        HttpResponse.json([sandbox({ image, status: isStopped ? 'stopped' : 'running' })]),
      ),
      http.get(`${API}/api/sandboxes/task-a`, () =>
        HttpResponse.json(sandbox({ image, status: isStopped ? 'stopped' : 'running' })),
      ),
      http.post(`${API}/api/sandboxes/task-a/stop`, () => {
        stopped();
        isStopped = true;
        return HttpResponse.json(sandbox({ image, status: 'stopped' }));
      }),
    );
    useAppStore.setState({ selectedProjectId: 'project-a', selectedSandboxId: 'task-a' });
    mount(
      <AppFrameContainer>
        <WorkbenchContainer />
      </AppFrameContainer>,
    );

    const tabs = await screen.findByRole('tablist', { name: '终端标签' });
    expect(within(tabs).getByRole('tab', { name: 'Agent' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('button', { name: '任务菜单' })).not.toBeInTheDocument();
    const bar = screen.getByTestId('terminal-tab-bar');
    expect(bar.parentElement?.firstElementChild).toBe(bar);
    expect(within(tabs).queryByRole('button', { name: '新终端' })).not.toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: '新终端' })).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: '当前终端工具' })).toBeInTheDocument();

    const header = screen.getByTestId('new-task-entry').closest('header');
    if (header === null) throw new Error('Shared task header is missing');
    const menu = within(header).getByRole('button', { name: '任务菜单' });
    fireEvent.keyDown(menu, { key: 'Enter' });
    await screen.findByText(`镜像：${image}`);
    fireEvent.click(screen.getByRole('menuitem', { name: '停止' }));
    await waitFor(() => {
      expect(stopped).toHaveBeenCalledOnce();
      expect(useAppStore.getState().sandboxStatuses['task-a']?.status).toBe('stopped');
    });
    await screen.findByText('任务已停止');
    expect(screen.queryByRole('tablist', { name: '终端标签' })).not.toBeInTheDocument();
  });
  it('shared tools operate only on the active session, preserve mounted sessions while switching, and recover after the host unmounts/remounts', async () => {
    const mounted = runningTask();
    await screen.findByRole('group', { name: '当前终端工具' });
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => {
      expect(clipboard).toHaveBeenLastCalledWith('selection from task-a:0');
    });
    fireEvent.keyDown(screen.getByTestId('terminal-tab-new'), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '终端' }));
    await screen.findByRole('tab', { name: '终端 1' });
    const shellId = useAppStore.getState().visibleTerminal?.sessionId;
    if (shellId === undefined || shellId === 'task-a:0')
      throw new Error('New terminal is not active');
    expect(screen.getAllByRole('group', { name: '当前终端工具' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '清屏' }));
    expect(engine.clear).toHaveBeenLastCalledWith(shellId);
    fireEvent.click(screen.getByRole('button', { name: '放大字号' }));
    expect(engine.setFontSize.mock.calls.at(-1)?.[0]).toBe(shellId);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => {
      expect(clipboard).toHaveBeenLastCalledWith(`selection from ${shellId}`);
    });
    const attachments = engine.attach.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Agent' }));
    expect(engine.attach).toHaveBeenCalledTimes(attachments);
    expect(engine.dispose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '清屏' }));
    expect(engine.clear).toHaveBeenLastCalledWith('task-a:0');
    fireEvent.click(screen.getByRole('button', { name: '缩小字号' }));
    expect(engine.setFontSize.mock.calls.at(-1)?.[0]).toBe('task-a:0');
    fireEvent.click(screen.getByRole('button', { name: '关闭 终端 1' }));
    expect(engine.dispose).toHaveBeenCalledWith(shellId);
    const previousTools = screen.getByRole('group', { name: '当前终端工具' });
    mounted.unmount();
    expect(engine.dispose).toHaveBeenCalledWith('task-a:0');
    expect(previousTools.isConnected).toBe(false);
    runningTask();
    await screen.findByRole('group', { name: '当前终端工具' });
    expect(screen.getAllByRole('group', { name: '当前终端工具' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => {
      expect(clipboard).toHaveBeenLastCalledWith('selection from task-a:0');
    });
  });
});
