// provider / runtime **两个开放注册表**的服务端驱动回归：后端都是开放 registry，前端不得写死闭集。
// 核心判据（①）：服务端响应里多一个第三方 provider（acme）→ UI 自动多一个选项，**前端零改动**；
// runtime 一侧同判据见文件末尾 `runtime 注册表驱动` 一节（14 §10 的那个 bug 的看守）。
// 另覆盖：默认选中来自服务端（provider 看 isDefault、runtime 看返回顺序）、spawnTty=false 禁用建沙箱并给原因、加载中/失败态。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { SandboxTerminalContainer } from '@/containers/SandboxTerminalContainer';
import { useAppStore } from '@/stores';
import type { SandboxResponse } from '@/services/api/sandbox.service';
import type { RuntimeDto } from '@/types/runtimeCredential';
import type { SandboxProviderCapabilities, SandboxProviderDto } from '@/types/sandbox';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * 后端注册表里**真实存在**的两个 runtime id（12 §3.4：替身的值不能凭空）。
 * 依据：`api/packages/modules/runtime/src/infrastructure/adapters/{codex,claude-code}/*.adapter.ts`
 * 里的 `readonly id`。前端生产代码从不持有这两个字面量——只有测试 fixture 才能出现。
 */
const REAL_RUNTIME_IDS = ['codex', 'claude-code'] as const;

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

/** GET /api/runtimes fixture（形状咬 RuntimeDto，缺必填字段编译期就红）。 */
function runtimeDto(overrides: Partial<RuntimeDto> & Pick<RuntimeDto, 'id'>): RuntimeDto {
  return {
    displayName: overrides.id,
    vendor: 'ACME',
    authMethods: ['api-key'],
    credentialStatus: 'none',
    credentials: [],
    ...overrides,
  };
}

/** GET /api/providers 返回扁平数组（默认档由数组项的 isDefault 标记，无顶层字段）。 */
function mockRegistry(providers: SandboxProviderDto[]): void {
  server.use(http.get(`${API_BASE}/api/providers`, () => HttpResponse.json(providers)));
}

/** GET /api/runtimes 返回扁平数组（**默认 = 第一项**，契约里没有 isDefault）。 */
function mockRuntimeRegistry(runtimes: RuntimeDto[]): void {
  server.use(http.get(`${API_BASE}/api/runtimes`, () => HttpResponse.json(runtimes)));
}

type RadioGroup = 'sandbox-runtime' | 'sandbox-provider';

/** 只数某一组单选框（页面上现在有 runtime 与 provider 两组）。 */
function radiosNamed(group: RadioGroup): HTMLElement[] {
  return screen.queryAllByRole('radio').filter((el) => el.getAttribute('name') === group);
}

/** 某一组里被选中的那些（testing-library 的 role 查询自带 checked 过滤）。 */
function checkedRadiosNamed(group: RadioGroup): HTMLElement[] {
  return screen
    .queryAllByRole('radio', { checked: true })
    .filter((el) => el.getAttribute('name') === group);
}

/**
 * 选一个 runtime。**必选、不预选**（04 §8：平台没有「默认 runtime」概念）⇒ 凡是要真的建沙箱、
 * 或要断言 [发起任务并打开终端] 可用的用例，都得先走这一步 —— 这一步本身就是回归对象：
 * 它存在，说明前端没有偷偷替用户挑一个 agent CLI。
 *
 * 幂等（已选过就直接返回），好让它能统一插进既有用例而不打乱它们自己的选择。
 */
async function chooseRuntime(id?: string): Promise<void> {
  const radios = await waitFor(() => {
    const found = radiosNamed('sandbox-runtime');
    if (found.length === 0) throw new Error('runtime 选项还没出现');
    return found;
  });
  if (id === undefined && checkedRadiosNamed('sandbox-runtime').length > 0) return;
  const target =
    id === undefined ? radios[0] : radios.find((el) => el.getAttribute('value') === id);
  if (target === undefined) throw new Error(`注册表里没有 runtime '${String(id)}'`);
  fireEvent.click(target);
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
    expect(radiosNamed('sandbox-provider')).toHaveLength(3);

    // 可选中，并被写进建沙箱请求体（证明不是"只显示不可用"）。
    let sentProvider: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        sentProvider =
          typeof body === 'object' && body !== null && 'provider' in body ? body.provider : null;
        return HttpResponse.json(sandboxDto({ id: 'sb-1', provider: 'acme' }), { status: 201 });
      }),
    );
    fireEvent.click(acme);
    await chooseRuntime();
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
    await chooseRuntime();
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

    // 改选支持终端的档位 → 恢复可用（runtime 必选，先选上，否则禁用原因换成了"还没选 runtime"）。
    await chooseRuntime();
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
    expect(radiosNamed('sandbox-provider')).toHaveLength(0);
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
    await chooseRuntime();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
  });
});

// ————————————————————————————————————————————————————————————————
// S5：Task 发起入口（initialPrompt）+ 默认任务名 + 新错误呈现
// ————————————————————————————————————————————————————————————————

/**
 * SandboxResponseDto fixture。
 *
 * ⚠️ **显式返回类型是刻意的**（12 §3.4 落地要求 1）：返回裸对象字面量时，DTO 加一个必填字段
 * （`provider` 就是这么加进来的）只会让**生产代码**报红，fixture 静默少一个字段照样全绿。
 * ⚠️ `runtime` 取后端注册表里真实存在的键，不是随手编一个"看起来像"的（12 §3.4 落地要求 2）。
 */
function sandboxDto(overrides: Partial<SandboxResponse> & { id?: string } = {}): SandboxResponse {
  return {
    id: 'sb-1',
    projectId: 'proj-1',
    runtime: REAL_RUNTIME_IDS[0],
    provider: 'aio',
    name: '默认任务名',
    status: 'pending',
    headless: false,
    timeoutMinutes: 120,
    idleTimeoutSec: 1800,
    waitingInput: false,
    version: 1,
    ...overrides,
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

    await chooseRuntime();
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

    await chooseRuntime();
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
    await chooseRuntime();
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
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    // 进度卡标题用的是后端的 name。
    expect(await screen.findByText('正在启动：后端派生的任务名')).toBeInTheDocument();
  });
});

describe('SandboxTerminalContainer · 新错误呈现（P22 §1 / 04 §5）', () => {
  /**
   * 门口拒绝（后端标 `sideEffectFree: true`）→ 就地提示改配置，**不进失败可重试路径**。
   *
   * 三条各一例，状态码刻意不同（409 / 400 / 400）：这是"判据读字段、不读 HTTP 码"在
   * **容器级**的看守。旧判据 `httpStatus === 409 && code === 'UNSUPPORTED_CAPABILITY'`
   * 只认得第一条 —— 把判据改回去，后两条当场红。
   */
  it.each([
    {
      label: 'UNSUPPORTED_CAPABILITY（能力静态校验）',
      status: 409,
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'provider aio 不支持 snapshot',
    },
    {
      label: 'UNKNOWN_PROVIDER（未知运行档位）',
      status: 400,
      code: 'UNKNOWN_PROVIDER',
      message: "unknown provider 'nope'",
    },
    {
      label: 'UNKNOWN_RUNTIME（未知 runtime）',
      status: 400,
      code: 'UNKNOWN_RUNTIME',
      message: "unknown runtime 'shell'",
    },
  ])(
    '$label（零副作用，HTTP $status）→ 就地提示改配置，**不进失败可重试路径**',
    async ({ status, code, message }) => {
      mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
      server.use(
        http.post(`${API_BASE}/api/sandboxes`, () =>
          HttpResponse.json({ code, message, retryable: false, sideEffectFree: true }, { status }),
        ),
      );
      renderContainer();

      await screen.findByRole('radio', { name: /aio/ }); // 等 provider 加载完，按钮才可点
      await chooseRuntime();
      fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

      // 就地提示：仍停在新建面板（拿不到 sandbox id，列表也不该出现 failed 记录）。
      expect(await screen.findByTestId('create-rejection')).toBeInTheDocument();
      expect(screen.queryByTestId('create-failure')).not.toBeInTheDocument();
      expect(screen.getByText(/未创建任何任务/)).toBeInTheDocument();
      // 后端那句具体的话要透出来，而不是被一句模板盖掉。
      expect(
        screen.getByText(new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeInTheDocument();
      // 不得渲染"重新创建/重试"这类已落库失败才有的入口。
      expect(screen.queryByTestId('sandbox-outcome')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /重新创建/ })).not.toBeInTheDocument();
    },
  );

  /**
   * ⚠️ **后端漏标 ⇒ 保守读法**：形状与上面第一条**完全一致**（409 + 能力码），
   * 唯一差别是信封里没有 `sideEffectFree`。此时前端**不知道**有没有落库，
   * 只能按"可能有副作用"走 `failure` 分支 —— 而不是拍胸脯说"什么都没创建"。
   *
   * 这条与上面那组互为反向锚点：把缺席当成零副作用（`!== false`）会让这条红。
   */
  it('信封**没有** sideEffectFree（后端漏标）→ 保守走 failure 分支，绝不说"未创建任何任务"', async () => {
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

    await screen.findByRole('radio', { name: /aio/ });
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    // 退化成"今天的样子"：走 `failure` 那条路（红字），而不是 `rejection` 的就地提示。
    //
    // ⚠️ 判据是**走了哪条分支**这个结构事实，不是某句文案。早先这里断言的是兜底标题
    // 「任务启动失败」——那其实是拿"这条码碰巧没收录文案"当"走了 failure 分支"的替身，
    // 等它有了正式文案，替身立刻失效，而链路一点没变。
    //
    // 另注：POST 期被拒**拿不到 sandbox id**，因此这条路上本就不存在"失败卡"
    //（`sandbox-outcome` 是给已落库、provision 期才失败的沙箱用的）。两条分支都留在
    // 新建面板上，区别只在于**敢不敢承诺"什么都没创建"**。
    expect(await screen.findByTestId('create-failure')).toBeInTheDocument();
    expect(screen.queryByTestId('create-rejection')).not.toBeInTheDocument();
    expect(screen.queryByText(/未创建任何任务/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('sandbox-outcome')).not.toBeInTheDocument();
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
    await chooseRuntime();
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
    await chooseRuntime();
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
    await chooseRuntime();
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

// ————————————————————————————————————————————————————————————————
// runtime 注册表驱动（14 §10 的那个 bug 的看守）
//
// 起因：这里曾有 `const S2_DEFAULT_RUNTIME = 'shell'`，而后端注册表里只有 codex / claude-code
// ⇒ 从这个入口建的沙箱**必然**死在 `unknown runtime 'shell'`，而两仓 CI 全绿。
// 类型拦不住（契约是开放 `string`，且**不该**收窄），所以防线只能是"注册表驱动 + 前端零字面量"。
// 下面每一条都是冲着"有人又把某个 runtime 字面量写回前端"去的。
// ————————————————————————————————————————————————————————————————
describe('SandboxTerminalContainer · runtime 注册表驱动（14 §10）', () => {
  it('① 建沙箱请求里的 runtime 取自 GET /api/runtimes 里**用户选中**的那一项，而不是前端常量', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([
      runtimeDto({ id: 'codex', displayName: 'Codex', vendor: 'OpenAI' }),
      runtimeDto({ id: 'claude-code', displayName: 'Claude Code', vendor: 'Anthropic' }),
    ]);
    let sentRuntime: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        sentRuntime =
          typeof body === 'object' && body !== null && 'runtime' in body ? body.runtime : null;
        return HttpResponse.json(sandboxDto(), { status: 201 });
      }),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /^codex/ });
    await chooseRuntime('codex');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    await waitFor(() => {
      expect(sentRuntime).toBe('codex');
    });
    // 这一条才是真正的判据：发出去的 runtime 必须在注册表里，'shell' 之类的凭空值一律不合格。
    expect(REAL_RUNTIME_IDS).toContain(sentRuntime);
  });

  it('② 第三方注册的 runtime 自动出现在选项里，并能被选中提交（前端零改动）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    // 前端从未在任何常量/联合类型里写过 'acme-agent'——它只存在于服务端响应里。
    mockRuntimeRegistry([
      runtimeDto({ id: 'codex', displayName: 'Codex', vendor: 'OpenAI' }),
      runtimeDto({ id: 'acme-agent', displayName: 'Acme Agent', vendor: 'ACME' }),
    ]);
    let sentRuntime: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        sentRuntime =
          typeof body === 'object' && body !== null && 'runtime' in body ? body.runtime : null;
        return HttpResponse.json(sandboxDto({ runtime: 'acme-agent' }), { status: 201 });
      }),
    );
    renderContainer();

    const acme = await screen.findByRole('radio', { name: /acme-agent/ });
    expect(radiosNamed('sandbox-runtime')).toHaveLength(2);

    fireEvent.click(acme);
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sentRuntime).toBe('acme-agent');
    });
  });

  /**
   * ③ **必选、不预选**（04 §8：平台没有「默认 runtime」概念，`CreateSandbox.runtime` 必填、
   * 后端零回退）。
   *
   * 上一版这条断言的是"默认选中 = 注册表返回顺序的第一项"，并把它称作"服务端默认"。
   * 那不是服务端表达的默认，是**前端**把数组顺序当成了语义：registry 的顺序只是注册顺序，
   * 拿它替用户挑一个 agent CLI（codex 与 claude-code 是完全不同的东西），用户可能连列表
   * 都没看过；第三方模块换个加载次序，"默认"就悄悄换了人。
   *
   * 与 provider 一侧的对照就是分界线：那边有 `isDefault`（服务端**明说**），跟着走是对的。
   */
  it('③ runtime 不预选：一个都不选中，按钮禁着并就地说明"必须显式指定"', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([
      runtimeDto({ id: 'claude-code', displayName: 'Claude Code', vendor: 'Anthropic' }),
      runtimeDto({ id: 'codex', displayName: 'Codex', vendor: 'OpenAI' }),
    ]);
    renderContainer();

    // 列表出来了，但**一个都没选中** —— 前端不替用户做这个必填选择。
    await waitFor(() => {
      expect(radiosNamed('sandbox-runtime')).toHaveLength(2);
    });
    expect(checkedRadiosNamed('sandbox-runtime')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    // 「还没选」≠「没得选」：两句提示必须分开，不能复用"后端未注册任何 runtime"。
    expect(screen.getByText(/平台没有默认运行时，必须显式指定/)).toBeInTheDocument();
    expect(screen.queryByText(/后端未注册任何 runtime/)).not.toBeInTheDocument();

    // 选了之后才可用，而且提示消失。
    await chooseRuntime('codex');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
    expect(screen.queryByText(/平台没有默认运行时/)).not.toBeInTheDocument();
    // 对照 provider 一侧：那边**有** isDefault，仍然照服务端的默认档预选（本条不改那半边）。
    expect(screen.getByRole('radio', { name: /^aio/ })).toBeChecked();
  });

  it('④ 后端一个 runtime 都没注册 ⇒ 禁用创建并说明原因（绝不退回某个字面量默认值）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([]);
    let posted = false;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () => {
        posted = true;
        return HttpResponse.json(sandboxDto(), { status: 201 });
      }),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /aio/ });
    const createBtn = screen.getByRole('button', { name: '发起任务并打开终端' });
    await waitFor(() => {
      expect(createBtn).toBeDisabled();
    });
    expect(screen.getByText(/后端未注册任何 runtime/)).toBeInTheDocument();
    expect(radiosNamed('sandbox-runtime')).toHaveLength(0);

    // 旁路触发（键盘/程序化点击）同样不许发请求——空 runtime 发出去就是一次注定失败的创建。
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(screen.getByText(/后端未注册任何 runtime/)).toBeInTheDocument();
    });
    expect(posted).toBe(false);
  });

  it('⑤ runtime 列表加载中：出骨架且禁用创建（不静默拿一个默认值顶上）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    server.use(
      http.get(`${API_BASE}/api/runtimes`, async () => {
        await new Promise(() => undefined); // 永挂起
        return HttpResponse.json([]);
      }),
    );
    renderContainer();

    expect(await screen.findByTestId('runtimes-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
  });

  it('⑥ runtime 列表失败：给可重试提示；重试成功后列表出现且创建恢复可用', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    let attempt = 0;
    server.use(
      http.get(`${API_BASE}/api/runtimes`, () => {
        attempt += 1;
        if (attempt === 1) {
          return HttpResponse.json(
            { code: 'INTERNAL', message: 'registry 不可用', retryable: true },
            { status: 500 },
          );
        }
        return HttpResponse.json([runtimeDto({ id: 'codex', displayName: 'Codex' })]);
      }),
    );
    renderContainer();

    expect(await screen.findByText(/运行时加载失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重试加载运行时' }));
    expect(await screen.findByRole('radio', { name: /^codex/ })).toBeInTheDocument();
    await chooseRuntime();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
  });

  it('⑦ runtime 与 provider 两组单选互不干扰（各自独立的注册表）', async () => {
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: true },
      { name: 'boxlite', capabilities: caps(), isDefault: false },
    ]);
    mockRuntimeRegistry([
      runtimeDto({ id: 'codex', displayName: 'Codex' }),
      runtimeDto({ id: 'claude-code', displayName: 'Claude Code' }),
    ]);
    let sentRuntime: unknown;
    let sentProvider: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        const body: unknown = await request.json();
        const read = (key: string): unknown =>
          typeof body === 'object' && body !== null && key in body
            ? Reflect.get(body, key)
            : undefined;
        sentRuntime = read('runtime');
        sentProvider = read('provider');
        return HttpResponse.json(sandboxDto(), { status: 201 });
      }),
    );
    renderContainer();

    fireEvent.click(await screen.findByRole('radio', { name: /claude-code/ }));
    fireEvent.click(screen.getByRole('radio', { name: /boxlite/ }));

    // 两组各自恰好选中一个（勾一组不会把另一组也带过去）。
    expect(checkedRadiosNamed('sandbox-runtime')).toHaveLength(1);
    expect(checkedRadiosNamed('sandbox-provider')).toHaveLength(1);

    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sentRuntime).toBe('claude-code');
    });
    expect(sentProvider).toBe('boxlite');
  });

  it('⑧ 建出来的沙箱把它自己的 runtime 交给无头任务面板（不是前端再挑一个）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps({ headlessTask: true }), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'claude-code', displayName: 'Claude Code' })]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        // 后端回的 runtime 才是权威（可能与请求不同：后端有归一化的余地）。
        HttpResponse.json(sandboxDto({ id: 'sb-hl', runtime: 'claude-code', status: 'running' }), {
          status: 201,
        }),
      ),
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () => HttpResponse.json([])),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /claude-code/ });
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    // 无头面板挂起来了 = 容器确实拿到了**沙箱自己的** runtime（它为 undefined 时整块不渲染）。
    // 面板里的 POST 路径 `:rt` 就取这个值，所以这一步同时证明了无头链路不会再拿到一个凭空的 runtime。
    expect(await screen.findByLabelText('任务指令')).toBeInTheDocument();
  });
});
