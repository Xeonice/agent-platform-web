// provider / runtime **两个开放注册表**的服务端驱动回归：后端都是开放 registry，前端不得写死闭集。
// 核心判据（①）：服务端响应里多一个第三方 provider（acme）→ UI 自动多一个选项，**前端零改动**；
// runtime 一侧同判据见文件末尾 `runtime 注册表驱动` 一节（14 §10 的那个 bug 的看守）。
// 另覆盖：默认选中来自服务端（provider 看 isDefault、runtime 看返回顺序）、spawnTty=false 禁用建沙箱并给原因、加载中/失败态。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';

// next/navigation：本容器用 router.push 把鉴权闸门的 [管理所有凭证] 送去凭证页。
// 用 vi.hoisted 持有 spy,用例里能断言"点了确实跳"。
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push }),
}));
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
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

/**
 * GET /api/runtimes fixture（形状咬 RuntimeDto，缺必填字段编译期就红）。
 *
 * ⚠️ `credentialStatus` 默认取 **active**——即"这个 runtime 已经配好凭证"的常态。
 * 此前默认是 `'none'`,那时前端根本不读这一位,填什么都无所谓;现在它承重了
 * (P20 §5.1 拦截层按它三分支判定),默认就必须是**发起链路走得通**的那个值,
 * 否则这份替身会让每一条无关用例都被闸门拦住。未配置/已过期由闸门用例显式覆盖。
 */
function runtimeDto(overrides: Partial<RuntimeDto> & Pick<RuntimeDto, 'id'>): RuntimeDto {
  return {
    displayName: overrides.id,
    vendor: 'ACME',
    authMethods: ['api-key'],
    credentialStatus: 'active',
    maskedIdentifier: 'a***@example.com',
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

/**
 * 等「宿主档位」就绪。
 *
 * ⚠️ 这些用例过去写的是 `await findByRole('radio', { name: /aio/ })` —— 拿**档位单选出现**
 * 当同步点。那组单选已经删了（档位由后端按宿主平台选定，用户不该关心），所以改等
 * **创建按钮真的可点**：它同时覆盖 providers 与 runtimes 两个查询，比等某个具体控件更贴近
 * 「这一步真的能做了」。
 */
async function waitForCreatable(): Promise<void> {
  await chooseRuntime();
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
  });
}

interface RenderOptions {
  /** 项目来源：`'empty'` ⇒ 不渲染分支选择器、也不发 /branches 请求。默认按 git 项目走。 */
  sourceType?: 'git' | 'empty';
  /**
   * 是否直接把「新建任务」弹层开着。**默认开**——绝大多数既有用例断言的是弹层里那张表单。
   *
   * ⚠️ 这一行本身就是本轮改造的证据：面板此前是 `sandboxId===null` 时的**兜底渲染**
   *（不打开它、它自己就在），现在必须**被打开**（工作台 [+ 新任务] → `currentModal='newTask'`）。
   */
  openModal?: boolean;
}

function renderContainer({ sourceType = 'git', openModal = true }: RenderOptions = {}): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  if (openModal) useAppStore.getState().setCurrentModal('newTask');
  render(
    <SandboxTerminalContainer
      wsBaseUrl="ws://localhost:3001"
      projectId="proj-1"
      projectName="ProjectA"
      projectSourceType={sourceType}
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  cleanup();
  // 选中位是 persist 白名单字段，跨用例会残留 → 每例复位，否则下一例一挂载就去"恢复"上一例的沙箱。
  useAppStore.getState().setSelectedSandboxId(null);
  // 弹层开关是瞬时态，但跨用例仍在同一个 store 上 → 每例复位。
  useAppStore.getState().setCurrentModal(null);
  // 分支列表：默认给一份（用例可 server.use 覆盖）。读的是本地引用，不触网。
  server.use(
    http.get(`${API_BASE}/api/projects/:id/branches`, () =>
      HttpResponse.json(['main', 'develop', 'feature/x']),
    ),
  );
});
afterEach(() => {
  cleanup();
});

/**
 * ★ 档位（provider）**由后端按宿主平台选定，前端不给选**。
 *
 * ── 为什么删掉那组单选 ────────────────────────────────────────────────────────
 * `AioSandboxProvider extends DockerContainerBackend` —— aio 就是 docker 容器；
 * boxlite 是微 VM（macOS 上走 Apple Hypervisor.framework，与 docker 无关）。
 * **哪个跑得起来是宿主平台的事实，不是用户的偏好**：Mac 上选 aio 只会撞上「没有 Docker」，
 * 而报出来的错还是「镜像尚未注册」，指不到真正的原因。
 *
 * 本组测试因此从「用户能不能选中/切换」改成三件事：
 *   ① 前端**只读** `isDefault`，且**不把 provider 写进请求体**（"选哪个"只有后端知道）；
 *   ② 能力位（spawnTty）仍然驱动 UI，只是数据源变成"后端选定的那一个"；
 *   ③ 未就绪（加载中/失败/空 registry）仍然要**说话**——按钮禁着却不给理由最难查。
 */
describe('SandboxTerminalContainer · 档位由宿主平台选定（前端不选）', () => {
  it('⭐ 请求体里**不带** provider —— 「选哪个」只能有一个知情者', async () => {
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: false },
      { name: 'boxlite', capabilities: caps({ snapshot: false }), isDefault: true },
    ]);
    renderContainer();

    let body: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(sandboxDto({ id: 'sb-1', provider: 'boxlite' }), { status: 201 });
      }),
    );
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(body).toBeDefined();
    });
    // MUTATION: container 里把 `provider` 加回请求体 ⇒ 本条红。
    // 前端传一份等于让「选哪个」有第二个知情者，两处迟早不一致。
    expect(body).not.toHaveProperty('provider');
    // 而 runtime 仍然是用户选的，必须在（对照：证明上一条不是"整个请求体都空"）。
    expect(body).toHaveProperty('runtime');
  });

  it('⭐ 界面上**没有**档位单选组 —— 用户不该关心自己跑在哪种沙箱上', async () => {
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: true },
      { name: 'boxlite', capabilities: caps(), isDefault: false },
    ]);
    renderContainer();
    await chooseRuntime();

    // MUTATION: 把 view 里那组单选渲染回来 ⇒ 本条红。
    expect(radiosNamed('sandbox-provider')).toHaveLength(0);
    // 对照：runtime 那组**还在**（证明不是"整个面板没渲染"这种假绿）。
    expect(radiosNamed('sandbox-runtime').length).toBeGreaterThan(0);
  });

  it('能力位取 isDefault 那项，不是数组第一项', async () => {
    // ⚠️ 第一项 spawnTty=true、被标 default 的那项 spawnTty=false：
    //    "取首项"的实现会让按钮保持可用，从而在这条上露馅。
    mockRegistry([
      { name: 'aio', capabilities: caps(), isDefault: false },
      { name: 'headless-only', capabilities: caps({ spawnTty: false }), isDefault: true },
    ]);
    renderContainer();
    await chooseRuntime();

    const createBtn = await screen.findByRole('button', { name: '发起任务并打开终端' });
    await waitFor(() => {
      expect(createBtn).toBeDisabled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/不支持终端（spawnTty=false）/);
    // ⚠️ 文案**不许**再叫用户「改选其它运行档位」——那个开关已经不存在了，
    //    一条指向不存在操作的提示比不提示更贵。
    expect(screen.getByRole('alert')).not.toHaveTextContent(/改选/);
  });

  it('无任何 isDefault（契约异常）→ 兜底取第一项，核心链路仍可用', async () => {
    mockRegistry([
      { name: 'first', capabilities: caps(), isDefault: false },
      { name: 'second', capabilities: caps(), isDefault: false },
    ]);
    renderContainer();
    await chooseRuntime();

    // 后端现在 boot 时就 fail fast，这种响应更不该出现；但真出现时不该把整条链路堵死。
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
  });

  it('加载中：出骨架且禁用创建（不静默）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, async () => {
        await new Promise(() => undefined); // 永挂起，保持 pending 态以观测骨架
        return HttpResponse.json([]);
      }),
    );
    renderContainer();

    expect(await screen.findByTestId('providers-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
  });

  it('空 registry：说明原因并禁用创建', async () => {
    mockRegistry([]);
    renderContainer();
    await chooseRuntime();

    expect(await screen.findByText(/后端未注册任何沙箱运行环境/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
  });

  it('失败：给可重试提示；重试成功后恢复可用', async () => {
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

    expect(await screen.findByText(/运行环境确认失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await chooseRuntime();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
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

    await waitForCreatable();
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

    await waitForCreatable();
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

      await waitForCreatable();
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

    await waitForCreatable();
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

    await waitForCreatable();
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

    await waitForCreatable();
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

    await waitForCreatable();
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
    // ⚠️ 曾经在这里对照「provider 一侧照 isDefault 预选」——那组单选已删（档位由宿主平台
    //    选定，用户不该关心）。runtime 与 provider 的分界因此变成：**runtime 必须用户选，
    //    档位用户碰不到**，而不是「一个有默认、一个没有」。
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

    // ⚠️ **不能用 `waitForCreatable()`**：它内含 `chooseRuntime()`，而本条测的正是
    //    「一个 runtime 都没得选」。同步点改成那句提示自己出现。
    expect(await screen.findByText(/后端未注册任何 runtime/)).toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: '发起任务并打开终端' });
    await waitFor(() => {
      expect(createBtn).toBeDisabled();
    });
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

    // runtime 恰好选中一个（这一组仍然是用户的）。
    expect(checkedRadiosNamed('sandbox-runtime')).toHaveLength(1);
    // ⚠️ 档位那组已经不存在——曾经这里断的是「勾一组不会把另一组带过去」，
    //    现在只剩一组，那条前提没了。
    expect(radiosNamed('sandbox-provider')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sentRuntime).toBe('claude-code');
    });
    // 档位由后端定，请求体里**不带**它。
    expect(sentProvider).toBeUndefined();
  });

  /**
   * ★ 无头面板只挂在**无头沙箱**底下。
   *
   * 此前它对每个沙箱无条件渲染，于是交互式沙箱底下也挂一条「无头任务」，永远停在
   * 空态说"这个沙箱还没有任务"——因为交互式沙箱的 AgentTask 列表恒为空。而左侧树的
   * `项目 · N` 数的是 **Sandbox**（Task 的产品叫法），同一屏上"· 1"与"还没有任务"
   * 直接打架：两句话各自都对，说的却是两个东西。
   *
   * 模式在创建时二选一（P20 §3.2 / `SandboxDto.headless`）——交互式沙箱的全部界面
   * 就是终端本身。
   *
   * MUTATION：把门控改回只判 `sandboxRuntime === undefined` → 本条红。
   */
  it('交互式沙箱（headless=false）⇒ 底下不挂无头面板', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps({ headlessTask: true }), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'claude-code', displayName: 'Claude Code' })]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(
          sandboxDto({ id: 'sb-i', runtime: 'claude-code', status: 'running', headless: false }),
          { status: 201 },
        ),
      ),
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () => HttpResponse.json([])),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /claude-code/ });
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    // 沙箱已 running（走到终端那一支）——`TerminalMount` 是 next/dynamic 懒加载的，
    // jsdom 里解析不了，所以锚点取它的 loading 占位而不是 `terminal-container`。
    await screen.findByText('终端加载中…');
    // 交互式沙箱底下不该挂无头面板：对照组是紧邻的 ⑧（同样 setup、headless:true ⇒ 有面板）。
    expect(screen.queryByTestId('headless-task-detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '发起无头运行' })).not.toBeInTheDocument();
  });

  it('⑧ 建出来的沙箱把它自己的 runtime 交给无头任务面板（不是前端再挑一个）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps({ headlessTask: true }), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'claude-code', displayName: 'Claude Code' })]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        // 后端回的 runtime 才是权威（可能与请求不同：后端有归一化的余地）。
        // ★ `headless: true` 不是装饰：无头面板**只挂在无头沙箱底下**。
        // 交互式沙箱（headless:false）底下挂一条「无头任务」，会永远停在空态说
        // "还没有任务"，而左侧树同时写着 `项目 · 1` —— 两处读数打架（同名不同物）。
        HttpResponse.json(
          sandboxDto({ id: 'sb-hl', runtime: 'claude-code', status: 'running', headless: true }),
          { status: 201 },
        ),
      ),
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () => HttpResponse.json([])),
    );
    renderContainer();

    await screen.findByRole('radio', { name: /claude-code/ });
    await chooseRuntime();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    // 无头面板挂起来了 = 容器确实拿到了**沙箱自己的** runtime（它为 undefined 时整块不渲染）。
    // 面板里的 POST 路径 `:rt` 就取这个值，所以这一步同时证明了无头链路不会再拿到一个凭空的 runtime。
    //
    // ⚠️ 断言从"有指令 textarea"改成"有无头面板"：这个沙箱**一条任务都没有**，
    // 面板此刻是引导态而不是发起表单（§N.3）——发起表单要 [发起无头运行] 才打开。
    expect(await screen.findByTestId('headless-task-detail')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发起无头运行' }));
    expect(await screen.findByLabelText('任务指令')).toBeInTheDocument();
  });
});

describe('SandboxTerminalContainer · 鉴权拦截层（P20 §5.1 三分支）', () => {
  // 这一层此前**从未接线**:`AuthGateContainer` 备好了两个只给向导用的 prop
  //（showOneTimeNotice / onOpenCredentials）,而生产代码零调用方。于是真实链路是
  // 前端不看 credentialStatus → 直接建沙箱 → 后端注入时发现没凭证 → 记一条
  // NO_CREDENTIAL 的 WARN 让 agent 裸跑 → 用户在终端里撞见 CLI 自己的登录菜单。
  // 下面四条按 §5.1 的三分支逐一钉死。
  beforeEach(() => {
    nav.push.mockClear();
  });

  it('② 无生效凭证（none）→ 出拦截面板、禁用发起，且**一个创建请求都不发**', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex', credentialStatus: 'none' })]);
    let posted = 0;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () => {
        posted += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    renderContainer();
    await chooseRuntime('codex');

    expect(await screen.findByTestId('auth-gate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    // 判据不止"按钮禁着":这条链路的原始故障就是**请求发出去了**,后端只能事后 WARN。
    expect(posted).toBe(0);
    // 分支②才说"只需配置一次"——这是一次性语义,已过期那支说这句话是假的。
    expect(screen.getByText(/只需配置一次/)).toBeInTheDocument();
  });

  it('③ 凭证已过期（expired）→ 同样拦住，但**不说**「只需配置一次」', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex', credentialStatus: 'expired' })]);
    renderContainer();
    await chooseRuntime('codex');

    expect(await screen.findByTestId('auth-gate')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    expect(screen.queryByText(/只需配置一次/)).not.toBeInTheDocument();
  });

  it('① 有生效凭证（active）→ 不出闸门，给正面确认「将以 … 身份运行」，发起可用', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([
      runtimeDto({ id: 'codex', credentialStatus: 'active', maskedIdentifier: 'a***@gm' }),
    ]);
    renderContainer();
    await chooseRuntime('codex');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
    expect(screen.queryByTestId('auth-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('runtime-identity')).toHaveTextContent('将以 a***@gm 身份运行');
  });

  it('⚠️ expiring（快到期）**不拦**——它仍然能用，拦下来等于把预警当成故障', async () => {
    // P21 §2.2 把 <7 天定为**黄色预警态**,不是失效态。这条用例挡住"图省事把
    // 三分支写成 status !== 'active' 就拦"那种改法——那会在凭证到期前一周
    // 突然把所有人的发起入口锁死。
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([
      runtimeDto({ id: 'codex', credentialStatus: 'expiring', maskedIdentifier: 'a***@gm' }),
    ]);
    renderContainer();
    await chooseRuntime('codex');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
    expect(screen.queryByTestId('auth-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('runtime-identity')).toHaveTextContent(/即将到期/);
  });

  it('闸门页脚 [管理所有凭证] → 跳凭证页（此前该 prop 只有 storybook 在传）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex', credentialStatus: 'none' })]);
    renderContainer();
    await chooseRuntime('codex');

    await screen.findByTestId('auth-gate');
    fireEvent.click(screen.getByRole('button', { name: /管理所有凭证/ }));
    expect(nav.push).toHaveBeenCalledWith('/settings/credentials');
  });
});

// ————————————————————————————————————————————————————————————————
// 弹层形态（F21-2 §N.0）：它**是弹层**，而且是被打开的 —— 不再是"沙箱为空时的兜底渲染"。
// ————————————————————————————————————————————————————————————————
describe('SandboxTerminalContainer · 新建任务弹层形态', () => {
  /**
   * ⚠️ 本轮最要紧的一条。此前 `NewSandboxPanelView` 由
   * `sandboxId===null || socketConfig===null` **兜底渲染**：不打开它、它自己就在，
   * 于是"创建"根本不是一个动作（§N.0）。
   *
   * 变异：把 `currentModal !== 'newTask' ? null : (…)` 改回无条件渲染 ⇒ 本例变红。
   */
  it('未打开时**不渲染**面板，主区是占位引导（面板不再是兜底态）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    renderContainer({ openModal: false });

    expect(await screen.findByTestId('no-sandbox-placeholder')).toHaveTextContent(/ProjectA/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('new-sandbox-panel')).not.toBeInTheDocument();
  });

  /**
   * ★ 焦点必须移进弹层（H1）。缺了它，焦点留在打开弹窗的那个元素上——在这个产品里
   * 常常是**正在跑的终端**，于是用户在弹窗里敲的指令进了另一个 agent 的 shell，
   * 而弹窗的输入框一个字都收不到。实测复现过（`activeElement` = `.xterm-helper-textarea`）。
   *
   * ⚠️ 这条**必须测任务弹窗**：新建项目那个的表单碰巧带 `autoFocus`，焦点本来就会进去，
   * 拿它测等于假绿（我第一版就写错了地方，删掉 `useModalFocus` 照样全绿）。
   *
   * MUTATION：删掉 `useModalFocus(currentModal === 'newTask', taskModalRef)` → 本条红。
   */
  it('打开后焦点移进弹层（不留在外面的终端上）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    // 模拟"焦点原本在弹窗外"：造一个外部输入框并聚焦它。
    const outside = document.createElement('textarea');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    renderContainer();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    // 且不该落在 [✕] 上——弹窗是让人填东西的，回车会直接把它关掉。
    expect(document.activeElement?.getAttribute('data-modal-close')).toBeNull();
    outside.remove();
  });

  it('打开后是真 overlay（role=dialog + aria-modal），标题带项目上下文', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    renderContainer();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-testid', 'modal-new-task');
    // 弹窗内**没有**项目下拉：任务归属继承左侧树选中项（§9.0 两个弹窗不嵌套）。
    expect(within(dialog).getByText(/在「ProjectA」中发起/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/项目/)).not.toBeInTheDocument();
  });

  it('Esc 关闭弹层，且**指令随之清空**（重开不会带着上次的敏感上下文）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    renderContainer();

    const textarea = await screen.findByLabelText('任务指令（可选）');
    fireEvent.change(textarea, { target: { value: '迁移 acme-billing 内部系统' } });

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // 重开：表单态已清空（指令绝不跨一次打开残留）。
    act(() => {
      useAppStore.getState().setCurrentModal('newTask');
    });
    expect(await screen.findByLabelText('任务指令（可选）')).toHaveValue('');
  });

  it('[取消] 与 [✕] 同样关闭弹层', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    renderContainer();

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    act(() => {
      useAppStore.getState().setCurrentModal('newTask');
    });
    fireEvent.click(await screen.findByRole('button', { name: '关闭' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('创建受理 ⇒ 弹层关闭，主区接手进度（失败时弹层留着就地改配置）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(sandboxDto({ id: 'sb-modal', status: 'creating' }), { status: 201 }),
      ),
    );
    renderContainer();
    await chooseRuntime('codex');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('门口拒绝（sideEffectFree）⇒ 弹层**不关**，就地提示改配置', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, () =>
        HttpResponse.json(
          {
            code: 'UNKNOWN_BRANCH',
            message: "branch 'gone' 不存在",
            retryable: false,
            sideEffectFree: true,
          },
          { status: 400 },
        ),
      ),
    );
    renderContainer();
    await chooseRuntime('codex');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    expect(await screen.findByTestId('create-rejection')).toHaveTextContent(/未创建任何任务/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // 零副作用 ⇒ 绝不出"重新创建"失败卡。
    expect(screen.queryByTestId('create-failure')).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// 分支选择器（F21-2 §N.1）
// ————————————————————————————————————————————————————————————————
describe('SandboxTerminalContainer · 分支选择器', () => {
  /**
   * 读取请求体为可断言的记录。**不用 `as` 断言**（14 §4 防绕过类型：测试也不例外）——
   * `Object.entries` 走一遍就把 `unknown` 变成结构上真实的键值对。
   */
  async function readBody(request: Request): Promise<Record<string, unknown>> {
    const raw: unknown = await request.json();
    return typeof raw === 'object' && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
  }

  /** 捕获 POST /api/sandboxes 的请求体。 */
  function captureCreate(): { body: () => Record<string, unknown> | undefined } {
    let captured: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_BASE}/api/sandboxes`, async ({ request }) => {
        captured = await readBody(request);
        return HttpResponse.json(sandboxDto(), { status: 201 });
      }),
    );
    return { body: () => captured };
  }

  it('选项来自 GET /api/projects/:id/branches（缺省项 = 跟随基线当前分支）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    renderContainer();

    const select = await screen.findByLabelText('分支（可选）');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'develop' })).toBeInTheDocument();
    });
    // 缺省项在最前，且**它的 value 是空串**——前端不预填任何分支名。
    expect(select).toHaveValue('');
    expect(within(select).getByRole('option', { name: /跟随基线当前分支/ })).toBeInTheDocument();
  });

  /**
   * ⚠️ 本条是「缺省语义」的看守（§9.4 ④）。
   * 变异：在 handleCreate 里把 `branch === '' ? {} : { branch }` 改成 `{ branch: branch || 'main' }`
   * （"顺手补个默认值"）⇒ 本例变红。
   */
  it('不选分支 ⇒ 请求体**不含** branch 字段（由后端走基线缺省）', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    const created = captureCreate();
    renderContainer();

    await screen.findByLabelText('分支（可选）');
    await chooseRuntime('codex');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    await waitFor(() => {
      expect(created.body()).toBeDefined();
    });
    expect(created.body()).not.toHaveProperty('branch');
  });

  it('选了非缺省分支 ⇒ 请求体 branch = 所选', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    const created = captureCreate();
    renderContainer();

    const select = await screen.findByLabelText('分支（可选）');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'feature/x' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'feature/x' } });
    await chooseRuntime('codex');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));

    await waitFor(() => {
      expect(created.body()?.['branch']).toBe('feature/x');
    });
  });

  /**
   * 空项目**整块不渲染**，且**一个 /branches 请求都不发**（没有 git，谈不上分支）。
   * 变异：把 `showBranchPicker={isGitProject}` 改成恒 true ⇒ 本例变红。
   */
  it('空项目 ⇒ 不渲染选择器，也不发 /branches 请求', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    let branchHits = 0;
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () => {
        branchHits += 1;
        return HttpResponse.json(['main']);
      }),
    );
    renderContainer({ sourceType: 'empty' });

    await screen.findByRole('dialog');
    await chooseRuntime('codex');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
    expect(screen.queryByTestId('branch-picker')).not.toBeInTheDocument();
    expect(branchHits).toBe(0);
  });

  /**
   * 分支列表取不到 ⇒ 降级为"用基线分支"，**创建照常可点**。
   * 变异：把 `branchesErrorMessage` 接进 `createDisabledReason`（"顺手拦一下"）⇒ 本例变红。
   */
  it('/branches 失败 ⇒ 就地说明并降级，**不禁用创建**', async () => {
    mockRegistry([{ name: 'aio', capabilities: caps(), isDefault: true }]);
    mockRuntimeRegistry([runtimeDto({ id: 'codex' })]);
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom', retryable: true }, { status: 500 }),
      ),
    );
    renderContainer();
    await chooseRuntime('codex');

    expect(await screen.findByText(/将使用基线当前分支创建/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toBeEnabled();
    });
  });
});
