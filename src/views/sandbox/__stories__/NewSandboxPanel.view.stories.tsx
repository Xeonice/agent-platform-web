import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import type { RuntimeDto } from '@/types/runtimeCredential';
import type { SandboxProviderCapabilities, SandboxProviderDto } from '@/types/sandbox';

const noop = (): void => undefined;

/**
 * Story fixture：runtime 名单同样只存在于 story/测试里。
 * **取值必须是后端注册表里真实存在的键**（12 §3.4）——`codex` / `claude-code` 出自
 * `api/packages/modules/runtime/src/infrastructure/adapters/{codex,claude-code}`。
 */
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

const RUNTIMES: RuntimeDto[] = [
  runtimeDto({ id: 'codex', displayName: 'Codex', vendor: 'OpenAI' }),
  runtimeDto({ id: 'claude-code', displayName: 'Claude Code', vendor: 'Anthropic' }),
];

// Story fixture：provider 名单只存在于 story/测试里（生产代码不再持有闭集，registry 由服务端下发）。
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
 * ⚠️ **档位不再由用户选**，所以 story 里也不再有「候选名单」——只有**这台宿主选定的那一个**
 * （后端 `GET /api/providers` 里 `isDefault` 的那条）。aio 是 docker 容器、boxlite 是微 VM，
 * 哪个跑得起来是宿主平台的事实（见后端 `hostPreferredProvider()`：macOS→boxlite / Linux→aio）。
 *
 * ⚠️ 这两条**用真名字，就得配真能力位**（12 §3.4）：下面七位逐位抄自后端
 * `aio-sandbox.provider.ts` / `boxlite-sandbox.provider.ts` 里各自声明的 `capabilities`。
 * 此前它们吃 `caps()` 的"默认全开"，于是 story 里的 aio 声称支持 snapshot、boxlite 声称
 * 支持 updateResources 且不支持 headlessTask —— 三位都跟后端相反。story 不参与断言，
 * 所以这种偏差永远不会自己红，只会被下一个人当成事实读走。
 */
const AIO: SandboxProviderDto = {
  name: 'aio',
  capabilities: caps({ snapshot: false, headlessTask: true }),
  isDefault: true,
};
const BOXLITE: SandboxProviderDto = {
  name: 'boxlite',
  capabilities: caps({
    updateResources: false,
    pauseResume: false,
    snapshot: false,
    headlessTask: true,
  }),
  isDefault: true,
};
/** 第三方注册的档位被后端选中：前端零改动即照常工作（不再有"出现在选项里"这回事）。 */
const THIRD_PARTY: SandboxProviderDto = {
  name: 'acme',
  capabilities: caps({ volumeMount: false }),
  isDefault: true,
};

const meta: Meta<typeof NewSandboxPanelView> = {
  title: 'Sandbox/NewSandboxPanel',
  component: NewSandboxPanelView,
  parameters: { layout: 'fullscreen' },
  args: {
    runtimes: RUNTIMES,
    runtime: 'codex',
    onSelectRuntime: noop,
    loadingRuntimes: false,
    onRetryRuntimes: noop,
    hostProvider: AIO,
    onCreate: noop,
    onRetryProviders: noop,
    creating: false,
    loadingProviders: false,
    initialPrompt: '',
    onInitialPromptChange: noop,
    showBranchPicker: true,
    branches: ['main', 'develop', 'feature/x'],
    branch: '',
    onSelectBranch: noop,
    loadingBranches: false,
    projectName: 'ProjectA',
    onCancel: noop,
  },
};
export default meta;

type Story = StoryObj<typeof NewSandboxPanelView>;

/** Linux 宿主：后端选 aio（原生 docker）。 */
export const HostChoseAio: Story = { args: { hostProvider: AIO } };
/** macOS 宿主：后端选 boxlite（Apple Hypervisor.framework，无需 Docker）。 */
export const HostChoseBoxlite: Story = { args: { hostProvider: BOXLITE } };
/** 改选 registry 里的另一个 runtime（前端从未枚举过这两个键，它们来自 GET /api/runtimes）。 */
export const ClaudeCodeRuntime: Story = { args: { runtime: 'claude-code' } };
/**
 * 后端注册表里多一个第三方 runtime → 列表自动多一项（与 provider 同一条扩展性判据，14 §10.3 ①）。
 */
export const ThirdPartyRuntime: Story = {
  args: {
    runtimes: [...RUNTIMES, runtimeDto({ id: 'acme-agent', displayName: 'Acme Agent' })],
    runtime: 'acme-agent',
  },
};
export const LoadingRuntimes: Story = {
  args: { runtimes: [], runtime: '', loadingRuntimes: true },
};
export const RuntimesLoadFailed: Story = {
  args: { runtimes: [], runtime: '', runtimesErrorMessage: 'registry 不可用' },
};
export const EmptyRuntimeRegistry: Story = {
  args: { runtimes: [], runtime: '' },
};
/** 第三方 provider 被后端选中：前端零改动即照常工作（开放注册表的判据）。 */
export const ThirdPartyProvider: Story = {
  args: { hostProvider: THIRD_PARTY },
};
/** capabilities.spawnTty === false → 禁用发起入口并给出原因。 */
export const TtyUnsupported: Story = {
  args: {
    hostProvider: {
      name: 'headless-only',
      capabilities: caps({ spawnTty: false }),
      isDefault: true,
    },
    // ⚠️ 文案不再说「请改选其它运行档位」——档位由宿主决定，用户改不了；
    //    一条指向不存在的操作的提示，比不提示更贵。
    // ⚠️⚠️ 也**不许写 `**无头任务**`**：它渲染在纯文本 `<p>` 里，星号会原样上屏
    //    （全仓没有 markdown 渲染器）。要强调就改句序。
    createDisabledReason:
      '这台机器的沙箱环境开不了终端。' +
      '跑在哪种沙箱环境上是这台机器的事实，不是一个可以在这里改的选项；' +
      '改发无头任务就可以——不开终端，agent 启动就开始执行。',
  },
  play: async ({ canvasElement }) => {
    // ⭐ 屏幕上不许出现字面星号（这条曾经真的上过屏）。
    await expect(canvasElement.textContent).not.toContain('**');
  },
};

/**
 * ⭐ **鉴权闸门在场 ⇒ 按钮禁着，且必须有一句话说清是它在拦**（2026-09-11 修）。
 *
 * `authGateSlot !== undefined` 是 `createDisabled` 的一个分项，而 `createDisabledReason`
 * 只服务 `ttyUnsupported` ⇒ 闸门在场时按钮灰着、底下一句解释都没有。这正是这份面板
 * 自己在 provider 那三档上明令禁止的事（「禁着却不给理由，是最难查的那种 UI」）。
 *
 * MUTATION: 删掉 view 里 `authGateSlot !== undefined` 那段 `<p>` ⇒ 第二条断言红。
 */
export const AuthGateBlocking: Story = {
  args: {
    authGateSlot: <div>（这里是 AuthGateContainer 的登录面板）</div>,
    authGateRuntimeName: 'Claude Code',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '发起任务并打开终端' })).toBeDisabled();
    await expect(canvas.getByTestId('auth-gate-disabled-reason')).toHaveTextContent(
      '先完成上面的 Claude Code 登录，才能发起任务。',
    );
  },
};

/** 拿不到 displayName 时**仍然要说话**——⛔ 宁可少一个名字，也不许一句话都不说。 */
export const AuthGateBlockingWithoutName: Story = {
  args: { authGateSlot: <div>（登录面板）</div> },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('auth-gate-disabled-reason')).toHaveTextContent(
      '先完成上面的 这个 Agent 登录，才能发起任务。',
    );
  },
};
export const LoadingProviders: Story = {
  args: { hostProvider: undefined, loadingProviders: true },
};
export const ProvidersLoadFailed: Story = {
  args: { hostProvider: undefined, providersErrorMessage: 'registry 不可用' },
};
export const EmptyRegistry: Story = { args: { hostProvider: undefined } };
export const Creating: Story = { args: { creating: true } };
export const CreateError: Story = {
  args: { errorMessage: '创建失败：镜像拉取超时' },
};

// —— 任务指令（S5：Task 发起入口）——
/** 填了指令：agent 启动时即执行（不必等用户打开终端）。 */
export const WithInitialPrompt: Story = {
  args: { initialPrompt: '分析这个仓库的架构并输出摘要' },
};
/**
 * **首屏**：runtime 必选、不预选（04 §8：平台没有「默认 runtime」概念）⇒ 一个都没选中、
 * 按钮禁着、就地给一句待办提示。对照 provider 一侧仍按服务端 `isDefault` 预选。
 * 注意这句提示**不是** role="alert"：它是"你还有一步没做"，不是故障。
 */
export const RuntimeUnchosen: Story = {
  args: { runtime: '' },
};

/**
 * **从深链进来的那一份**（F21-2 §2.1）：`/?new=1&project=<id>` 恢复的是「弹窗打开 +
 * 项目上下文」，**不是用户输入** —— 指令是敏感上下文（15 §3.5），既不进 URL 也不进
 * localStorage，刷新必然拿不回来。⛔ 所以要**明说**一句，不许静默：用户看见弹窗还在，
 * 会默认自己写的东西也还在，那比弹窗直接关掉更糟。站内点开时**不传**这个 prop。
 */
export const FromDeepLink: Story = {
  args: { initialPrompt: '', promptNotice: '刷新后指令未保留，请重新输入' },
};

/** 8000 上限：超限就地红字计数 + 禁用发起（P21-2 §6）。 */
export const InitialPromptTooLong: Story = {
  args: { initialPrompt: 'x'.repeat(8001) },
};
/**
 * 「零副作用」的门口拒绝（后端在信封里标 `sideEffectFree`）：请求在落库前被拒，
 * **没有任务被创建** ⇒ 就地提示改配置，界面上不出现任何"重试/重新创建"入口
 *（对照 CreateError 那条已落库的失败）。
 *
 * 两条各一：能力静态校验（409）与非法镜像引用（400）。措辞对两者都成立 ——
 * 这正是尾句从"改选沙箱环境或调整能力要求"泛化成"调整配置"的原因。
 */
export const ZeroSideEffectRejected: Story = {
  args: {
    hostProvider: BOXLITE,
    rejectionMessage:
      '无法用当前配置创建：provider boxlite 不支持 snapshot。请调整配置后再试（本次请求未创建任何任务）。',
  },
};
export const ZeroSideEffectRejectedImageRef: Story = {
  args: {
    rejectionMessage:
      "无法用当前配置创建：invalid image reference 'acme/img:v1 '。请调整配置后再试（本次请求未创建任何任务）。",
  },
};

// —— 分支选择器（F21-2 §N.1，本轮新增）：四态 ——
/** 多分支：缺省项是「跟随项目当前的分支」，选它等于**不传** `branch`。 */
export const BranchesMany: Story = { args: {} };
/** 单分支仓库：照样渲染，缺省项仍在（"只有一条分支"不等于"没有缺省语义"）。 */
export const BranchesSingle: Story = { args: { branches: ['main'] } };
export const BranchesLoading: Story = {
  args: { branches: [], loadingBranches: true },
};
/**
 * **空项目：整块不渲染**（没有 git，谈不上分支）。
 * 这条是否定性行为 —— 结构断言在 `SandboxTerminalContainer.test.tsx`
 *（「空项目不渲染分支选择器」），变异 = 把 `showBranchPicker` 恒置 true。
 */
export const BranchesHiddenForEmptyProject: Story = {
  args: { showBranchPicker: false, branches: [] },
};
/** 分支列表取不到 ⇒ 降级为"用项目当前的分支"，**创建按钮照常可点**（不拦核心链路）。 */
export const BranchesLoadFailed: Story = {
  args: { branches: [], branchesErrorMessage: '读取本地引用失败' },
};
/** 选了非缺省分支：container 会把它填进请求体的 `branch`。 */
export const BranchPicked: Story = { args: { branch: 'feature/x' } };
