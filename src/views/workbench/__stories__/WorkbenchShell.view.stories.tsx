import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import type { ProjectGroup } from '@/types/domain';

const groups: ProjectGroup[] = [
  {
    projectId: 'p1',
    projectName: '项目 A',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 2,
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        name: '运行中的任务',
        status: 'running',
        waitingInput: false,
        lastActiveAt: 2,
      },
      {
        id: 't2',
        projectId: 'p1',
        name: '等待你输入的任务',
        status: 'running',
        waitingInput: true,
        lastActiveAt: 1,
      },
    ],
  },
  {
    projectId: 'p2',
    projectName: '项目 B（克隆中）',
    cloneStatus: 'cloning',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
];

const meta: Meta<typeof WorkbenchShellView> = {
  title: 'Workbench/WorkbenchShell',
  component: WorkbenchShellView,
  parameters: { layout: 'fullscreen' },
  /**
   * ⚠️ 这个 `h-screen` 外壳是**替 `app/layout.tsx` 站的位**：壳本身用 `h-full`，高度由根布局
   * 那个 flex 列（横幅 + `min-h-0 flex-1`）给。story 里没有那一层，不套的话整块塌成 0 高。
   */
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof WorkbenchShellView>;

const terminalSlot = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    终端区占位
  </div>
);

export const MultiProject: Story = {
  args: { groups, waitingInputCount: 1, healthLabel: '后端健康：ok（v1.0.0）', terminalSlot },
};

/**
 * ⭐ 任务树状态点接入 `StatusPill` 的极简变体（design-notes.md §4 Phase 3 第 2 条）：
 * 等待输入 → warn dot，运行中 → ok dot。⛔ 不再是文字前缀 🔵。
 *
 * 变异：把 `task.waitingInput ? 'warn' : 'ok'` 写反 ⇒ 本例两句 `data-status` 断言都会红
 * （一个该是 warn 却读到 ok，反之亦然）。
 */
export const TaskTreeStatusDots: Story = {
  args: { groups, waitingInputCount: 1, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const waitingRow = canvas.getByRole('button', { name: /等待你输入的任务/ });
    const runningRow = canvas.getByRole('button', { name: /运行中的任务/ });
    await expect(waitingRow.querySelector('[data-slot="status-dot"]')).toHaveAttribute(
      'data-status',
      'warn',
    );
    await expect(runningRow.querySelector('[data-slot="status-dot"]')).toHaveAttribute(
      'data-status',
      'ok',
    );
  },
};

/**
 * ⭐ 「正常时不渲染」（design-notes.md §1 问题 5 / §4 Phase 3 第 4 条）：`healthLabel: null`
 * ⇒ 顶栏那个 `data-testid="health-label"` 的节点**整个不挂载**，⛔ 不是挂载了一个空字符串。
 */
export const HealthLabelHidden: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('health-label')).toBeNull();
  },
};

/** 异常时才挂载：非空字符串 ⇒ 节点出现，且样式是错误色（不是中性灰）。 */
export const HealthLabelShown: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: '后端不可用', terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const label = canvas.getByTestId('health-label');
    await expect(label).toHaveTextContent('后端不可用');
    await expect(label.className).toContain('text-error');
  },
};

/**
 * ⭐ **空组那句「发起第一个任务 →」必须是可点的**（2026-09-11 修）。
 *
 * 它此前是个 `<p>`，却带着一个 `→` —— 箭头是"这里能点"的承诺，而它点不动。
 * 用户点上去没有任何反应，比不给这句话更糟。
 *
 * ⚠️ 可见文案**刻意不含项目名**（项目名放 `title`）：组头就在上一行，上下文不丢；
 * 含了的话，`getByRole('button', { name: /项目名/ })` 会同时命中组头按钮与这一条，
 * 全仓（含 e2e）按项目名点项目的地方一起变成 strict-mode 二义匹配 ——
 * 与同组「⋯」按钮上那条注释是同一条纪律。
 *
 * MUTATION: 把它改回 `<p>` ⇒ 第一条断言找不到按钮。
 */
export const EmptyGroup: Story = {
  args: {
    groups: [
      {
        projectId: 'p3',
        projectName: '空项目',
        cloneStatus: 'ready',
        collapsed: false,
        taskCount: 0,
        tasks: [],
      },
    ],
    waitingInputCount: 0,
    healthLabel: '正在检查后端…',
    terminalSlot,
    onSelectProject: fn(),
    onNewTask: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cta = canvas.getByRole('button', { name: /发起第一个任务/ });
    // 项目名不进无障碍名（否则与组头按钮撞名），但进 title —— 上下文没丢。
    await expect(cta).toHaveAttribute('title', '在 空项目 中发起第一个任务');
    cta.click();
    // 点它 = 先定归属、再开弹层（弹窗里没有项目下拉）。
    await expect(args.onSelectProject).toHaveBeenCalledWith('p3');
    await expect(args.onNewTask).toHaveBeenCalled();
  },
};

// —— [+ 新任务] 入口（F21-2 §N.1，本轮新增）——
/**
 * 选中了一个就绪项目 ⇒ 入口可点。
 * ⚠️ 这条 story 存在本身就是"新建任务成了一个动作"的证据（§9.1 #1）——
 * 在此之前新建面板只是"沙箱为空"时的兜底渲染，**没有任何入口**。
 */
export const NewTaskEnabled: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    selectedProjectId: 'p1',
  },
};

/**
 * 没有可用的选中项目 ⇒ 入口置灰 + 原因（§9.1 #33：绕过会建出无项目归属的 Task）。
 */
export const NewTaskDisabled: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    newTaskDisabledReason: '先选中一个就绪的项目',
  },
};

/** 弹层插槽：两个「新建」都往这儿渲染，形态对称（§N.0）。 */
export const WithOverlay: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    selectedProjectId: 'p1',
    overlaySlot: (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="rounded-lg border border-border bg-background p-6 text-sm">弹层占位</div>
      </div>
    ),
  },
};
