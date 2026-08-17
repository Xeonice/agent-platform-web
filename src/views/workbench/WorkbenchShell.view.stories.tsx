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
