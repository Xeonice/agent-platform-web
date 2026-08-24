import type { Meta, StoryObj } from '@storybook/nextjs-vite';
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

const PROVIDERS: SandboxProviderDto[] = [
  { name: 'aio', capabilities: caps(), isDefault: true },
  {
    name: 'boxlite',
    capabilities: caps({ pauseResume: false, snapshot: false }),
    isDefault: false,
  },
];

/** 第三方注册进 registry 的档位：前端零改动即出现在选项里。 */
const PROVIDERS_WITH_THIRD_PARTY: SandboxProviderDto[] = [
  ...PROVIDERS,
  { name: 'acme', capabilities: caps({ volumeMount: false }), isDefault: false },
];

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
    providers: PROVIDERS,
    onSelectProvider: noop,
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

export const DefaultAio: Story = { args: { provider: 'aio' } };
export const BoxliteSelected: Story = { args: { provider: 'boxlite' } };
/** 改选 registry 里的另一个 runtime（前端从未枚举过这两个键，它们来自 GET /api/runtimes）。 */
export const ClaudeCodeRuntime: Story = { args: { provider: 'aio', runtime: 'claude-code' } };
/**
 * 后端注册表里多一个第三方 runtime → 列表自动多一项（与 provider 同一条扩展性判据，14 §10.3 ①）。
 */
export const ThirdPartyRuntime: Story = {
  args: {
    runtimes: [...RUNTIMES, runtimeDto({ id: 'acme-agent', displayName: 'Acme Agent' })],
    runtime: 'acme-agent',
    provider: 'aio',
  },
};
export const LoadingRuntimes: Story = {
  args: { runtimes: [], runtime: '', loadingRuntimes: true, provider: 'aio' },
};
export const RuntimesLoadFailed: Story = {
  args: { runtimes: [], runtime: '', runtimesErrorMessage: 'registry 不可用', provider: 'aio' },
};
export const EmptyRuntimeRegistry: Story = {
  args: { runtimes: [], runtime: '', provider: 'aio' },
};
/** 服务端 registry 里多一个第三方 provider → 列表自动多一项（本次扩展性修复的判据）。 */
export const ThirdPartyProvider: Story = {
  args: { providers: PROVIDERS_WITH_THIRD_PARTY, provider: 'acme' },
};
/** capabilities.spawnTty === false → 禁用建沙箱入口并给出原因。 */
export const TtyUnsupported: Story = {
  args: {
    providers: [
      { name: 'headless-only', capabilities: caps({ spawnTty: false }), isDefault: true },
      ...PROVIDERS.map((p) => ({ ...p, isDefault: false })),
    ],
    provider: 'headless-only',
    createDisabledReason:
      'provider「headless-only」不支持终端（spawnTty=false），请改选其它运行档位。',
  },
};
export const LoadingProviders: Story = {
  args: { providers: [], provider: '', loadingProviders: true },
};
export const ProvidersLoadFailed: Story = {
  args: { providers: [], provider: '', providersErrorMessage: 'registry 不可用' },
};
export const EmptyRegistry: Story = { args: { providers: [], provider: '' } };
export const Creating: Story = { args: { provider: 'aio', creating: true } };
export const CreateError: Story = {
  args: { provider: 'aio', errorMessage: '创建失败：镜像拉取超时' },
};

// —— 任务指令（S5：Task 发起入口）——
/** 填了指令：agent 启动时即执行（不必等用户打开终端）。 */
export const WithInitialPrompt: Story = {
  args: { provider: 'aio', initialPrompt: '分析这个仓库的架构并输出摘要' },
};
/**
 * **首屏**：runtime 必选、不预选（04 §8：平台没有「默认 runtime」概念）⇒ 一个都没选中、
 * 按钮禁着、就地给一句待办提示。对照 provider 一侧仍按服务端 `isDefault` 预选。
 * 注意这句提示**不是** role="alert"：它是"你还有一步没做"，不是故障。
 */
export const RuntimeUnchosen: Story = {
  args: { runtime: '', provider: 'aio' },
};

/** 8000 上限：超限就地红字计数 + 禁用发起（P21-2 §6）。 */
export const InitialPromptTooLong: Story = {
  args: { provider: 'aio', initialPrompt: 'x'.repeat(8001) },
};
/**
 * 「零副作用」的门口拒绝（后端在信封里标 `sideEffectFree`）：请求在落库前被拒，
 * **没有任务被创建** ⇒ 就地提示改配置，界面上不出现任何"重试/重新创建"入口
 *（对照 CreateError 那条已落库的失败）。
 *
 * 两条各一：能力静态校验（409）与非法镜像引用（400）。措辞对两者都成立 ——
 * 这正是尾句从"改选运行档位或调整能力要求"泛化成"调整配置"的原因。
 */
export const ZeroSideEffectRejected: Story = {
  args: {
    provider: 'boxlite',
    rejectionMessage:
      '无法用当前配置创建：provider boxlite 不支持 snapshot。请调整配置后再试（本次请求未创建任何任务）。',
  },
};
export const ZeroSideEffectRejectedImageRef: Story = {
  args: {
    provider: 'aio',
    rejectionMessage:
      "无法用当前配置创建：invalid image reference 'acme/img:v1 '。请调整配置后再试（本次请求未创建任何任务）。",
  },
};

// —— 分支选择器（F21-2 §N.1，本轮新增）：四态 ——
/** 多分支：缺省项是「跟随基线当前分支」，选它等于**不传** `branch`。 */
export const BranchesMany: Story = { args: { provider: 'aio' } };
/** 单分支仓库：照样渲染，缺省项仍在（"只有一条分支"不等于"没有缺省语义"）。 */
export const BranchesSingle: Story = { args: { provider: 'aio', branches: ['main'] } };
export const BranchesLoading: Story = {
  args: { provider: 'aio', branches: [], loadingBranches: true },
};
/**
 * **空项目：整块不渲染**（没有 git，谈不上分支）。
 * 这条是否定性行为 —— 结构断言在 `SandboxTerminalContainer.test.tsx`
 *（「空项目不渲染分支选择器」），变异 = 把 `showBranchPicker` 恒置 true。
 */
export const BranchesHiddenForEmptyProject: Story = {
  args: { provider: 'aio', showBranchPicker: false, branches: [] },
};
/** 分支列表取不到 ⇒ 降级为"用基线分支"，**创建按钮照常可点**（不拦核心链路）。 */
export const BranchesLoadFailed: Story = {
  args: { provider: 'aio', branches: [], branchesErrorMessage: '读取本地引用失败' },
};
/** 选了非缺省分支：container 会把它填进请求体的 `branch`。 */
export const BranchPicked: Story = { args: { provider: 'aio', branch: 'feature/x' } };
