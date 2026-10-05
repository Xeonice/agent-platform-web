import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AppDialogView } from '@/views/common/AppDialog.view';
import { NewProjectFormView } from '@/views/project/NewProjectForm.view';

const noop = (): void => undefined;

const meta: Meta<typeof NewProjectFormView> = {
  title: 'Project/NewProjectForm',
  component: NewProjectFormView,
  parameters: { layout: 'fullscreen' },
  args: { onSubmit: fn(), onCancel: fn() },
  decorators: [
    (Story, context) => (
      <AppDialogView
        title="新建项目"
        subtitle="从 Git 仓库克隆，或创建一个空项目"
        layout="form"
        busy={context.args.submitting}
        onClose={noop}
        testId="storybook-new-project"
      >
        <Story />
      </AppDialogView>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof NewProjectFormView>;

export const Default: Story = {
  args: { submitting: false },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByLabelText('项目名称')).toHaveFocus();
    await expect(body.getByRole('button', { name: '创建项目' })).toBeDisabled();
    await userEvent.type(body.getByLabelText('项目名称'), 'infra-scripts');
    await expect(body.getByRole('button', { name: '创建项目' })).toBeDisabled();
  },
};
export const Submitting: Story = {
  args: { submitting: true, initialName: 'infra-scripts' },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByRole('button', { name: '创建中…' })).toBeDisabled();
    await expect(body.getByRole('button', { name: '取消' })).toBeDisabled();
    await expect(body.getByRole('button', { name: '关闭' })).toBeDisabled();
    await expect(body.getByLabelText('项目名称')).toHaveAttribute('readonly');
  },
};
export const CreateError: Story = {
  args: {
    submitting: false,
    initialName: 'acme-web',
    errorMessage: '项目名已存在，请换一个名称。',
  },
};

// —— 来源 × 分支输入（F21-6 §9.4，本轮新增）——
/**
 * 来源 = Git：出现**分支输入**（`repoBranch` 契约里一直有，表单此前没接）。
 * 留空 = 远端默认分支 —— 不填就不发这个字段。
 */
export const GitSourceWithBranch: Story = {
  args: { submitting: false, initialName: 'infra-scripts' },
  play: async ({ args }) => {
    const body = within(document.body);
    await userEvent.type(body.getByLabelText('仓库地址'), 'https://github.com/acme/infra.git');
    await userEvent.type(body.getByLabelText('分支（可选）'), 'feature/new-ui');
    await userEvent.click(body.getByRole('button', { name: '创建项目' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({
      name: 'infra-scripts',
      sourceType: 'git',
      repoUrl: 'https://github.com/acme/infra.git',
      repoBranch: 'feature/new-ui',
    });
  },
};
/**
 * 来源 = 空项目：仓库地址与分支输入**都不渲染**（没有远端，这两个问题不成立）。
 * 真实创建回归在 `src/acceptance/project-workflows.test.tsx`。
 */
export const EmptySourceHidesBranch: Story = {
  args: { submitting: false, initialSourceType: 'empty', initialName: '未命名项目 1' },
  play: async ({ args }) => {
    const body = within(document.body);
    await expect(body.getByRole('radio', { name: '空项目' })).toBeChecked();
    await expect(body.queryByLabelText('仓库地址')).not.toBeInTheDocument();
    await expect(body.queryByLabelText('分支（可选）')).not.toBeInTheDocument();
    await userEvent.click(body.getByRole('button', { name: '创建项目' }));
    await expect(args.onSubmit).toHaveBeenCalledWith({ name: '未命名项目 1', sourceType: 'empty' });
  },
  parameters: {
    docs: { description: { story: '切到「空项目」后，仓库地址与分支输入同时消失。' } },
  },
};
