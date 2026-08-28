import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
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

/**
 * 起实例、且**本机第一次用这个镜像**：`sandbox.instance_progress` 的 `imageStaged:false`。
 *
 * 这就是那次「停在启动实例 3 分 10 秒、用户判它卡死」的真实场景——审计流事后显示
 * `starting` 段 190529ms，其中 190 秒全在 provider 起实例那一步（13GB 镜像现拉 + 铺 rootfs）。
 * 计时串由**前端自己**从收到 `starting` 的那一刻数出来，后端一个耗时字段都不推。
 */
export const ColdImagePull: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    taskName: '分析这个仓库的架构并输出…',
    activeElapsedLabel: '3:10',
    phaseNote: {
      phaseKey: 'instance',
      text: '本机还没有这个镜像，正在下载并铺开运行环境…（首次使用可能持续数分钟，期间没有输出，不是卡死）',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 计时只挂**进行中**那一格：四格里恰好一处，不是每格一个。把视图里的
    // `state === 'active'` 去掉会当场变成 4。
    await expect(canvas.getAllByTestId('phase-elapsed')).toHaveLength(1);
    await expect(canvas.getByTestId('phase-elapsed')).toHaveTextContent('3:10');
    await expect(canvas.getByTestId('phase-note-instance')).toHaveTextContent('不是卡死');
  },
};

/** 镜像已在本机：只陈述事实，**不承诺"几秒就好"**（见 instanceStartupCopy 的注释）。 */
export const WarmImage: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    activeElapsedLabel: '0:04',
    phaseNote: { phaseKey: 'instance', text: '镜像已在本机，正在拉起实例…' },
  },
};

/**
 * 刷新恢复出来的启动中状态：**没有计时**。
 *
 * DTO 上没有「何时进入这个状态」的时间戳，所以此刻从 0 数会给出一个看起来精确、实际上
 * 是编的数字。宁可不显示——这一格因此只有标签，没有右侧那串。
 */
export const NoElapsedAnchorAfterRefresh: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    statusLabel: 'starting',
    phaseNote: { phaseKey: 'instance', text: '正在拉起实例…' },
  },
  play: async ({ canvasElement }) => {
    // 拿不到锚点就**一格都不显示**计时。视图不许兜底成 `0:00`——那会把
    // 「不知道等了多久」渲染成「刚开始等」。
    await expect(within(canvasElement).queryAllByTestId('phase-elapsed')).toHaveLength(0);
  },
};
