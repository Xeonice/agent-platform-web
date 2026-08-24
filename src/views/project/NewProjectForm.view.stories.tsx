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

// —— 来源 × 分支输入（F21-6 §9.4，本轮新增）——
/**
 * 来源 = Git：出现**分支输入**（`repoBranch` 契约里一直有，表单此前没接）。
 * 留空 = 远端默认分支 —— 不填就不发这个字段。
 */
export const GitSourceWithBranch: Story = { args: { submitting: false } };
/**
 * 来源 = 空项目：仓库地址与分支输入**都不渲染**（没有远端，这两个问题不成立）。
 * 否定性断言在 `WorkbenchContainer.test.tsx`，变异 = 把分支输入的渲染条件改成恒真。
 */
export const EmptySourceHidesBranch: Story = {
  args: { submitting: false },
  parameters: {
    docs: { description: { story: '切到「空项目」后，仓库地址与分支输入同时消失。' } },
  },
};
