import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { fn } from 'storybook/test';
import { CommandPaletteView } from '@/views/workbench/CommandPalette.view';
import type { CommandSection } from '@/types/command';

const sections: CommandSection[] = [
  {
    group: '需要你处理',
    items: [
      {
        id: 'attention',
        name: '运行回归测试',
        description: '任务异常 · acme-web',
        group: '需要你处理',
        execute: fn(),
      },
    ],
  },
  {
    group: '项目',
    items: [
      { id: 'project', name: 'acme-web', description: '3 个任务', group: '项目', execute: fn() },
    ],
  },
  { group: '前往', items: [{ id: 'images', name: '镜像管理', group: '前往', execute: fn() }] },
  {
    group: '动作',
    items: [
      { id: 'new-task', name: '新任务…', group: '动作', execute: fn() },
      { id: 'clear', name: '清屏', group: '动作', disabledReason: '当前没有终端', execute: fn() },
    ],
  },
];

const meta = {
  title: 'Workbench/CommandPalette',
  component: CommandPaletteView,
  parameters: { layout: 'fullscreen' },
  args: {
    query: '',
    sections,
    activeId: 'attention',
    onQueryChange: fn(),
    onActiveChange: fn(),
    onExecute: fn(),
    onKeyDown: fn(),
    onClose: fn(),
    onCloseAutoFocus: fn(),
  },
} satisfies Meta<typeof CommandPaletteView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllGroups: Story = {};
export const MatchingTasks: Story = {
  args: {
    query: '回归',
    activeId: 'regression',
    sections: [
      {
        group: '任务',
        items: [
          {
            id: 'regression',
            name: '运行回归测试',
            description: 'acme-web',
            group: '任务',
            execute: fn(),
          },
          {
            id: 'docs-regression',
            name: '文档站回归测试',
            description: 'docs-site',
            group: '任务',
            execute: fn(),
          },
        ],
      },
    ],
  },
};
export const NoResults: Story = { args: { query: '不存在的关键词', sections: [], activeId: null } };
export const DisabledAction: Story = {
  args: {
    query: '新任务',
    activeId: 'new-task',
    sections: [
      {
        group: '动作',
        items: [
          {
            id: 'new-task',
            name: '新任务…',
            group: '动作',
            disabledReason: '先新建一个项目',
            execute: fn(),
          },
        ],
      },
    ],
  },
};
