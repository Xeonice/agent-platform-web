import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TaskImageMenuView } from '@/views/sandbox/TaskImageMenu.view';
const meta = {
  title: 'sandbox/TaskImageMenu',
  component: TaskImageMenuView,
  args: { imageLabel: 'ghcr.io/agent-infra/sandbox:latest（平台预制镜像）' },
} satisfies Meta<typeof TaskImageMenuView>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
