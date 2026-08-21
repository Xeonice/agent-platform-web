// provider 档位服务端驱动（扩展性回归）：后端是开放 registry，前端不得再写死闭集。
// 核心判据（①）：服务端响应里多一个第三方 provider（acme）→ UI 自动多一个选项，**前端零改动**。
// 另覆盖：默认选中来自服务端 isDefault 那项（含无 isDefault 的兜底）、spawnTty=false 禁用建沙箱并给原因、加载中/失败态。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { SandboxTerminalContainer } from '@/containers/SandboxTerminalContainer';
import type { SandboxProviderCapabilities, SandboxProviderDto } from '@/types/sandbox';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 测试 fixture（闭集只存在于测试里，生产代码不再持有 provider 名单）。 */
function caps(overrides: Partial<SandboxProviderCapabilities> = {}): SandboxProviderCapabilities {
  return {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: true,
    snapshot: true,
    watchEvents: true,
    ...overrides,
  };
}

/** GET /api/providers 返回扁平数组（默认档由数组项的 isDefault 标记，无顶层字段）。 */
function mockRegistry(providers: SandboxProviderDto[]): void {
  server.use(http.get(`${API_BASE}/api/providers`, () => HttpResponse.json(providers)));
}

function renderContainer(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(<SandboxTerminalContainer wsBaseUrl="ws://localhost:3001" projectId="proj-1" />, {
    wrapper: Wrapper,
  });
}

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
});

describe('SandboxTerminalContainer · provider 档位服务端驱动', () => {
  it('① 后端 registry 新增第三方 provider（acme）→ UI 自动出现该选项（前端零改动）', async () => {
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: true },
      { name: 'boxlite', capabilities: caps({ snapshot: false }), isDefault: false },
      // 第三方注册进 registry 的档位：前端从未在任何常量/联合类型里写过 'acme'。
      { name: 'acme', capabilities: caps({ volumeMount: false }), isDefault: false },
    ]);
    renderContainer();

    const acme = await screen.findByRole('radio', { name: /acme/ });
    expect(acme).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);

    // 可选中，并被写进建沙箱请求体（证明不是"只显示不可用"）。
    let sentProvider: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        sentProvider =
          typeof body === 'object' && body !== null && 'provider' in body ? body.provider : null;
        return HttpResponse.json(
          {
            id: 'sb-1',
            projectId: 'proj-1',
            runtime: 'shell',
            status: 'pending',
            headless: false,
            timeoutMinutes: 120,
            idleTimeoutSec: 1800,
            waitingInput: false,
            version: 1,
          },
          { status: 201 },
        );
      }),
    );
    fireEvent.click(acme);
    fireEvent.click(screen.getByRole('button', { name: '新建沙箱并打开终端' }));
    await waitFor(() => {
      expect(sentProvider).toBe('acme');
    });
  });

  it('② 默认选中来自服务端 isDefault 那项（前端无默认常量）', async () => {
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: false },
      // 默认档由服务端在数组项上标记（注意：不是数组第一项，排除"取首项"的假绿）。
      { name: 'acme', capabilities: caps(), isDefault: true },
    ]);
    renderContainer();

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /acme/ })).toBeChecked();
    });
    expect(screen.getByRole('radio', { name: /aio/ })).not.toBeChecked();
  });

  it('②b 无任何 isDefault（契约异常）→ 兜底选中第一项，核心链路仍可用', async () => {
    mockRegistry([
      { name: 'first', capabilities: caps(), isDefault: false },
      { name: 'second', capabilities: caps(), isDefault: false },
    ]);
    renderContainer();

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /first/ })).toBeChecked();
    });
    expect(screen.getByRole('button', { name: '新建沙箱并打开终端' })).toBeEnabled();
  });

  it('③ 所选 provider spawnTty=false → 禁用建沙箱并给出原因文案', async () => {
    mockRegistry([
      { name: 'headless-only', capabilities: caps({ spawnTty: false }), isDefault: true },
      { name: 'aio', capabilities: caps(), isDefault: false },
    ]);
    renderContainer();

    const createBtn = await screen.findByRole('button', { name: '新建沙箱并打开终端' });
    await waitFor(() => {
      expect(createBtn).toBeDisabled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/不支持终端（spawnTty=false）/);
    // 列表里也给出能力注记（capabilities 驱动的显隐口子）。
    expect(screen.getByRole('radio', { name: /headless-only — 不支持终端/ })).toBeInTheDocument();

    // 改选支持终端的档位 → 恢复可用。
    fireEvent.click(screen.getByRole('radio', { name: /^aio/ }));
    await waitFor(() => {
      expect(createBtn).toBeEnabled();
    });
  });

  it('④ 加载中：出骨架且禁用创建（不静默展示空列表）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, async () => {
        await new Promise(() => undefined); // 永挂起，保持 pending 态以观测骨架
        return HttpResponse.json([]);
      }),
    );
    renderContainer();

    expect(await screen.findByTestId('providers-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建沙箱并打开终端' })).toBeDisabled();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('⑤ 失败：给可重试提示；重试成功后列表出现', async () => {
    let attempt = 0;
    server.use(
      http.get(`${API_BASE}/api/providers`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            { code: 'INTERNAL', message: 'registry 不可用', retryable: true },
            { status: 500 },
          );
        }
        return HttpResponse.json([{ name: 'aio', capabilities: caps(), isDefault: true }]);
      }),
    );
    renderContainer();

    expect(await screen.findByText(/运行档位加载失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建沙箱并打开终端' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重试加载运行档位' }));
    expect(await screen.findByRole('radio', { name: /aio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建沙箱并打开终端' })).toBeEnabled();
  });
});
