// provider 档位服务端驱动（扩展性回归）：后端是开放 registry，前端不得再写死闭集。
// 核心判据（①）：服务端响应里多一个第三方 provider（acme）→ UI 自动多一个选项，**前端零改动**。
// 另覆盖：默认选中来自服务端 isDefault 那项（含无 isDefault 的兜底）、spawnTty=false 禁用建沙箱并给原因、加载中/失败态。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { SandboxTerminalContainer } from '@/containers/SandboxTerminalContainer';
import { useAppStore } from '@/stores';
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
    headlessTask: false,
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
  // 选中位是 persist 白名单字段，跨用例会残留 → 每例复位，否则下一例一挂载就去"恢复"上一例的沙箱。
  useAppStore.getState().setSelectedSandboxId(null);
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
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
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
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
  });

  it('③ 所选 provider spawnTty=false → 禁用建沙箱并给出原因文案', async () => {
    mockRegistry([
      { name: 'headless-only', capabilities: caps({ spawnTty: false }), isDefault: true },
      { name: 'aio', capabilities: caps(), isDefault: false },
    ]);
    renderContainer();

    const createBtn = await screen.findByRole('button', { name: '发起任务并打开终端' });
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
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重试加载运行档位' }));
    expect(await screen.findByRole('radio', { name: /aio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
  });
});

// ————————————————————————————————————————————————————————————————
// S5：Task 发起入口（initialPrompt）+ 默认任务名 + 新错误呈现
// ————————————————————————————————————————————————————————————————

/** SandboxResponseDto fixture：`name` 现为 required；`failureCode`/`failureMessage` 仅 failed 时出现。 */
function sandboxDto(
  overrides: {
    id?: string;
    name?: string;
    status?: string;
    failureCode?: string;
    failureMessage?: string;
  } = {},
) {
  return {
    id: overrides.id ?? 'sb-1',
    projectId: 'proj-1',
    runtime: 'shell',
    name: overrides.name ?? '默认任务名',
    status: overrides.status ?? 'pending',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: false,
    version: 1,
    ...(overrides.failureCode === undefined ? {} : { failureCode: overrides.failureCode }),
    ...(overrides.failureMessage === undefined ? {} : { failureMessage: overrides.failureMessage }),
  };
}

describe('SandboxTerminalContainer · initialPrompt 发起入口（S5 T-1/T-2）', () => {
  const PROMPT = '分析 /srv/internal-repo 的架构并输出摘要';

  it('填了指令 → 随 POST /api/sandboxes 提交；提交即清空输入框', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    let sentPrompt: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        sentPrompt =
          typeof body === 'object' && body !== null && 'initialPrompt' in body
            ? body.initialPrompt
            : null;
        return HttpResponse.json(sandboxDto({ name: '分析 /srv/internal-repo 的架…' }), {
          status: 201,
        });
      }),
    );
    renderContainer();

    const textarea = await screen.findByLabelText('任务指令（可选）');
    fireEvent.change(textarea, { target: { value: PROMPT } });
    expect(textarea).toHaveValue(PROMPT);

    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sentPrompt).toBe(PROMPT);
    });
  });

  it('安全红线：指令绝不进 store / localStorage（15 §3.5），只在容器局部 state', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(sandboxDto({ name: '分析 /srv/internal-repo 的架…' }), {
          status: 201,
        }),
      ),
    );
    renderContainer();

    const textarea = await screen.findByLabelText('任务指令（可选）');
    fireEvent.change(textarea, { target: { value: PROMPT } });

    // 输入期间：全局 store 里就不该出现这段文本（不是"提交后才清"）。
    expect(JSON.stringify(useAppStore.getState())).not.toContain('internal-repo');

    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '发起任务并打开终端' })).not.toBeInTheDocument();
    });

    expect(JSON.stringify(useAppStore.getState())).not.toContain('internal-repo');
    expect(JSON.stringify(globalThis.localStorage)).not.toContain('internal-repo');
    expect(globalThis.localStorage.getItem('agent-platform-ui') ?? '').not.toContain(
      'internal-repo',
    );
  });

  it('空指令 → 请求体不带 initialPrompt 字段（不发空串）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    let hasField = true;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        hasField = typeof body === 'object' && body !== null && 'initialPrompt' in body;
        return HttpResponse.json(sandboxDto(), { status: 201 });
      }),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(hasField).toBe(false);
    });
  });

  it('超 8000 上限 → 就地红字计数 + 禁用发起（P21-2 §6）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    renderContainer();

    const textarea = await screen.findByLabelText('任务指令（可选）');
    fireEvent.change(textarea, { target: { value: 'x'.repeat(8001) } });

    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('8001/8000');
  });

  it('默认任务名直接用后端返回的 name（前端不自己从 prompt 派生一份，T-1）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(sandboxDto({ name: '后端派生的任务名' }), { status: 201 }),
      ),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    // 进度卡标题用的是后端的 name。
    expect(await screen.findByText('正在启动：后端派生的任务名')).toBeInTheDocument();
  });
});

describe('SandboxTerminalContainer · 新错误呈现（P22 §1 / 04 §5）', () => {
  it('409 UNSUPPORTED_CAPABILITY（零副作用）→ 就地提示改选，**不进失败可重试路径**', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(
          {
            code: 'UNSUPPORTED_CAPABILITY',
            message: 'provider aio 不支持 snapshot',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    // 就地提示：仍停在新建面板（拿不到 sandbox id，列表也不该出现 failed 记录）。
    expect(await screen.findByText(/未创建任何任务/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeInTheDocument();
    // 不得渲染"重新创建/重试"这类已落库失败才有的入口。
    expect(screen.queryByTestId('sandbox-outcome')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重新创建/ })).not.toBeInTheDocument();
  });

  it('创建期一般失败 → 人话 + 建议（不裸抛错误码）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(
          { code: 'IMAGE_PULL_FAILED', message: 'pull timeout', retryable: true },
          { status: 500 },
        ),
      ),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    expect(await screen.findByText(/镜像拉取失败/)).toBeInTheDocument();
  });

  it('IMAGE_CONTRACT_VIOLATION（provision 期失败）→ 失败卡不给 [重试]，只给换镜像', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(sandboxDto({ id: 'sb-tmux', status: 'starting' }), { status: 201 }),
      ),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await screen.findByText(/正在启动/);

    // 通道①（即时）：provision 期实测缺 tmux → WS status_changed 带 errorCode 下来。
    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'sandbox.status_changed',
        sandboxId: 'sb-tmux',
        status: 'failed',
        errorCode: 'IMAGE_CONTRACT_VIOLATION',
      });
    });

    expect(await screen.findByText(/缺少 tmux/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换一张含 tmux 的镜像' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
  });

  it('装 CLI 进度（12 分钟那条）→ 进度卡「启动实例」格下出现子文案', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(sandboxDto({ id: 'sb-install', status: 'starting' }), {
          status: 201,
        }),
      ),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await screen.findByText(/正在启动/);

    act(() => {
      useAppStore.getState().applySandboxEvent({
        event: 'runtime.install_progress',
        sandboxId: 'sb-install',
        runtime: 'claude-code',
        status: 'installing',
      });
    });

    const note = await screen.findByTestId('phase-note-instance');
    expect(note).toHaveTextContent('正在安装 claude-code');
    expect(note).toHaveTextContent('不是卡死');
  });
});

describe('SandboxTerminalContainer · 失败原因的刷新恢复（通道②：REST DTO）', () => {
  it('刷新后没有任何 WS 事件，仍能从 GET /api/sandboxes/:id 拿回任务名与失败原因', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    // 模拟"刷新后"：persist 白名单里的 selectedSandboxId 还在，内存里的 store 状态全没了。
    useAppStore.getState().setSelectedSandboxId('sb-refresh');
    useAppStore.getState().clearSandboxStatus('sb-refresh');

    let detailHits = 0;
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id`, ({ params }) => {
        detailHits += 1;
        return HttpResponse.json(
          sandboxDto({
            id: String(params['id']),
            name: '分析这个仓库的架构并输…',
            status: 'failed',
            failureCode: 'IMAGE_CONTRACT_VIOLATION',
            failureMessage: 'command -v tmux exited 1',
          }),
        );
      }),
    );
    renderContainer();

    // 人话按**码**出（P22 §1），且不给 [重试]。
    expect(await screen.findByText(/缺少 tmux/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换一张含 tmux 的镜像' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument();
    // 任务名同样是刷新后从 DTO 拿回来的（前端不派生）。
    expect(screen.getByText('任务：分析这个仓库的架构并输…')).toBeInTheDocument();
    // failureMessage 只作排障小字原样展示。
    expect(screen.getByText(/command -v tmux exited 1/)).toBeInTheDocument();
    expect(detailHits).toBe(1);
  });

  it('INSTALL_FAILED 同样可刷新恢复（两个来源不重复渲染：页面上只有一份失败呈现）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    useAppStore.getState().setSelectedSandboxId('sb-install-refresh');
    useAppStore.getState().clearSandboxStatus('sb-install-refresh');
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id`, ({ params }) =>
        HttpResponse.json(
          sandboxDto({
            id: String(params['id']),
            status: 'failed',
            failureCode: 'INSTALL_FAILED',
            failureMessage: 'npm exited 1',
          }),
        ),
      ),
    );
    renderContainer();

    expect(await screen.findByText(/运行时 CLI 安装失败/)).toBeInTheDocument();
    // 只有一张失败卡（install_progress 不是第二条失败通道，不会再渲染一份）。
    expect(screen.getAllByTestId('sandbox-outcome')).toHaveLength(1);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('该沙箱已被销毁（404）→ 清掉持久化选中并回到新建入口', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    useAppStore.getState().setSelectedSandboxId('sb-gone');
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: 'sandbox not found', retryable: false },
          { status: 404 },
        ),
      ),
    );
    renderContainer();

    expect(await screen.findByRole('button', { name: '发起任务并打开终端' })).toBeInTheDocument();
    await waitFor(() => {
      expect(useAppStore.getState().selectedSandboxId).toBeNull();
    });
  });
});
