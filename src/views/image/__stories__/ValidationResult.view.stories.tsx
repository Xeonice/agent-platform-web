import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ValidationResultView } from '@/views/image/ValidationResult.view';

const noop = (): void => undefined;

const meta: Meta<typeof ValidationResultView> = {
  title: 'Image/ValidationResult',
  component: ValidationResultView,
  parameters: { layout: 'padded' },
  args: { status: 'valid', onViewRequirements: noop },
};
export default meta;

type Story = StoryObj<typeof ValidationResultView>;

/** ✅ 有效：绿 + 回显本次钉定的 digest（「这个绿勾属于这个 digest，不属于这个 tag」）。 */
export const Valid: Story = {
  args: { pinnedDigestShort: 'sha256:4b17e…a02' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('pinned-digest')).toHaveTextContent('sha256:4b17e…a02');
    // ✅ 态不该出现 [查看镜像要求]——那是 ❌ 的出路。
    await expect(canvas.queryByRole('button', { name: '查看镜像要求' })).toBeNull();
  },
};

/** ⚠️ 警告：可用，但必须给**后果说明**（不裸报技术词，P21-4 §9）。 */
export const Warning: Story = {
  args: {
    status: 'warning',
    pinnedDigestShort: 'sha256:4b17e…a02',
    warnings: ['未预装 claude-code，创建时需现装，实测约 12.5 分钟'],
  },
};

/** ⚠️ 多条警告。 */
export const WarningMultiple: Story = {
  args: {
    status: 'warning',
    warnings: [
      '未预装 claude-code，创建时需现装，实测约 12.5 分钟',
      '镜像体积 4.2 GB，首次拉取较慢',
    ],
  },
};

/**
 * ❌ 无效 —— play：**不回显 digest**（结论都不成立，钉定什么），且必须给 [查看镜像要求] 这条出路
 * （P22 §1：禁止只报错不给动作）。
 */
export const Invalid: Story = {
  args: {
    status: 'invalid',
    pinnedDigestShort: 'sha256:4b17e…a02',
    errors: ['缺少 tmux（平台约定的必须项，2026-08 起由「建议」升为「必须」）'],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('validation-result')).toHaveAttribute('data-status', 'invalid');
    await expect(canvas.queryByTestId('pinned-digest')).toBeNull();
    await expect(canvas.getByRole('button', { name: '查看镜像要求' })).toBeInTheDocument();
  },
};

/** ❌ 多条错误。 */
export const InvalidMultiple: Story = {
  args: {
    status: 'invalid',
    errors: ['缺少 tmux', '镜像 manifest 不可达（401 Unauthorized）', '架构不匹配：仅提供 arm64'],
  },
};
