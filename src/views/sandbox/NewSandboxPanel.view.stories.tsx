import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NewSandboxPanelView } from '@/views/sandbox/NewSandboxPanel.view';
import type { SandboxProviderCapabilities, SandboxProviderDto } from '@/types/sandbox';

const noop = (): void => undefined;

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
    providers: PROVIDERS,
    onSelectProvider: noop,
    onCreate: noop,
    onRetryProviders: noop,
    creating: false,
    loadingProviders: false,
    initialPrompt: '',
    onInitialPromptChange: noop,
  },
};
export default meta;

type Story = StoryObj<typeof NewSandboxPanelView>;

export const DefaultAio: Story = { args: { provider: 'aio' } };
export const BoxliteSelected: Story = { args: { provider: 'boxlite' } };
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
/** 8000 上限：超限就地红字计数 + 禁用发起（P21-2 §6）。 */
export const InitialPromptTooLong: Story = {
  args: { provider: 'aio', initialPrompt: 'x'.repeat(8001) },
};
/**
 * 「零副作用」的 409 能力静态校验拒绝：请求在落库前被拒，**没有任务被创建** ⇒
 * 就地提示改选，界面上不出现任何"重试/重新创建"入口（对照 CreateError 那条已落库的失败）。
 */
export const CapabilityRejected: Story = {
  args: {
    provider: 'boxlite',
    rejectionMessage:
      '无法用当前配置创建：provider boxlite 不支持 snapshot。请改选运行档位或调整能力要求后再试（本次请求未创建任何任务）。',
  },
};
