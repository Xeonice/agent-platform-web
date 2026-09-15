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
    // MUTATION：把结论 pill 换成别的 status（或换回 emoji/自制边框条）⇒ 这两条先红——
    // 断言要落到 `data-status` 这一级，不是"有个 pill 就行"。
    const pill = canvas.getByTestId('validation-status-pill');
    await expect(pill).toHaveAttribute('data-status', 'ok');
    await expect(pill.querySelector('svg')?.classList.contains('lucide-check')).toBe(true);

    /*
     * ⭐ **结论词全区块只念一遍**。产品文档 P21-4 §5 的句式是「✅ 验证通过：镜像可用」
     * —— 结论当时由 emoji 旁边的文字承担。换成 pill 之后 pill 自己就带文字，若
     * `HEADLINE` 仍保留整句，屏幕上会变成 `[✓ 验证通过] 验证通过：镜像可用`。
     * v3 收口时确实一度是这样，是肉眼看截图才发现的 —— 当时没有任何断言锁这三句。
     * ⛔ 把结论词写回 HEADLINE ⇒ 本条红。
     */
    const text = canvas.getByTestId('validation-result').textContent;
    await expect(text.split('验证通过').length - 1).toBe(1);
  },
};

/** ⚠️ 警告：可用，但必须给**后果说明**（不裸报技术词，P21-4 §9）。 */
export const Warning: Story = {
  args: {
    status: 'warning',
    pinnedDigestShort: 'sha256:4b17e…a02',
    warnings: ['未预装 claude-code，创建时需现装，实测约 12.5 分钟'],
  },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByTestId('validation-status-pill');
    await expect(pill).toHaveAttribute('data-status', 'warn');
    await expect(pill.querySelector('svg')?.classList.contains('lucide-triangle-alert')).toBe(true);
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
    const pill = canvas.getByTestId('validation-status-pill');
    await expect(pill).toHaveAttribute('data-status', 'fail');
    await expect(pill.querySelector('svg')?.classList.contains('lucide-x')).toBe(true);
  },
};

/** ❌ 多条错误。 */
export const InvalidMultiple: Story = {
  args: {
    status: 'invalid',
    errors: ['缺少 tmux', '镜像 manifest 不可达（401 Unauthorized）', '架构不匹配：仅提供 arm64'],
  },
};
