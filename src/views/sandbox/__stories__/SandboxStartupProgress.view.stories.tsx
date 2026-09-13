import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SandboxStartupProgressView } from '@/views/sandbox/SandboxStartupProgress.view';

/**
 * 四个展示格。⚠️ 顺序是**面向用户的叙述序**，刻意 ≠ 状态机序（技术上先备代码副本再拉镜像/建运行环境）——
 * 见 lib/sandboxLifecycle 的 STARTUP_PHASES 注释与 P20 §3.3 / F21-2 §6。
 *
 * ⚠️ 标签是**上屏词**：内部的「工作区」「实例」分别叫「代码副本」「运行环境」（P21-1 §9）。
 */
const PHASES = [
  { key: 'init', label: '初始化' },
  { key: 'image', label: '拉取镜像' },
  { key: 'workspace', label: '准备代码副本' },
  { key: 'instance', label: '启动运行环境' },
] as const;

const meta: Meta<typeof SandboxStartupProgressView> = {
  title: 'Sandbox/StartupProgress',
  component: SandboxStartupProgressView,
  parameters: { layout: 'fullscreen' },
  args: { phases: PHASES },
};
export default meta;

type Story = StoryObj<typeof SandboxStartupProgressView>;

export const Init: Story = { args: { activeIndex: 0, percent: 20, dataStatus: 'pending' } };
/** `creating` → 「拉取镜像」（展示第 2 格）。 */
export const PullingImage: Story = {
  args: { activeIndex: 1, percent: 60, dataStatus: 'creating' },
};
/** `preparing-workspace` → 「准备代码副本」（展示第 3 格，但技术上比 creating 更早，percent 更小）。 */
export const Workspace: Story = {
  args: { activeIndex: 2, percent: 40, dataStatus: 'preparing-workspace' },
};
export const Starting: Story = {
  args: { activeIndex: 3, percent: 80, dataStatus: 'starting' },
  /**
   * ⭐ 三种步骤态的字符画（✓/●/○）换成了 lucide 图标：done → `Check`
   * （class `lucide-check`）、active → 实心 `Circle`（`fill-current`）、
   * pending → 空心 `Circle`（同一个组件，不带 fill）。用 class 而不是文字断言，
   * 否则"字符换了图标但类型/填充状态弄反"这类改动照样能骗过纯文本断言。
   */
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const items = canvas.getAllByRole('listitem');
    // 前 3 格（init/image/workspace）已完成 → Check。
    for (const item of items.slice(0, 3)) {
      const icon = item.querySelector('.lucide-check');
      await expect(icon).not.toBeNull();
    }
    // 第 4 格（instance）进行中 → 实心圆点，带 pulse 动画。
    const activeIcon = items[3]?.querySelector('.lucide-circle');
    await expect(activeIcon).not.toBeNull();
    await expect(activeIcon).toHaveClass('fill-current');
    await expect(activeIcon).toHaveClass('animate-pulse');
  },
};

/** 后端派生的默认任务名（前端不自己从 prompt 派生）。 */
export const WithTaskName: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    dataStatus: 'starting',
    taskName: '分析这个仓库的架构并输出…',
  },
};

/**
 * 装 CLI 中：`runtime.install_progress` 的子文案挂在「启动运行环境」格下。
 * 实测现装 claude-code 可达 753 秒——没有这行字用户会以为卡死。
 */
export const InstallingRuntimeCli: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    dataStatus: 'starting',
    taskName: '分析这个仓库的架构并输出…',
    phaseNote: {
      phaseKey: 'instance',
      text: '正在安装 claude-code 的命令行工具…（这张镜像里没有预装它，现装可能要十几分钟，不是卡死）',
    },
  },
};

export const RuntimeCliReady: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    dataStatus: 'starting',
    phaseNote: { phaseKey: 'instance', text: 'claude-code 的命令行工具已就绪（1.2.3）' },
  },
};

/**
 * 起运行环境、且**本机第一次用这个镜像**：`sandbox.instance_progress` 的 `imageStaged:false`。
 *
 * 这就是那次「停在启动运行环境 3 分 10 秒、用户判它卡死」的真实场景——审计流事后显示
 * `starting` 段 190529ms，其中 190 秒全在 provider 起实例那一步（13GB 镜像现拉 + 铺 rootfs）。
 * 计时串由**前端自己**从收到 `starting` 的那一刻数出来，后端一个耗时字段都不推。
 */
export const ColdImagePull: Story = {
  args: {
    activeIndex: 3,
    percent: 80,
    dataStatus: 'starting',
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
    dataStatus: 'starting',
    activeElapsedLabel: '0:04',
    phaseNote: { phaseKey: 'instance', text: '镜像已在本机，正在启动运行环境…' },
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
    dataStatus: 'starting',
    phaseNote: { phaseKey: 'instance', text: '正在启动运行环境…' },
  },
  play: async ({ canvasElement }) => {
    // 拿不到锚点就**一格都不显示**计时。视图不许兜底成 `0:00`——那会把
    // 「不知道等了多久」渲染成「刚开始等」。
    await expect(within(canvasElement).queryAllByTestId('phase-elapsed')).toHaveLength(0);
  },
};

/**
 * ⭐ **原始 status 只进 `data-status`，⛔ 不上屏**（2026-09-11 修）。
 *
 * 它此前叫 `statusLabel` 并被拼进副标题 ⇒ 用户看到的是
 * 「首次使用这个镜像…（preparing-workspace）」—— 一个后端状态机的内部名字。
 * P22 §6 把这类东西划到"只进日志与 data 属性"那一层。
 *
 * MUTATION: 把 `dataStatus` 拼回副标题 ⇒ 本条第一句断言当场红。
 */
export const RawStatusNeverOnScreen: Story = {
  args: {
    activeIndex: 2,
    percent: 40,
    dataStatus: 'preparing-workspace',
    subtitle: '首次使用这个镜像，要先把它拉到本机 —— 整个启动里这一步最久',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 屏幕上一个字的 `preparing-workspace` 都不该有。
    await expect(canvasElement.textContent).not.toContain('preparing-workspace');
    // 但排障/e2e 仍然取得到。
    await expect(canvas.getByTestId('sandbox-startup-progress')).toHaveAttribute(
      'data-status',
      'preparing-workspace',
    );
    // 副标题照常渲染（去掉的只是那个括号里的原始 status）。
    await expect(canvas.getByText(/整个启动里这一步最久/)).toBeInTheDocument();
  },
};
