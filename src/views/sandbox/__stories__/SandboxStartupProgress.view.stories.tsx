import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';

/**
 * 四个展示格。⚠️ 顺序是**面向用户的叙述序**，刻意 ≠ 状态机序（技术上先备工作区再拉镜像/建实例）——
 * 见 lib/sandboxLifecycle 的 STARTUP_PHASES 注释与 P20 §3.3 / F21-2 §6。
 */
const PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'image', label: '拉取镜像' },
  { key: 'workspace', label: '准备工作区' },
  { key: 'instance', label: '启动实例' },
] as const;

const meta: Meta<typeof SandboxStartupProgressView> = {
  title: 'Sandbox/StartupProgress',
  component: SandboxStartupProgressView,
  parameters: { layout: 'fullscreen' },
  args: { phases: PHASES },
};
export default meta;

type Story = StoryObj<typeof SandboxStartupProgressView>;

export const Init: Story = { args: { activeIndex: 0, percent: 20, statusLabel: 'pending' } };
/** `creating` → 「拉取镜像」（展示第 2 格）。 */
export const PullingImage: Story = {
  args: { activeIndex: 1, percent: 60, statusLabel: 'creating' },
};
/** `preparing-workspace` → 「准备工作区」（展示第 3 格，但技术上比 creating 更早，percent 更小）。 */
export const Workspace: Story = {
  args: { activeIndex: 2, percent: 40, statusLabel: 'preparing-workspace' },
};
export const Starting: Story = { args: { activeIndex: 3, percent: 80, statusLabel: 'starting' } };

/** 后端派生的默认任务名（前端不自己从 prompt 派生）。 */
export const WithTaskName: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    taskName: '分析这个仓库的架构并输出…',
  },
};

/**
 * 装 CLI 中：`runtime.install_progress` 的子文案挂在「启动实例」格下。
 * 实测现装 claude-code 可达 753 秒——没有这行字用户会以为卡死。
 */
export const InstallingRuntimeCli: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    taskName: '分析这个仓库的架构并输出…',
    phaseNote: {
      phaseKey: 'instance',
      text: '正在安装 claude-code CLI…（该镜像未预装，现装可能持续十几分钟，不是卡死）',
    },
  },
};

export const RuntimeCliReady: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    phaseNote: { phaseKey: 'instance', text: 'claude-code CLI 已就绪（1.2.3）' },
  },
};
