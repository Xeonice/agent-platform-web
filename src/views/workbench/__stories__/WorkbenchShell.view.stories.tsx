import type { Meta, StoryObj } from '@storybook/nextjs-vite';
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
