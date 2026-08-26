import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ImageVersionHistoryView } from '@/views/image/ImageVersionHistory.view';
import type { ImageVersionRowModel } from '@/types/image';

const noop = (): void => undefined;

const ROWS: ImageVersionRowModel[] = [
  {
    id: 'm-new',
    version: 'v1.0',
    digestShort: 'sha256:8e05a…77f',
    isActive: true,
    registeredAt: '2026-08-20T10:00:00.000Z',
    validationStatus: 'valid',
  },
  {
    id: 'm-old',
    version: 'v1.0',
    digestShort: 'sha256:4b17e…a02',
    isActive: false,
    registeredAt: '2026-05-01T10:00:00.000Z',
    validationStatus: 'warning',
  },
];

const meta: Meta<typeof ImageVersionHistoryView> = {
  title: 'Image/ImageVersionHistory',
  component: ImageVersionHistoryView,
  args: { rows: ROWS, onSwitchVersion: noop },
};
export default meta;

type Story = StoryObj<typeof ImageVersionHistoryView>;

/**
 * 同一个 tag 的两行（更新 = INSERT 新行 + 旧行下线，不是就地改）。
 * **play**：旧行给 [切换到此版本]（这就是"回滚"的入口），活行**不给**——
 * 对当前版本点"切换到此版本"没有意义，所以是不渲染而不是渲染出来再置灰。
 */
export const TwoVersions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByTestId('image-version-row');
    await expect(rows).toHaveLength(2);
    await expect(canvas.getAllByRole('button', { name: '切换到此版本' })).toHaveLength(1);
    await expect(canvas.getByText('（当前版本）')).toBeInTheDocument();
  },
};

/**
 * digest 未解析的历史行。
 * **play**：显示「⚠️ 未解析」，且 DOM 全文**不含哨兵串** `sha256:unresolved`
 *（模型层已经把它挡在外面，这条是最后一道：哨兵值长得像哈希，漏出去比留白更误导）。
 */
export const UnresolvedDigest: Story = {
  args: {
    rows: [
      {
        id: 'm-x',
        version: 'v0.9',
        isActive: false,
        registeredAt: '2026-01-01T00:00:00.000Z',
        validationStatus: 'pending',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('⚠️ 未解析')).toBeInTheDocument();
    // `pending` 在历史列表里如实说"未判定"——卡面必须在三档里选一档，这里不必。
    await expect(canvas.getByText('· 未判定')).toBeInTheDocument();
    await expect(canvasElement.innerHTML).not.toContain('sha256:unresolved');
  },
};

/** 切换进行中：那一行的按钮 loading，其余行不受影响。 */
export const Switching: Story = {
  args: { switchingId: 'm-old' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '切换中…' })).toBeDisabled();
  },
};

/** 没有历史版本时**整块不渲染**（不是渲染一个"暂无历史"的空壳占着位置）。 */
export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('image-version-history')).toBeNull();
  },
};
