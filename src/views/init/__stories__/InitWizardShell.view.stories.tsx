import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { InitWizardShellView } from '@/views/init/InitWizardShell.view';
import type { InitStepKey, InitStepModel } from '@/types/init';

// ⚠️ story 位于 `src/views/` 下，被 boundaries 归类为 `view` 元素 ⇒ **不能 import `lib/`**。
// 所以这里手搭 model（与 `lib/system/initWizardModel.ts::initSteps` 同形），
// 那条派生逻辑自己的用例在 `lib/system/__tests__/initWizardModel.test.ts`。
const ORDER: InitStepKey[] = ['connectivity', 'proxy', 'preset-image', 'resource'];
const LABEL: Record<InitStepKey, string> = {
  connectivity: '出网检测',
  proxy: '代理配置',
  'preset-image': '沙箱镜像',
  resource: '资源确认',
};
function steps(current: InitStepKey, proxyActive: boolean): InitStepModel[] {
  const currentIndex = ORDER.indexOf(current);
  return ORDER.map((key, i) => ({
    key,
    ordinal: i + 1,
    label: LABEL[key],
    active: key === 'proxy' ? proxyActive : true,
    done: i < currentIndex,
    current: key === current,
  }));
}

const meta: Meta<typeof InitWizardShellView> = {
  title: 'Init/InitWizardShell',
  component: InitWizardShellView,
  parameters: { layout: 'fullscreen' },
  args: {
    steps: steps('connectivity', true),
    title: '第 1 步 · 出网可达性',
    description: '平台需要够得着模型 API 与镜像仓库。',
    children: <p>内容插槽</p>,
    onNext: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof InitWizardShellView>;

export const Step1: Story = {};

export const Step2: Story = {
  args: {
    steps: steps('proxy', true),
    title: '第 2 步 · 代理配置',
    description: '上一步有目标不可达。',
    onBack: fn(),
  },
};

export const Step3: Story = {
  args: {
    steps: steps('preset-image', true),
    title: '第 3 步 · 沙箱镜像就绪',
    description: '平台自建的沙箱镜像备齐了没有。',
    onBack: fn(),
    nextLabel: '稍后配置，下一步',
    footerNote: '⚠️ 跳过后平台能进、项目能建，但在镜像就绪之前无法发起任何任务。',
  },
};

/** 出网全通过 ⇒ 代理那一步标「可跳过」而**不隐藏**（步数不跳动）。 */
export const ProxySkippable: Story = {
  args: { steps: steps('connectivity', false) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('init-step-proxy')).toHaveTextContent('可跳过');
  },
};

/**
 * ⭐ **阻塞语义的回归**（F21-8 §2 / §7.2）：向导里没有 [取消]，Esc 也不会触发任何关闭。
 *
 * 这是全局 Esc 分层规则（P20 §8.4）的唯一例外 —— 关掉向导之后没有"回到哪里"，
 * `AppBootGate` 在 `initialized === false` 时压根不挂载工作台。
 */
export const NoCancelNoEscape: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ① DOM 里根本没有取消/关闭。
    await expect(canvas.queryByRole('button', { name: '取消' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: '关闭' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: '✕' })).toBeNull();

    // ② 按 Esc 之后向导仍在（本壳不挂任何 Esc 监听，也不接受 onClose）。
    await userEvent.keyboard('{Escape}');
    await expect(canvas.getByTestId('init-wizard')).toBeInTheDocument();
  },
};
