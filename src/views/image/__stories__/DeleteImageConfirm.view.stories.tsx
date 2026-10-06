import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DeleteImageConfirmView } from '@/views/image/DeleteImageConfirm.view';
const meta: Meta<typeof DeleteImageConfirmView> = {
  title: 'Image/DeleteImageConfirm',
  component: DeleteImageConfirmView,
  args: {
    reference: 'docker.io/acme/ml-agent:v1.0',
    version: 'sha256:8e05…d77',
    isActive: true,
    envCount: 3,
    secretCount: 1,
    loading: false,
    busy: false,
    preview: {
      canDelete: true,
      tasks: [],
      versions: [{ id: 'current', version: 'v1.0', digest: 'sha256:8e05d77', isActive: true }],
    },
  },
};
export default meta;
type Story = StoryObj<typeof DeleteImageConfirmView>;
export const Deletable: Story = {};
export const Blocked: Story = {
  args: {
    preview: {
      canDelete: false,
      tasks: [
        {
          id: 'task-1',
          name: '整理 API',
          projectId: 'project-1',
          projectName: '示例 API 项目',
          status: 'stopped',
        },
      ],
      versions: [],
    },
  },
};
export const Loading: Story = { args: { preview: undefined, loading: true } };
export const Failed: Story = { args: { preview: undefined, error: '清单读不到，请重试。' } };
