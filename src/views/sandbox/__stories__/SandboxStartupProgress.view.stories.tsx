import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';

const PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'workspace', label: '准备代码副本' },
  { key: 'image', label: '创建运行环境' },
  { key: 'instance', label: '启动运行环境' },
] as const;
const meta: Meta<typeof SandboxStartupProgressView> = {
  title: 'Sandbox/StartupProgress',
  component: SandboxStartupProgressView,
  parameters: { layout: 'fullscreen' },
  args: { phases: PHASES, percent: null, onCheck: fn(), onContinue: fn() },
};
export default meta;
type Story = StoryObj<typeof SandboxStartupProgressView>;
export const Init: Story = { args: { activeIndex: 0, dataStatus: 'pending' } };
export const CreatingEnvironment: Story = { args: { activeIndex: 2, dataStatus: 'creating' } };
export const Workspace: Story = { args: { activeIndex: 1, dataStatus: 'preparing-workspace' } };
export const Starting: Story = {
  args: { activeIndex: 3, dataStatus: 'starting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const item of canvas.getAllByRole('listitem').slice(0, 3))
      await expect(item.querySelector('.lucide-check')).not.toBeNull();
    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  },
};
export const WithTaskName: Story = {
  args: { activeIndex: 3, taskName: '分析这个仓库的架构并输出…' },
};
export const InstallingRuntimeCli: Story = {
  args: {
    activeIndex: 3,
    phaseNote: {
      phaseKey: 'instance',
      text: '正在安装 claude-code 的命令行工具；正在确认安装进展…',
    },
  },
};
export const RuntimeCliReady: Story = {
  args: {
    activeIndex: 3,
    phaseNote: { phaseKey: 'instance', text: 'claude-code 的命令行工具已就绪（2.1.302）' },
  },
};
export const ImagePresenceUnknown: Story = {
  args: {
    activeIndex: 3,
    activeElapsedLabel: '3:10',
    phaseNote: { phaseKey: 'instance', text: '本机尚未找到这个镜像，正在确认运行环境准备情况。' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('phase-elapsed')).toHaveLength(1);
    await expect(canvasElement.textContent).not.toContain('不是卡死');
  },
};
export const WarmImage: Story = {
  args: {
    activeIndex: 3,
    activeElapsedLabel: '0:04',
    phaseNote: { phaseKey: 'instance', text: '本机已有镜像记录，正在准备运行环境…' },
  },
};
export const NoElapsedAnchorAfterRefresh: Story = {
  args: { activeIndex: 3, phaseNote: { phaseKey: 'instance', text: '正在确认运行环境准备情况…' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryAllByTestId('phase-elapsed')).toHaveLength(0);
  },
};
export const RawStatusNeverOnScreen: Story = {
  args: { activeIndex: 1, dataStatus: 'preparing-workspace', subtitle: '正在准备代码副本。' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvasElement.textContent).not.toContain('preparing-workspace');
    await expect(canvas.getByTestId('sandbox-startup-progress')).toHaveAttribute(
      'data-status',
      'preparing-workspace',
    );
  },
};
export const OriginalStartStillExecuting: Story = {
  args: {
    activeIndex: 3,
    headline: '启动请求仍在执行，正在确认结果',
    waitingConfirmation: true,
    activeElapsedLabel: '8:05',
    operationFacts: [
      { label: '原启动请求', value: '仍在执行' },
      { label: '启动已用时间', value: '10:33' },
      { label: '最后实质进展', value: '8:05前' },
    ],
    diagnosticOperationId: 'design-start-cycle',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '检查状态' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '继续等待' })).toBeVisible();
    await expect(canvas.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  },
};
export const OriginalStartResultUnknown: Story = {
  args: {
    ...OriginalStartStillExecuting.args,
    headline: '正在确认原启动请求的结果',
    operationFacts: [
      { label: '原启动请求', value: '已受理，结果待确认' },
      { label: '当前准备阶段', value: '准备阶段待确认' },
    ],
  },
};
