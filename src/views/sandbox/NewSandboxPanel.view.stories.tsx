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
