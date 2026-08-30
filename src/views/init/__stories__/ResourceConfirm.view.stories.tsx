import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ResourceConfirmView } from '@/views/init/ResourceConfirm.view';
import type { ResourceConfirmModel } from '@/types/init';

const DISK_NOTE =
  '磁盘会被三样东西持续吃掉：预制镜像约 13GB · boxlite 的 rootfs 缓存实测约 31GB · 每个 Task 一份工作区副本。所以这里看的是**可用容量**，不是总量。';

function model(over: Partial<ResourceConfirmModel> = {}): ResourceConfirmModel {
  return {
    rows: [
      { id: 'cpu', label: 'CPU', valueText: '10 核 · 当前负载 37%', level: 'ok', low: false },
      { id: 'ram', label: '内存', valueText: '32 GB（已用 76.7%）', level: 'ok', low: false },
      {
        id: 'disk',
        label: '磁盘',
        valueText: '可用 80 GB / 总 200 GB（已用 60%，/data）',
        level: 'ok',
        low: false,
        noteText: DISK_NOTE,
      },
    ],
    low: false,
    reservedText:
      '调度时预留总容量的 15%（进度条分母仍是总容量，P21-8 §7）：内存可调度上限 27.2 GB、磁盘 170 GB —— 磁盘还要与当前可用的 80 GB 取小。',
    diskCompositionText: DISK_NOTE,
    ...over,
  };
}

const meta: Meta<typeof ResourceConfirmView> = {
  title: 'Init/ResourceConfirm',
  component: ResourceConfirmView,
  parameters: { layout: 'padded' },
  args: { model: model(), isError: false, isFinishing: false, onFinish: fn() },
};
export default meta;

type Story = StoryObj<typeof ResourceConfirmView>;

/** 资源充足：预留 15% 与磁盘构成都要看得见。 */
export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('resource-reserved')).toHaveTextContent('预留总容量的 15%');
    await expect(canvas.getByTestId('resource-row-disk')).toHaveTextContent('rootfs');
    await expect(canvas.queryByTestId('resource-low')).toBeNull();
  },
};

/**
 * ⭐ **资源偏低是黄字不是门**（P21-8 §2「但仍可继续」）：
 * [确认，开始使用] 照常可点 —— 做成 disabled 会让一台小机器根本装不起来。
 */
export const LowResources: Story = {
  args: {
    model: model({
      rows: [
        { id: 'cpu', label: 'CPU', valueText: '1 核 · 当前负载 20%', level: 'ok', low: true },
        { id: 'ram', label: '内存', valueText: '2 GB（已用 50%）', level: 'ok', low: true },
        {
          id: 'disk',
          label: '磁盘',
          valueText: '可用 29 GB / 总 926 GB（已用 96.8%，/data）',
          level: 'critical',
          low: true,
          noteText: DISK_NOTE,
        },
      ],
      low: true,
      lowText:
        '当前资源配置较低（CPU 1 核（建议 ≥ 2 核）、内存 2 GB（建议 ≥ 4 GB）、可用磁盘 29 GB（建议 ≥ 50 GB）），建议增加后再投入使用 —— 仍可继续，只是任务并发与镜像铺开会更慢。',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('resource-low')).toHaveTextContent('仍可继续');
    // ⭐ 否定断言：偏低**不**禁用完成按钮。
    await expect(canvas.getByRole('button', { name: '确认，开始使用' })).toBeEnabled();
    // ⭐ 一块 926GB、只剩 29GB 的盘必须报偏低（只报总量会让人以为宽裕）。
    await expect(canvas.getByTestId('resource-row-disk')).toHaveAttribute('data-low', 'true');
  },
};

/** ⭐ 读不到资源 ⇒ 说"没查出来"，⛔ 不渲染成 0%/空（那会把"读不到"伪装成"很空闲"）。 */
export const ResourcesUnavailable: Story = {
  args: { model: undefined, isError: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('resource-error')).toHaveTextContent('不代表资源充足');
    await expect(canvas.getByRole('button', { name: '确认，开始使用' })).toBeEnabled();
  },
};

export const Finishing: Story = { args: { isFinishing: true } };
