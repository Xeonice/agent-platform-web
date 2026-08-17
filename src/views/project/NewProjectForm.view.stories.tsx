import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NewProjectFormView } from '@/views/project/NewProjectForm.view';

const noop = (): void => undefined;

const meta: Meta<typeof NewProjectFormView> = {
  title: 'Project/NewProjectForm',
  component: NewProjectFormView,
  parameters: { layout: 'fullscreen' },
  args: { onSubmit: noop, onCancel: noop },
};
export default meta;

type Story = StoryObj<typeof NewProjectFormView>;

export const Default: Story = { args: { submitting: false } };
export const Submitting: Story = { args: { submitting: true } };
export const CreateError: Story = {
  args: { submitting: false, errorMessage: '创建失败：名称已存在' },
};
