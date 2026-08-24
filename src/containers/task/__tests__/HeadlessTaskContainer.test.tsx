// S6 无头 Task 容器：发起 → 订阅渲染 → 终态（退出码/产物/下载）→ 续接 → 能力位显隐。
// WS 用注入 mock 工厂（12 §3.1.1 依赖注入替代 mock.module），REST 用 MSW。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { HeadlessTaskContainer } from '@/containers/HeadlessTaskContainer';
import { OBJECT_URL_REVOKE_DELAY_MS } from '@/hooks/task/useAgentTask';
import { abortError, installSaveFilePicker } from '@/mocks/saveFilePicker';
import { useAppStore } from '@/stores';
import type { TaskSocketFactory, TaskSocketFactoryArgs, TaskSocketLike } from '@/types/taskSocket';
import type { TaskClientFrame } from '@/types/ws-protocol';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const SANDBOX = 'sb-1';
const RUNTIME = 'codex';

/**
 * jsdom 里一行的渲染预算：useVirtualList 量不到布局 ⇒ 视口退回兜底 480px、行高退回估计 20px，
 * 加上 400px overscan ⇒ 一屏最多 (480+400)/20 = 44 行。取 60 留足余量，同时仍然远小于几千条。
 */
const VIRTUAL_ROW_BUDGET = 60;

// ——— 可控 /tasks socket（模块级稳定引用，避免连接 effect 反复重建）———
class MockTaskSocket implements TaskSocketLike {
  private connectCb: (() => void) | null = null;
  private disconnectCb: (() => void) | null = null;
  private connectErrorCb: ((err?: unknown) => void) | null = null;
  private frameCb: ((raw: unknown) => void) | null = null;
  readonly emitted: TaskClientFrame[] = [];

  onConnect(cb: () => void): void {
    this.connectCb = cb;
  }
  onDisconnect(cb: () => void): void {
    this.disconnectCb = cb;
  }
  onConnectError(cb: (err?: unknown) => void): void {
    this.connectErrorCb = cb;
  }
  onFrame(cb: (raw: unknown) => void): void {
    this.frameCb = cb;
  }
  emitFrame(frame: TaskClientFrame): void {
    this.emitted.push(frame);
  }
  disconnect(): void {
    this.disconnectCb = null;
    this.connectErrorCb = null;
  }
  triggerConnect(): void {
    this.connectCb?.();
  }
  triggerDisconnect(): void {
    this.disconnectCb?.();
  }
  serverEmit(raw: unknown): void {
    this.frameCb?.(raw);
  }
}

let sockets: MockTaskSocket[] = [];
/** 每条连接的握手参数（uri + query）——用来断言容器把归属声明进了握手。 */
let handshakes: TaskSocketFactoryArgs[] = [];
/** 模块级稳定引用（hook 的 deps 里有 socketFactory）。 */
const socketFactory: TaskSocketFactory = (args) => {
  handshakes.push(args);
  const socket = new MockTaskSocket();
  sockets.push(socket);
  return socket;
};

function latestSocket(): MockTaskSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) throw new Error('尚未建立 /tasks 连接');
  return socket;
}

function renderContainer(
  props: Partial<React.ComponentProps<typeof HeadlessTaskContainer>> = {},
): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  render(
    <HeadlessTaskContainer
      sandboxId={SANDBOX}
      runtime={RUNTIME}
      wsBaseUrl="ws://localhost:3001"
      headlessTaskSupported
      providerName="aio"
      socketFactory={socketFactory}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

/** POST 202 handler，回带一个可断言的请求体记录器。202 现在回**整个 DTO**。 */
function mockRun(taskId = 'task-1'): { body: () => unknown } {
  let captured: unknown;
  server.use(
    http.post(`${API_BASE}/api/sandboxes/:id/runtimes/:rt/tasks`, async ({ request, params }) => {
      const body: Record<string, unknown> = await request
        .json()
        .then((v) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}))
        .catch(() => ({}));
      captured = { ...body, _rt: params['rt'] };
      // 发起成功后容器会重取列表，让新任务出现在权威来源里。
      mockList([taskDto({ id: taskId, status: 'running' })]);
      return HttpResponse.json(taskDto({ id: taskId, status: 'running' }), { status: 202 });
    }),
  );
  return { body: () => captured };
}

function taskDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    sandboxId: SANDBOX,
    runtime: RUNTIME,
    status: 'running',
    timeoutMinutes: 120,
    lastSeq: 0,
    artifacts: [],
    startedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

/** 任务列表 = 刷新恢复的权威来源。 */
function mockList(tasks: Record<string, unknown>[]): void {
  server.use(http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () => HttpResponse.json(tasks)));
}

/**
 * 打开发起表单并交出 textarea。
 *
 * ⚠️ 这个 helper 本身就是本轮改造的证据（F21-2 §N.3）：发起表单**不再是默认态** ——
 * 面板按"这个沙箱有没有任务"分叉成引导 / 只读详情，表单必须被 [发起无头运行] 显式打开。
 * 此前只要沙箱 running 就直接渲染发起表单，与有没有任务无关。
 */
async function openLauncher(): Promise<HTMLElement> {
  const entry = screen.queryByRole('button', { name: '发起无头运行' });
  if (entry !== null) fireEvent.click(entry);
  return screen.findByLabelText('任务指令');
}

/** 发起一轮任务并连上 WS（多数用例的共同前置）。 */
async function launch(prompt = '把测试补齐'): Promise<void> {
  const textarea = await openLauncher();
  fireEvent.change(textarea, { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));
  await screen.findByTestId('task-output-pane');
  act(() => {
    latestSocket().triggerConnect();
  });
}

function emitFrame(frame: unknown): void {
  act(() => {
    latestSocket().serverEmit(frame);
  });
}

function emitEvent(seq: number, type: string, data: unknown): void {
  emitFrame({
    type: 'event',
    taskId: 'task-1',
    seq,
    event: { type, timestamp: '2026-08-22T00:00:00.000Z', data },
  });
}

/** 终态：exit 帧（**唯一**终态来源）+ 刷新后的列表带上产物。 */
function emitExit(status: string, exitCode?: number, listOverrides: Record<string, unknown> = {}) {
  mockList([
    taskDto({ status, ...(exitCode === undefined ? {} : { exitCode }), ...listOverrides }),
  ]);
  emitFrame({
    type: 'exit',
    taskId: 'task-1',
    status,
    ...(exitCode === undefined ? {} : { exitCode }),
  });
}

beforeEach(() => {
  cleanup();
  sockets = [];
  handshakes = [];
  // 倒计时用例要控时钟；固定到 startedAt 之后一点，其余用例不受影响。
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-22T00:10:00.000Z'));
  // selectedTaskId 是 persist 白名单字段，跨用例会残留 → 每例复位。
  useAppStore.getState().setSelectedTaskId(null);
  mockList([]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // 下载用例给 URL 补过 createObjectURL/revokeObjectURL —— 逐例摘掉，避免泄漏。
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  // 流式落盘用例给 window 装过存盘对话框替身 —— 逐例摘掉，免得漏给下一个用例。
  Reflect.deleteProperty(window, 'showSaveFilePicker');
});

// ————————————————————————————————————————————————————————————————
// ① 能力位显隐（headlessTask）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 能力位显隐（headlessTask）', () => {
  it('headlessTask=false ⇒ [发起无头运行] 入口置灰 + 给出原因（与 spawnTty=false 同一套做法）', async () => {
    renderContainer({ headlessTaskSupported: false, providerName: 'boxlite' });

    // 能力位判定前移到了**入口**上：连发起表单都打不开，比"打开一张全禁用的表单"更诚实。
    const entry = await screen.findByRole('button', { name: '发起无头运行' });
    expect(entry).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/boxlite.*headlessTask=false/);
  });

  it('headlessTask=false ⇒ 点击不发任何请求，界面停在非发起态', async () => {
    const run = mockRun();
    renderContainer({ headlessTaskSupported: false, providerName: 'boxlite' });
    await screen.findByRole('button', { name: '发起无头运行' });

    fireEvent.click(screen.getByRole('button', { name: '发起无头运行' }));
    await Promise.resolve();

    expect(run.body()).toBeUndefined();
    // 入口禁着 ⇒ 表单根本不该出现（更不该出现输出面板）。
    expect(screen.queryByLabelText('任务指令')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-output-pane')).not.toBeInTheDocument();
    // 容器里另有一道 guard（handleSubmit 首行判 headlessTaskSupported===false），
    // 与入口禁用互为兜底；这里断言的是二者共同的可观察结果。
  });

  it('headlessTask=true ⇒ 正常可用，无置灰原因', async () => {
    renderContainer();
    await openLauncher();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('能力位未知（刷新后拿不到 provider）⇒ 不置灰，但就地说明以后端校验为准', async () => {
    renderContainer({ headlessTaskSupported: null });
    // 引导态先说一次（入口不禁），打开表单后仍然说 —— 两处同源。
    expect(await screen.findByRole('status')).toHaveTextContent(/无法确认.*以后端校验为准/);
    const textarea = await openLauncher();
    expect(textarea).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/无法确认.*以后端校验为准/);
  });
});

// ————————————————————————————————————————————————————————————————
// ② 发起（请求体 / 计数 / 安全红线）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 发起', () => {
  it('指令 + 超时档位 + 白名单旗标全部进请求体，runtime 进路径', async () => {
    const run = mockRun();
    renderContainer();

    const textarea = await openLauncher();
    fireEvent.change(textarea, { target: { value: '把测试补齐' } });
    fireEvent.change(screen.getByLabelText('硬超时'), { target: { value: '240' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));

    await waitFor(() => {
      expect(run.body()).toEqual({
        prompt: '把测试补齐',
        timeoutMinutes: 240,
        extraArgs: ['--verbose'],
        _rt: RUNTIME,
      });
    });
  });

  it('不勾旗标 ⇒ 请求体不带 extraArgs（不发空数组）', async () => {
    const run = mockRun();
    renderContainer();
    await launch('分析架构');
    await waitFor(() => {
      expect(run.body()).toEqual({ prompt: '分析架构', timeoutMinutes: 120, _rt: RUNTIME });
    });
  });

  it('空指令 ⇒ 禁用发起（prompt 下限 1）', async () => {
    renderContainer();
    await openLauncher();
    expect(screen.getByRole('button', { name: '发起无头任务' })).toBeDisabled();
  });

  it('超 8000 上限 ⇒ 就地红字计数 + 禁用发起', async () => {
    renderContainer();
    const textarea = await openLauncher();
    fireEvent.change(textarea, { target: { value: 'x'.repeat(8001) } });

    expect(screen.getByRole('button', { name: '发起无头任务' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('8001/8000');
  });

  it('安全红线：指令绝不进 store / localStorage，提交即清空（15 §3.5）', async () => {
    mockRun();
    renderContainer();

    const textarea = await openLauncher();
    fireEvent.change(textarea, { target: { value: '迁移 acme-billing 内部系统' } });
    // 输入期间就不该出现在全局 store 里（不是"提交后才清"）。
    expect(JSON.stringify(useAppStore.getState())).not.toContain('acme-billing');

    fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));
    await screen.findByTestId('task-output-pane');

    expect(JSON.stringify(useAppStore.getState())).not.toContain('acme-billing');
    expect(globalThis.localStorage.getItem('agent-platform-ui') ?? '').not.toContain(
      'acme-billing',
    );
  });

  it('409 UNSUPPORTED_CAPABILITY ⇒ 就地人话（码不裸抛）', async () => {
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/runtimes/:rt/tasks`, () =>
        HttpResponse.json(
          { code: 'UNSUPPORTED_CAPABILITY', message: 'provider 不支持', retryable: false },
          { status: 409 },
        ),
      ),
    );
    renderContainer();
    const textarea = await openLauncher();
    fireEvent.change(textarea, { target: { value: '跑一下' } });
    fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));

    const alert = await screen.findByText(/不支持无头任务/);
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).not.toBe('UNSUPPORTED_CAPABILITY');
  });
});

// ————————————————————————————————————————————————————————————————
// ②·5 握手期声明归属（后端 /tasks 的 subscribe 拿它跟 task.sandboxId 对表）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · /tasks 握手归属', () => {
  it('容器把**自己的** sandboxId 放进握手 query（不带则后端只能"没带放行"）', async () => {
    mockRun();
    renderContainer();
    await launch();

    expect(handshakes.at(-1)?.query['sandboxId']).toBe(SANDBOX);
  });

  it('换一个沙箱挂载 ⇒ 握手带的是那个沙箱的 id（归属不能写死也不能串台）', async () => {
    mockRun();
    renderContainer({ sandboxId: 'sb-other' });
    await launch();

    expect(handshakes.at(-1)?.query['sandboxId']).toBe('sb-other');
  });
});

// ————————————————————————————————————————————————————————————————
// ③ 订阅与事件渲染
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 事件渲染分类', () => {
  it('正文 / 工具调用（可折叠）/ 错误（高亮）三类分开呈现；session-started 不出现', async () => {
    mockRun();
    renderContainer();
    await launch();

    emitEvent(1, 'session-started', { ref: 'sess-9' });
    emitEvent(2, 'agent-message', { text: '读取 src/app.ts' });
    emitEvent(3, 'tool-call', {
      status: 'started',
      id: 'c1',
      name: 'write_file',
      input: { path: 'a.ts' },
    });
    emitEvent(4, 'error', { message: '解析失败' });

    const pane = screen.getByTestId('task-output-pane');
    expect(await within(pane).findByText('读取 src/app.ts')).toBeInTheDocument();

    // 工具调用：默认折叠（<details> 无 open 属性）。
    const tool = pane.querySelector('[data-kind="tool"] details');
    expect(tool).not.toBeNull();
    expect(tool).not.toHaveAttribute('open');
    expect(within(pane).getByText(/🔧 工具调用：write_file/)).toBeInTheDocument();

    // 错误：高亮 + 归入**唯一**的活区。逐条 role="alert" 会让 20 条错误变成 20 次抢播
    // （读屏被刷屏），所以活区只有一个：整段输出的 role="log"（隐含 aria-live=polite）。
    const error = pane.querySelector<HTMLElement>('[data-kind="error"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute('role')).toBeNull();
    expect(within(pane).getByRole('log')).toContainElement(error);
    expect(within(pane).getByText('解析失败')).toBeInTheDocument();

    // session-started 不给用户看：只有 3 条可见条目。
    expect(pane.querySelectorAll('li')).toHaveLength(3);
  });

  it('工具调用两帧按 id 合并成**一个**折叠块（不是两次独立调用）', async () => {
    mockRun();
    renderContainer();
    await launch();

    emitEvent(1, 'tool-call', { status: 'started', id: 'c1', name: 'bash', input: { cmd: 'ls' } });
    const pane = screen.getByTestId('task-output-pane');
    await within(pane).findByText(/🔧 工具调用：bash/);
    expect(within(pane).getByText('运行中…')).toBeInTheDocument();

    emitEvent(2, 'tool-call', { status: 'completed', id: 'c1', exitCode: 0, output: 'a.ts' });

    // 仍然只有一个工具块，就地补上了退出码与输出。
    expect(pane.querySelectorAll('[data-kind="tool"]')).toHaveLength(1);
    expect(within(pane).getByText('已完成（退出码 0）')).toBeInTheDocument();
    expect(within(pane).getByText('a.ts')).toBeInTheDocument();
    expect(pane.querySelector('[data-kind="tool"]')?.getAttribute('data-tool-failed')).toBe(
      'false',
    );
  });

  it('工具失败的两个来源都标红：claude 的 isError 与 codex 的非零退出码', async () => {
    mockRun();
    renderContainer();
    await launch();

    // claude：只有 isError，**没有** exitCode 键。
    emitEvent(1, 'tool-call', { status: 'started', id: 'c1', name: 'Edit' });
    emitEvent(2, 'tool-call', { status: 'completed', id: 'c1', isError: true });
    // codex：真实非零退出码，**没有** isError 键。
    emitEvent(3, 'tool-call', { status: 'started', id: 'c2', name: 'bash' });
    emitEvent(4, 'tool-call', { status: 'completed', id: 'c2', exitCode: 2 });

    const pane = screen.getByTestId('task-output-pane');
    const tools = pane.querySelectorAll('[data-kind="tool"]');
    expect(tools).toHaveLength(2);
    expect(tools[0]?.getAttribute('data-tool-failed')).toBe('true');
    expect(tools[1]?.getAttribute('data-tool-failed')).toBe('true');

    // claude 那条只说"失败"，**不编一个退出码出来**；codex 那条带真实退出码。
    expect(within(pane).getByText('失败')).toBeInTheDocument();
    expect(within(pane).getByText('失败（退出码 2）')).toBeInTheDocument();
  });

  it('⚠️ 陷阱回归：claude 的**成功**调用（无 exitCode 无 isError）绝不能被标成失败', async () => {
    mockRun();
    renderContainer();
    await launch();

    emitEvent(1, 'tool-call', { status: 'started', id: 'ok', name: 'Read' });
    emitEvent(2, 'tool-call', { status: 'completed', id: 'ok', output: 'file contents' });

    const pane = screen.getByTestId('task-output-pane');
    expect(pane.querySelector('[data-kind="tool"]')?.getAttribute('data-tool-failed')).toBe(
      'false',
    );
    expect(within(pane).getByText('已完成')).toBeInTheDocument();
    expect(within(pane).queryByText(/失败/)).not.toBeInTheDocument();
  });

  it('seq 缺口 ⇒ 面板显著告警（不容忍、也不静默补拉）', async () => {
    mockRun();
    renderContainer();
    await launch();

    emitEvent(1, 'agent-message', { text: 'a' });
    emitEvent(4, 'agent-message', { text: 'd' });

    expect(await screen.findByText(/事件序号出现缺口/)).toBeInTheDocument();
  });

  it('回放被砍头（caught_up.firstSeq）⇒ 明说"开头缺失"，不把残缺记录当完整的渲染', async () => {
    mockRun();
    renderContainer();
    await launch();

    emitEvent(25, 'agent-message', { text: '半截记录' });
    emitFrame({ type: 'caught_up', taskId: 'task-1', firstSeq: 25, seq: 25 });

    expect(await screen.findByText(/回放被截断/)).toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ③b 硬超时倒计时 + 终止任务
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 倒计时与终止', () => {
  it('渲染"还剩多久"（有 timeoutMinutes 预算才算得出来）', async () => {
    mockRun();
    renderContainer();
    await launch();
    // startedAt 固定在 2026-08-22T00:00:00Z，预算 120min ⇒ 00:30 时应剩 1 小时 30 分。
    vi.setSystemTime(new Date('2026-08-22T00:30:00.000Z'));
    act(() => {
      vi.advanceTimersByTime(1100); // 走一次本地时钟 tick（**不是**网络轮询）
    });

    // 精确取整口径在 lib/taskOutcome.test.ts 里钉（纯函数、无时钟抖动）；
    // 这里只验"容器把预算接上了、渲染的是剩余量而不是已用量"。
    expect(screen.getByTestId('task-deadline')).toHaveTextContent(/还剩 1 小时 \d+ 分/);
  });

  it('超过预算 ⇒ 提示强杀在路上（而不是显示负数）', async () => {
    mockRun();
    renderContainer();
    await launch();
    vi.setSystemTime(new Date('2026-08-22T09:00:00.000Z'));
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(screen.getByTestId('task-deadline')).toHaveTextContent('已超过硬超时预算');
  });

  it('终止任务需二次确认；确认后 POST .../cancel，终态仍等 WS exit 帧', async () => {
    mockRun();
    let cancelHit = 0;
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () => {
        cancelHit += 1;
        return HttpResponse.json(taskDto({ status: 'running' }), { status: 202 });
      }),
    );
    renderContainer();
    await launch();

    // 第一步只是确认提示，不发请求（避免误手掐掉一个跑了 3 小时的任务）。
    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    expect(screen.getByText(/终止后本轮无法恢复/)).toBeInTheDocument();
    expect(cancelHit).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '确认终止' }));
    await waitFor(() => {
      expect(cancelHit).toBe(1);
    });

    // 202 只是受理：此刻还没有终态卡，要等 exit 帧。
    expect(screen.queryByTestId('task-outcome')).not.toBeInTheDocument();
    emitExit('killed');
    expect(await screen.findByTestId('task-outcome')).toBeInTheDocument();
  });

  it('取消确认 ⇒ 不发请求', async () => {
    mockRun();
    let cancelHit = 0;
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () => {
        cancelHit += 1;
        return HttpResponse.json(taskDto(), { status: 202 });
      }),
    );
    renderContainer();
    await launch();

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await Promise.resolve();

    expect(cancelHit).toBe(0);
    expect(screen.getByRole('button', { name: '终止任务' })).toBeInTheDocument();
  });

  it('任务终结后不再出现终止入口与倒计时', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitExit('succeeded', 0);

    await screen.findByTestId('task-outcome');
    expect(screen.queryByRole('button', { name: '终止任务' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-deadline')).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ④ 终态：退出码（含缺席）+ 产物 + 下载
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 终态', () => {
  it('exitCode 缺席 ⇒ 按非零退出处理，界面上绝不出现 undefined', async () => {
    mockRun();
    renderContainer();
    await launch();
    // 被信号杀掉 ⇒ exit 帧没有 exitCode，DTO 也没有。
    emitExit('killed', undefined, {
      errorCode: 'TASK_TIMEOUT',
      finishedAt: '2026-08-22T01:00:00Z',
    });

    const outcome = await screen.findByTestId('task-outcome');
    expect(within(outcome).getByTestId('task-exit-code').textContent).not.toContain('undefined');
    expect(within(outcome).getByTestId('task-exit-code')).toHaveTextContent('未知');
    expect(outcome.getAttribute('data-exit-missing')).toBe('true');
    expect(within(outcome).getByRole('alert')).toBeInTheDocument();
    expect(outcome.textContent).toContain('信号');
    expect(outcome.textContent).not.toContain('undefined');
  });

  /**
   * B2 `UNKNOWN_RUNTIME` 打到界面上的那一条（决策的端到端看守）。
   *
   * 可达场景（后端用例写死的）：任务行熬过平台重启，而注册该 adapter 的 out-of-tree 模块
   * 没有再加载 ⇒ 任务落 failed + 本码。**此刻 DTO 上没有任何自由文本**，
   * "让后端那句话透出来"这个选项在这条路上并不存在——所以前端必须自己有一句话。
   */
  it('UNKNOWN_RUNTIME 终态 ⇒ 给出人话与正确的下一步，而不是"暂未收录"', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitExit('failed', undefined, {
      errorCode: 'UNKNOWN_RUNTIME',
      finishedAt: '2026-08-22T01:00:00Z',
    });

    const outcome = await screen.findByTestId('task-outcome');
    expect(outcome.textContent).toContain('注册表');
    expect(outcome.textContent).not.toContain('暂未收录');
    // 后端把它标成 retryable:false ⇒ 界面不能反过来劝用户"重跑一次"。
    expect(outcome.textContent).toMatch(/只会再失败/);
    // 码只作诊断小字，不裸抛进正文（P22 §1）。
    await waitFor(() => {
      expect(outcome.getAttribute('data-code')).toBe('UNKNOWN_RUNTIME');
    });
    expect(within(outcome).getByText(/诊断码：UNKNOWN_RUNTIME/)).toBeInTheDocument();
  });

  it('exitCode 为 0 且 succeeded ⇒ 成功调性 + 产物列表可下载', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitExit('succeeded', 0, {
      sessionRef: 'sess-9',
      artifacts: [{ name: 'summary.md', size: 2048, modifiedAt: '2026-08-22T01:00:00Z' }],
    });

    const outcome = await screen.findByTestId('task-outcome');
    await waitFor(() => {
      expect(within(outcome).getByText('summary.md')).toBeInTheDocument();
    });
    expect(within(outcome).getByTestId('task-exit-code')).toHaveTextContent('0');
    expect(within(outcome).getByText('2.0 KB')).toBeInTheDocument();
    expect(within(outcome).getByRole('button', { name: '下载' })).toBeEnabled();
  });

  it('回退路径：下载走带凭据的取流 + blob 存盘（不是裸 href 直链）', async () => {
    mockRun();
    let hit = 0;
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, () => {
        hit += 1;
        return HttpResponse.text('artifact body');
      }),
    );
    // jsdom 没有 createObjectURL/revokeObjectURL：只补这两个方法，
    // **不能整体替换 URL 全局**（MSW 的 fetch 拦截依赖真 URL 构造器）。
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    renderContainer();
    await launch();
    emitExit('succeeded', 0, {
      artifacts: [{ name: 'patch.diff', size: 10, modifiedAt: '2026-08-22T01:00:00Z' }],
    });

    const download = await screen.findByRole('button', { name: '下载' });
    fireEvent.click(download);

    await waitFor(() => {
      expect(hit).toBe(1);
    });
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
    });
    // ⚠️ 撤销**刻意推迟**：紧跟 click() 撤销会被部分浏览器判成"下载源没了"从而打断下载。
    expect(revokeObjectURL).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(OBJECT_URL_REVOKE_DELAY_MS);
    });
    expect(revokeObjectURL).toHaveBeenCalled();
  });

  it('流式路径：进度文案透到终态卡上，且**全程没有 createObjectURL**（大产物不进内存）', async () => {
    mockRun();
    const { calls, writable } = installSaveFilePicker();
    const createObjectURL = vi.fn(() => 'blob:should-not-happen');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });

    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    server.use(
      http.get(
        `${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`,
        () =>
          // 后端同批给产物响应补上 content-length（它有 task.artifacts[].size）。
          new HttpResponse(body, { headers: { 'content-length': '4096' } }),
      ),
    );

    renderContainer();
    await launch();
    emitExit('succeeded', 0, {
      artifacts: [{ name: 'patch.diff', size: 4096, modifiedAt: '2026-08-22T01:00:00Z' }],
    });

    fireEvent.click(await screen.findByRole('button', { name: '下载' }));

    await waitFor(() => {
      expect(calls).toEqual([{ suggestedName: 'patch.diff' }]);
    });
    act(() => {
      controller?.enqueue(new Uint8Array(1024));
    });

    expect(await screen.findByTestId('download-progress')).toHaveTextContent(
      '已下载 1.0 KB / 4.0 KB（25%）',
    );

    act(() => {
      controller?.enqueue(new Uint8Array(3072));
      controller?.close();
    });
    await waitFor(() => {
      expect(writable.closed).toBe(true);
    });
    expect(writable.writtenBytes).toBe(4096);
    expect(createObjectURL).not.toHaveBeenCalled();
    // 下完之后进度条收掉，按钮回到「下载」。
    await waitFor(() => {
      expect(screen.queryByTestId('download-progress')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '下载' })).toBeEnabled();
  });

  it('流式路径下用户取消存盘 ⇒ **不弹错误**，也没发过请求（取消是正常路径）', async () => {
    mockRun();
    installSaveFilePicker({ reject: abortError() });
    let hit = 0;
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, () => {
        hit += 1;
        return HttpResponse.text('nope');
      }),
    );

    renderContainer();
    await launch();
    emitExit('succeeded', 0, {
      artifacts: [{ name: 'patch.diff', size: 10, modifiedAt: '2026-08-22T01:00:00Z' }],
    });

    const outcome = await screen.findByTestId('task-outcome');
    fireEvent.click(await screen.findByRole('button', { name: '下载' }));

    await waitFor(() => {
      expect(within(outcome).getByRole('button', { name: '下载' })).toBeEnabled();
    });
    expect(hit).toBe(0);
    // 终态卡里唯一的 role=alert 只可能是下载错误（成功调性的标题是 role=status）。
    expect(within(outcome).queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ⑤ 刷新恢复（列表是权威来源）+ 续接
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 刷新恢复与续接', () => {
  it('刷新恢复：持久化的 taskId 经列表校验后直接进输出面板并重新订阅（不重新拉全量输出）', async () => {
    // 「刷新后」的初始条件：store 里还有 taskId，内存里没有任何输出。
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([taskDto({ status: 'running' })]);
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    // 恢复靠的是 subscribe（内存空 ⇒ 不带 fromSeq，请后端从头回放），不是 REST 全量。
    expect(latestSocket().emitted).toEqual([{ type: 'subscribe', taskId: 'task-1' }]);

    emitEvent(1, 'agent-message', { text: '回放的历史输出' });
    expect(await screen.findByText('回放的历史输出')).toBeInTheDocument();
  });

  it('刷新恢复：已结束的任务重新订阅后由**补发的 exit 帧**还原终态（不从 DTO 反推）', async () => {
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([taskDto({ status: 'failed', exitCode: 2, sessionRef: 'sess-9' })]);
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    // DTO 里明明写着 failed/exitCode 2，但终态卡在 exit 帧到达前不出现——单一真相源是流。
    expect(screen.queryByTestId('task-outcome')).not.toBeInTheDocument();

    emitFrame({ type: 'caught_up', taskId: 'task-1', firstSeq: 1, seq: 0 });
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'failed', exitCode: 2 });

    const outcome = await screen.findByTestId('task-outcome');
    expect(within(outcome).getByTestId('task-exit-code')).toHaveTextContent('2');
  });

  it('列表是权威来源：持久 id 已不在列表里 ⇒ 自动回落到仍在跑的那个任务', async () => {
    useAppStore.getState().setSelectedTaskId('task-gone');
    mockList([
      taskDto({ id: 'newest-running', status: 'running' }),
      taskDto({ id: 'old-done', status: 'succeeded', exitCode: 0 }),
    ]);
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    expect(latestSocket().emitted).toEqual([{ type: 'subscribe', taskId: 'newest-running' }]);
  });

  /**
   * ⚠️ 本轮改判（F21-2 §N.3）：已结束的任务**不自动顶上来**这条不变，但落地形态从
   * "停在发起表单"改成"**只读详情** + [新任务] 入口"。
   *
   * 变异：让详情态也渲染指令 textarea（例如把分叉条件从 `taskId===null && !composing`
   * 改回 `taskId===null`）⇒ 下面「详情态没有指令 textarea」当场变红。
   */
  it('列表里只剩已结束的任务 ⇒ 不自动顶上来，转**只读详情**（不是发起表单）', async () => {
    useAppStore.getState().setSelectedTaskId(null);
    mockList([
      taskDto({
        id: 'old-done',
        status: 'succeeded',
        exitCode: 0,
        finishedAt: '2026-08-22T00:03:21.000Z',
        artifacts: [{ name: 'report.md', size: 2048, modifiedAt: '2026-08-22T00:03:21.000Z' }],
      }),
    ]);
    renderContainer();

    const detail = await screen.findByTestId('headless-task-detail');
    // 只读详情的五格：状态 / 耗时 / 产物 / 退出码（指令后端不回显，就地说明）。
    expect(within(detail).getByTestId('detail-status')).toHaveTextContent('已完成');
    expect(within(detail).getByTestId('detail-exit-code')).toHaveTextContent('0');
    expect(within(detail).getByText(/report\.md/)).toBeInTheDocument();
    expect(within(detail).getByText(/3 分 21 秒/)).toBeInTheDocument();
    expect(within(detail).getByText(/不回显/)).toBeInTheDocument();

    // ① 详情态**没有**指令 textarea（它正是被替换掉的东西）。
    expect(screen.queryByLabelText('任务指令')).not.toBeInTheDocument();
    expect(screen.queryByTestId('task-output-pane')).not.toBeInTheDocument();
    // ② 但 [新任务] 入口**必须在**——一个沙箱多个任务是数据模型本来的样子，
    //    "建完就没有发起入口"会把多任务能力从界面上抹掉。
    expect(screen.getByRole('button', { name: '发起无头运行' })).toBeEnabled();

    // ③ 点它才回到发起表单（表单是被打开的，不是自己出现的）。
    fireEvent.click(screen.getByRole('button', { name: '发起无头运行' }));
    expect(await screen.findByLabelText('任务指令')).toBeInTheDocument();
  });

  it('列表为空（运行已被清理）⇒ 引导态（仍然给 [发起无头运行] 入口）', async () => {
    useAppStore.getState().setSelectedTaskId('task-gone');
    mockList([]);
    renderContainer();

    const detail = await screen.findByTestId('headless-task-detail');
    // 措辞刻意避开裸的"任务"：左侧树的 `项目 · N` 数的是 Sandbox，这里数的是
    // 沙箱内部的无头运行，同名不同物会让两处读数互相打架。
    expect(within(detail).getByText(/这个沙箱还没跑过无头运行/)).toBeInTheDocument();
    expect(screen.queryByLabelText('任务指令')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发起无头运行' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '发起无头运行' }));
    expect(await screen.findByLabelText('任务指令')).toBeInTheDocument();
    // 表单是被打开的 ⇒ 必须有退路（回到引导态）。
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(await screen.findByTestId('headless-task-detail')).toBeInTheDocument();
  });

  it('续接：终态点「接着聊」→ 下一轮请求体带上一轮的 sessionRef', async () => {
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([taskDto({ status: 'succeeded', exitCode: 0, sessionRef: 'sess-9' })]);
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'succeeded', exitCode: 0 });

    fireEvent.click(await screen.findByRole('button', { name: /接着聊/ }));

    const run = mockRun('task-2');
    const textarea = await screen.findByLabelText('任务指令');
    expect(screen.getByText(/sess-9/)).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '再改一处' } });
    fireEvent.click(screen.getByRole('button', { name: /接着跑（续接会话）/ }));

    await waitFor(() => {
      expect(run.body()).toEqual({
        prompt: '再改一处',
        timeoutMinutes: 120,
        resumeFrom: 'sess-9',
        _rt: RUNTIME,
      });
    });
  });

  it('续接：没有 sessionRef ⇒ 按钮禁用并说明原因（不给点了没反应的按钮）', async () => {
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([taskDto({ status: 'failed', exitCode: 1 })]); // 无 sessionRef
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'failed', exitCode: 1 });

    const resume = await screen.findByRole('button', { name: /接着聊/ });
    expect(resume).toBeDisabled();
    expect(screen.getByText(/没有拿到会话引用/)).toBeInTheDocument();
  });

  it('「发起全新任务」⇒ 回到发起入口且不带 resumeFrom（列表也不把它顶回来）', async () => {
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([taskDto({ status: 'succeeded', exitCode: 0, sessionRef: 'sess-9' })]);
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'succeeded', exitCode: 0 });

    fireEvent.click(await screen.findByRole('button', { name: '发起全新任务' }));
    const run = mockRun('task-3');
    const textarea = await screen.findByLabelText('任务指令');
    expect(screen.queryByText(/sess-9/)).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: '全新一轮' } });
    fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));

    await waitFor(() => {
      expect(run.body()).toEqual({ prompt: '全新一轮', timeoutMinutes: 120, _rt: RUNTIME });
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ⑥ 跨任务残留（S6 review ① / ⑧）：本容器所有派生态都钉在 taskId 上
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 跨任务残留', () => {
  /** 跑完第一轮（可选择先点开二次确认），再发起第二轮。返回时停在任务2 的面板上。 */
  async function firstRoundThenSecond(before: () => void): Promise<void> {
    mockRun('task-1');
    renderContainer();
    await launch('第一轮');

    before();

    // 用户没点确认，任务1 **自己跑完了** —— 确认条随 running 一起卸载（但态还在）。
    emitExit('succeeded', 0);
    await screen.findByTestId('task-outcome');

    fireEvent.click(screen.getByRole('button', { name: '发起全新任务' }));
    mockRun('task-2');
    const textarea = await screen.findByLabelText('任务指令');
    fireEvent.change(textarea, { target: { value: '第二轮' } });
    fireEvent.click(screen.getByRole('button', { name: '发起无头任务' }));
    await screen.findByTestId('task-output-pane');
  }

  it('① 二次确认钉在 taskId 上：上一轮的确认态绝不带进下一个任务', async () => {
    await firstRoundThenSecond(() => {
      fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
      expect(screen.getByText(/终止后本轮无法恢复/)).toBeInTheDocument();
    });

    // 任务2 的面板首屏必须是「终止任务」，而不是上一轮残留的「确定终止？」——
    // 后者只要误点一下就掐掉一个刚发起的任务，而二次确认存在的唯一价值就是拦误手。
    expect(await screen.findByRole('button', { name: '终止任务' })).toBeInTheDocument();
    expect(screen.queryByText(/终止后本轮无法恢复/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认终止' })).not.toBeInTheDocument();
  });

  it('⑧ 终止失败的报错同样钉在 taskId 上：不带进下一个任务', async () => {
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () =>
        HttpResponse.json(
          {
            code: 'INVALID_STATE',
            message: '当前状态不允许此操作：任务已结束。',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );

    let sawCancelError = false;
    await firstRoundThenSecond(() => {
      fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
      fireEvent.click(screen.getByRole('button', { name: '确认终止' }));
      sawCancelError = true;
    });
    expect(sawCancelError).toBe(true);

    await waitFor(() => {
      expect(screen.getByTestId('task-output-pane')).toBeInTheDocument();
    });
    expect(screen.queryByText(/当前状态不允许此操作/)).not.toBeInTheDocument();
  });

  it('⑧ 但在**本轮**里，终止失败必须看得见（别把降级做成"永远不显示"）', async () => {
    mockRun('task-1');
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () =>
        HttpResponse.json(
          {
            code: 'INVALID_STATE',
            message: '当前状态不允许此操作：任务已结束。',
            retryable: false,
          },
          { status: 409 },
        ),
      ),
    );
    renderContainer();
    await launch('第一轮');

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    fireEvent.click(screen.getByRole('button', { name: '确认终止' }));

    expect(await screen.findByText(/当前状态不允许此操作/)).toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ⑦ 已结束的任务不许被呈现成"正在强制终止"（S6 review ②）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · DTO 已终态但 exit 未到', () => {
  /** 刷新恢复一个 5 小时前就结束的任务，且 **WS 连不上**（反代 / 口令门 / 网络隔离）。 */
  function restoreFinishedTask(status = 'succeeded'): void {
    useAppStore.getState().setSelectedTaskId('task-1');
    mockList([
      taskDto({
        status,
        exitCode: 0,
        startedAt: '2026-08-21T19:00:00.000Z', // 预算 120min，早就超了
        finishedAt: '2026-08-21T20:00:00.000Z',
      }),
    ]);
    renderContainer();
  }

  it('不显示倒计时与终止入口——DTO 里 status 明明白白，说"正在强制终止"是给了相反的事实', async () => {
    restoreFinishedTask();
    await screen.findByTestId('task-output-pane');

    expect(screen.queryByTestId('task-deadline')).not.toBeInTheDocument();
    expect(screen.queryByText(/已超过硬超时预算/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '终止任务' })).not.toBeInTheDocument();
  });

  it('空态给「正在取回本次结果」，而不是"这个任务没有产生任何输出"', async () => {
    restoreFinishedTask();
    expect(await screen.findByText(/正在取回本次结果/)).toBeInTheDocument();
    expect(screen.queryByText(/没有产生任何输出/)).not.toBeInTheDocument();
  });

  it('终态卡仍然只等 exit 帧（单一真相源没被改坏：不从 DTO 反推退出码）', async () => {
    restoreFinishedTask('failed');
    await screen.findByTestId('task-output-pane');
    expect(screen.queryByTestId('task-outcome')).not.toBeInTheDocument();

    act(() => {
      latestSocket().triggerConnect();
    });
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'failed', exitCode: 2 });
    const outcome = await screen.findByTestId('task-outcome');
    expect(within(outcome).getByTestId('task-exit-code')).toHaveTextContent('2');
  });

  it('仍在跑的任务照旧有倒计时与终止入口（别把降级做成"一律不显示"）', async () => {
    mockRun();
    renderContainer();
    await launch();
    expect(screen.getByTestId('task-deadline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '终止任务' })).toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ⑧ 每秒倒计时不再穿过输出列表（S6 review ⑤①）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 倒计时的重渲成本', () => {
  /** 渲染一轮任务、灌 n 条正文，然后测 20 次「每秒 tick」的耗时（纳秒 → 毫秒）。 */
  async function measureTickCost(n: number): Promise<number> {
    cleanup();
    sockets = [];
    useAppStore.getState().setSelectedTaskId(null);
    mockList([]);
    mockRun();
    renderContainer();
    await launch();

    act(() => {
      const socket = latestSocket();
      for (let i = 1; i <= n; i += 1) {
        socket.serverEmit({
          type: 'event',
          taskId: 'task-1',
          seq: i,
          event: {
            type: 'agent-message',
            timestamp: '2026-08-22T00:00:00.000Z',
            data: { text: `line ${String(i)} ${'x'.repeat(40)}` },
          },
        });
      }
    });
    // 窗口化之后同时渲染的行数只跟**视口**有关、与条目总数无关（F4）。
    const rows = screen.getByTestId('task-output-pane').querySelectorAll('li[data-vrow]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(Math.min(n, VIRTUAL_ROW_BUDGET));
    // 跟随态锚定末尾 ⇒ 最后一条一定在窗口里（"新输出必须看得见"没有被窗口化弄丢）。
    expect(screen.getByTestId('task-output-pane')).toHaveTextContent(`line ${String(n)} `);

    // ⚠️ 计时必须用**真实**时钟：假定时器把 Date / performance / hrtime 全接管了，
    // 用它们量出来的只会是"我们让假时钟走了多少毫秒"（恒等于 20000）。
    const started = vi.getRealSystemTime();
    for (let tick = 0; tick < 20; tick += 1) {
      // 每次 tick 单独 act ⇒ 单独一次提交，不被批处理成一次。
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    return vi.getRealSystemTime() - started;
  }

  it('tick 成本与条目数**无关**：倒计时是叶子，不穿过 items.map', async () => {
    const small = await measureTickCost(5);
    const large = await measureTickCost(2000);

    // 倒计时住在容器里时，每次 tick 都要把 2000 条重新走一遍 reconcile（实测 20 次 tick
    // 从 ~0ms 涨到 ~58ms）。抽成叶子之后 tick 根本不进输出面板，两者同量级。
    // 阈值 5 倍 + 一个绝对下限吸收 jsdom 噪声：修好时余量 ~20×，改坏时超出 ~2.3×。
    expect(large).toBeLessThan(Math.max(small, 2) * 5);
  });
});

// ————————————————————————————————————————————————————————————————
// ⑨ 自动滚动跟随（S6 review ⑨）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 输出跟随底部', () => {
  /** jsdom 没有布局：手动给滚动容器安上可读写的几何属性。 */
  function instrumentScroll(): { top: () => number; setTop: (v: number) => void } {
    const el = screen.getByTestId('task-output-scroll');
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    return { top: () => scrollTop, setTop: (v) => (scrollTop = v) };
  }

  it('贴着底部时新输出自动滚进视口（跑 4 小时的任务不能让新输出落在视口外）', async () => {
    mockRun();
    renderContainer();
    await launch();
    const scroll = instrumentScroll();

    emitEvent(1, 'agent-message', { text: '第一批输出' });

    expect(scroll.top()).toBe(1000);
  });

  it('用户主动上翻 ⇒ 停止跟随并给「回到底部」（不把人拽回去）', async () => {
    mockRun();
    renderContainer();
    await launch();
    const scroll = instrumentScroll();

    emitEvent(1, 'agent-message', { text: 'a' });
    // 用户往上翻到中间。
    scroll.setTop(100);
    fireEvent.scroll(screen.getByTestId('task-output-scroll'));

    emitEvent(2, 'agent-message', { text: 'b' });

    expect(scroll.top()).toBe(100);
    const back = await screen.findByRole('button', { name: /回到底部/ });

    fireEvent.click(back);
    expect(scroll.top()).toBe(1000);
    expect(screen.queryByRole('button', { name: /回到底部/ })).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// ⑩ 破坏性操作的键盘 / 读屏可达性（S6 review ⑩）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 终止确认的可达性', () => {
  it('确认文案被播报、焦点落在「确认终止」上（原按钮已被卸载，焦点不能掉回 body）', async () => {
    mockRun();
    renderContainer();
    await launch();

    const trigger = screen.getByRole('button', { name: '终止任务' });
    trigger.focus();
    fireEvent.click(trigger);

    const confirm = screen.getByRole('button', { name: '确认终止' });
    expect(document.activeElement).toBe(confirm);
    expect(document.activeElement).not.toBe(document.body);
    // 读屏必须播报这句话：这是全页唯一该抢播的一次性破坏性确认。
    expect(screen.getByRole('alert')).toHaveTextContent(/终止后本轮无法恢复/);
  });

  it('Esc 撤销确认，并把焦点还给「终止任务」按钮', async () => {
    mockRun();
    let cancelHit = 0;
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () => {
        cancelHit += 1;
        return HttpResponse.json(taskDto(), { status: 202 });
      }),
    );
    renderContainer();
    await launch();

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '确认终止' }), { key: 'Escape' });

    const trigger = await screen.findByRole('button', { name: '终止任务' });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    expect(cancelHit).toBe(0);
  });

  it('鼠标取消后焦点同样回到原按钮', async () => {
    mockRun();
    renderContainer();
    await launch();

    fireEvent.click(screen.getByRole('button', { name: '终止任务' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    const trigger = await screen.findByRole('button', { name: '终止任务' });
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});

// ————————————————————————————————————————————————————————————————
// ⑪ 终态即终点：不再由重连驱动的 REST 轮询（S6 review ③ 的端到端口径）
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 终态后的重连与 refetch', () => {
  it('exit 之后掉线 ⇒ 不再建连接、也不再多打一次 GET /tasks', async () => {
    let listHits = 0;
    let tasks = [taskDto({ status: 'running' })];
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () => {
        listHits += 1;
        return HttpResponse.json(tasks);
      }),
    );
    useAppStore.getState().setSelectedTaskId('task-1');
    renderContainer();

    await screen.findByTestId('task-output-pane');
    act(() => {
      latestSocket().triggerConnect();
    });
    const afterMount = listHits;

    // 终态：产物列表只有终态才齐 ⇒ 这一次 refetch 是**事件驱动**的，合理。
    tasks = [taskDto({ status: 'succeeded', exitCode: 0 })];
    emitFrame({ type: 'exit', taskId: 'task-1', status: 'succeeded', exitCode: 0 });
    await waitFor(() => {
      expect(listHits).toBe(afterMount + 1);
    });

    // 掉线。老写法会重连 → 重发 subscribe → 后端补发 exit → 又一次 refetch，
    // 网络不稳时这就是一个由重连驱动的 REST 轮询器（与"零轮询"纪律直接冲突）。
    act(() => {
      latestSocket().triggerDisconnect();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(sockets).toHaveLength(1);
    expect(listHits).toBe(afterMount + 1);
  });
});

// ————————————————————————————————————————————————————————————————
// ⑪ 事件流断开后的出路（S6 收尾 ③ 补项）
// 界面告诉用户"断了"却不给任何办法 = 终端上刚修掉的那个死按钮的同一种病。
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 事件流断开后的「重新连接」', () => {
  /** 一轮"连上即掉"。抖动型故障才让退避真的增长、真的撞到上限。 */
  function flap(): void {
    act(() => {
      latestSocket().triggerConnect();
    });
    act(() => {
      latestSocket().triggerDisconnect();
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
  }

  /** 抖到停手（默认 maxReconnect=8）。 */
  function exhaustBackoff(): void {
    for (let i = 0; i < 9; i += 1) flap();
  }

  it('退避耗尽 ⇒ 面板给出「重新连接」入口（不是只丢一句"输出停止更新"）', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitEvent(1, 'agent-message', { text: '看了很久的输出' });

    exhaustBackoff();

    const note = await screen.findByText(/事件流已断开/);
    expect(note).toHaveTextContent('已停止自动重连');
    expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
  });

  it('⚠️ 点「重新连接」⇒ 真的再连一条，且**已渲染的输出原样保留**、按 fromSeq 续订', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitEvent(1, 'agent-message', { text: '看了很久的输出' });

    exhaustBackoff();
    const built = sockets.length;

    fireEvent.click(await screen.findByRole('button', { name: '重新连接' }));

    expect(sockets).toHaveLength(built + 1);
    act(() => {
      latestSocket().triggerConnect();
    });
    // 续播而不是重来：带 fromSeq=1。
    expect(latestSocket().emitted).toEqual([{ type: 'subscribe', taskId: 'task-1', fromSeq: 1 }]);
    // 那一屏输出还在（把面板清空重订才是最坏的做法）。
    expect(screen.getByText('看了很久的输出')).toBeInTheDocument();

    // 续上的新事件接在老的后面。
    emitEvent(2, 'agent-message', { text: '续上的新输出' });
    expect(screen.getByText('续上的新输出')).toBeInTheDocument();
  });

  it('重连成功后断开提示消失（别把红条留在屏幕上）', async () => {
    mockRun();
    renderContainer();
    await launch();
    exhaustBackoff();

    fireEvent.click(await screen.findByRole('button', { name: '重新连接' }));
    act(() => {
      latestSocket().triggerConnect();
    });

    expect(screen.queryByText(/事件流已断开/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
  });

  it('终态之后不出现断开提示与重连入口（那条流本就该收尾，不是故障）', async () => {
    mockRun();
    renderContainer();
    await launch();
    emitExit('succeeded', 0);

    act(() => {
      latestSocket().triggerDisconnect();
    });

    expect(screen.queryByText(/事件流已断开/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
  });
});

// ————————————————————————————————————————————————————————————————
// F4 输出列表虚拟化。
//
// 实测账（S6 之后量的）：20000 条正文帧纯 reducer 274ms（`[...items]` 每帧 O(n) ⇒ 总体 O(n²)）；
// 5000 条时 DOM **10006 个节点**，再来一条事件重渲 **34ms**。`MAX_STREAM_ITEMS = 5000` 只保证不 OOM。
//
// 本组用例的分工：
//  ① 虚拟化**确实生效**（退回全量渲染就红）——这是变异证明的那一条；
//  ②③④ 虚拟化**没改坏**既有的四件事：自动跟随、「回到底部」、折叠块展开态、错误高亮 / 各种提示条。
// ————————————————————————————————————————————————————————————————
describe('HeadlessTaskContainer · 输出列表虚拟化（F4）', () => {
  /** jsdom 没有布局：给滚动容器安上可读写的几何属性（与「跟随底部」那组同一手法）。 */
  function instrumentScroll(): { setTop: (v: number) => void; scrollTop: () => number } {
    const el = screen.getByTestId('task-output-scroll');
    let scrollTop = 0;
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 100_000 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    return { setTop: (v) => (scrollTop = v), scrollTop: () => scrollTop };
  }

  function renderedRows(): HTMLElement[] {
    return Array.from(
      screen.getByTestId('task-output-pane').querySelectorAll<HTMLElement>('li[data-vrow]'),
    );
  }

  /** 一次性灌 n 条正文（单个 act ⇒ 一次提交，接近真实的批量回放）。 */
  function floodMessages(n: number, from = 1): void {
    act(() => {
      const socket = latestSocket();
      for (let i = from; i < from + n; i += 1) {
        socket.serverEmit({
          type: 'event',
          taskId: 'task-1',
          seq: i,
          event: {
            type: 'agent-message',
            timestamp: '2026-08-22T00:00:00.000Z',
            data: { text: `line ${String(i)} ${'x'.repeat(40)}` },
          },
        });
      }
    });
  }

  it('① 3000 条输出只渲染一屏的行，且占位把完整高度还给滚动容器（退回全量渲染即红）', async () => {
    mockRun();
    renderContainer();
    await launch();
    floodMessages(3000);

    const rows = renderedRows();
    // 判据一：DOM 行数与条目总数**解耦**。没有窗口化时这里就是 3000。
    expect(rows.length).toBeLessThanOrEqual(VIRTUAL_ROW_BUDGET);
    expect(rows.length).toBeGreaterThan(0);

    // 判据二：省下来的高度必须**还回去**，否则滚动条会缩成一小截、拖到底也看不到 3000 条那么多内容。
    const spacer = screen.getByTestId('virtual-top-spacer');
    const spacerPx = Number.parseFloat(spacer.style.height);
    expect(spacerPx).toBeGreaterThan(3000 * 20 * 0.8);

    // 判据三：占位不进无障碍活区，读屏不会念出一段空白。
    expect(spacer).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('log', { name: '任务输出' })).toBeInTheDocument();
  });

  it('②a 跟随态下窗口锚定**末尾**：最新一条一定在 DOM 里，很早的那些不在', async () => {
    mockRun();
    renderContainer();
    await launch();
    instrumentScroll();
    floodMessages(1000);

    const pane = screen.getByTestId('task-output-pane');
    expect(pane).toHaveTextContent('line 1000 ');
    // 早期条目已被移出窗口（这正是"省"下来的那部分）。
    expect(pane).not.toHaveTextContent('line 1 x');
  });

  it('②b 新输出到达仍然自动滚进视口（跑 4 小时的任务不能让新输出落在视口外）', async () => {
    mockRun();
    renderContainer();
    await launch();
    const scroll = instrumentScroll();
    floodMessages(500);

    // useFollowOutput 照旧把 scrollTop 顶到 scrollHeight —— 占位让 scrollHeight 仍是完整高度。
    expect(scroll.scrollTop()).toBe(100_000);
    expect(screen.getByTestId('task-output-pane')).toHaveTextContent('line 500 ');
  });

  it('③ 用户上翻 ⇒ 停止跟随、窗口改按 scrollTop 算，「回到底部」把两者一起复位', async () => {
    mockRun();
    renderContainer();
    await launch();
    const scroll = instrumentScroll();
    floodMessages(1000);

    // 翻到最顶上。
    scroll.setTop(0);
    fireEvent.scroll(screen.getByTestId('task-output-scroll'));

    const pane = screen.getByTestId('task-output-pane');
    // 窗口跟着滚动位置走：现在看得见开头，看不见末尾。
    expect(pane).toHaveTextContent('line 1 x');
    expect(pane).not.toHaveTextContent('line 1000 ');
    // 顶部占位归零、底部占位承接剩下的高度（否则往下拖就没内容了）。
    expect(screen.queryByTestId('virtual-top-spacer')).not.toBeInTheDocument();
    expect(screen.getByTestId('virtual-bottom-spacer')).toBeInTheDocument();

    const back = await screen.findByRole('button', { name: /回到底部/ });
    fireEvent.click(back);

    expect(scroll.scrollTop()).toBe(100_000);
    expect(screen.queryByRole('button', { name: /回到底部/ })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('task-output-pane')).toHaveTextContent('line 1000 ');
    });
  });

  it('④ 工具折叠块的展开态**跨窗口存活**：滚出去再滚回来，它还是展开的', async () => {
    mockRun();
    renderContainer();
    await launch();
    const scroll = instrumentScroll();

    // 第 1 条就是一次工具调用，随后灌一大堆正文把它挤出窗口。
    emitEvent(1, 'tool-call', {
      id: 'c1',
      name: 'read_file',
      status: 'started',
      input: { path: 'src/app/page.tsx' },
    });
    const details = screen
      .getByTestId('task-output-pane')
      .querySelector<HTMLDetailsElement>('li[data-kind="tool"] details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);

    // 用户展开它（<details> 的展开是 DOM 态；窗口化会卸载这一行——这就是本用例要盯的那件事）。
    act(() => {
      if (details !== null) {
        details.open = true;
        fireEvent(details, new Event('toggle', { bubbles: false }));
      }
    });
    expect(screen.getByText('入参')).toBeInTheDocument();

    floodMessages(1000, 2);
    // 已经被移出窗口（证明这确实是一次真正的卸载，而不是"恰好还在 DOM 里"的假绿）。
    expect(screen.getByTestId('task-output-pane').querySelector('li[data-kind="tool"]')).toBeNull();

    // 翻回顶部让它重新挂载。
    scroll.setTop(0);
    fireEvent.scroll(screen.getByTestId('task-output-scroll'));

    const remounted = screen
      .getByTestId('task-output-pane')
      .querySelector<HTMLDetailsElement>('li[data-kind="tool"] details');
    expect(remounted).not.toBeNull();
    expect(remounted?.open).toBe(true);
    expect(screen.getByText('入参')).toBeInTheDocument();
  });

  it('⑤ 错误高亮与 seq 告警不受窗口化影响（前者随窗口渲染，后者本来就在列表之外）', async () => {
    mockRun();
    renderContainer();
    await launch();
    instrumentScroll();

    floodMessages(300);
    // 制造一个 seq 缺口，并让最后一条是错误项（跟随态 ⇒ 它一定在窗口里）。
    emitEvent(400, 'error', { message: '运行时报了一个错' });

    const pane = screen.getByTestId('task-output-pane');
    const errorRow = pane.querySelector<HTMLElement>('li[data-kind="error"]');
    expect(errorRow).not.toBeNull();
    expect(errorRow?.className).toContain('text-red-400');

    // 告警条是滚动容器的**兄弟**，不在被窗口化的 <ul> 里 ⇒ 永远不会被"滚没了"。
    const anomaly = screen.getByText(/事件序号出现缺口/);
    expect(screen.getByTestId('task-output-scroll').contains(anomaly)).toBe(false);
  });
});
