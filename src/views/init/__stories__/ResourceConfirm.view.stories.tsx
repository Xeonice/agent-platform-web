import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ResourceConfirmView } from '@/views/init/ResourceConfirm.view';
import type { ResourceConfirmModel } from '@/types/init';

const DISK_NOTE =
  '磁盘会被三样东西持续吃掉：预制镜像下载到本机后约 1.3GB（下载 0.3GB）· 沙箱环境自己的镜像缓存实测约 31GB · 每个任务一份工作区副本。所以这里看的是可用容量，不是总量。';

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
      '平台会留出总容量的 15% 不拿去跑任务（上面的进度条分母仍然是总容量）：内存最多能分出 27.2 GB、磁盘 170 GB —— 磁盘还要与当前可用的 80 GB 取小。',
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

/** 资源充足：预留比例与磁盘构成都要看得见。 */
export const Healthy: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('resource-reserved')).toHaveTextContent('总容量的 15%');
    await expect(canvas.getByTestId('resource-row-disk')).toHaveTextContent('镜像缓存');
    await expect(canvas.queryByTestId('resource-low')).toBeNull();
  },
};

/**
 * ⛔ **[确认，开始使用] 旁边那句不许描述数据库里发生了什么。**
 * 原文是「点它才会写入初始化完成标记」—— 用户不关心平台往哪张表里写了一个布尔值，
 * 他要知道的是"点完就装完了、之后还能不能改"。
 */
export const FinishHintIsNotADatabaseDescription: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = canvas.getByTestId('resource-confirm');
    await expect(section).not.toHaveTextContent('初始化完成标记');
    await expect(section).toHaveTextContent('点它才算装完');
    await expect(section).toHaveTextContent('设置 → 系统状态');
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
        '仍可继续 —— 当前这台机器的资源偏低（CPU 1 核（建议 ≥ 2 核）、内存 2 GB（建议 ≥ 4 GB）、可用磁盘 29 GB（建议 ≥ 50 GB）），建议加上去之后再正式投入使用；现在就用也行，只是同时能跑的任务更少、镜像下载到本机更慢。',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 「仍可继续」**前置**：排在句尾时，用户读到前半句就已经以为自己被卡住了。
    //    （前面还有一个 `⚠️ ` 前缀，所以下标不是 0 而是"很靠前"。）
    const lowText = canvas.getByTestId('resource-low').textContent;
    await expect(lowText).toContain('仍可继续');
    await expect(lowText.indexOf('仍可继续')).toBeLessThan(4);
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
    // ⭐ 全篇最好的一句：只换掉「水位」这个内部词、把关键半句加粗，意思一个字不动。
    const err = canvas.getByTestId('resource-error');
    await expect(err).toHaveTextContent('不代表资源充足，只代表这一项没查出来');
    await expect(err).not.toHaveTextContent('水位');
    // 加粗的是"这不代表资源充足"那半句 —— 它是这段话里唯一会被读漏的部分。
    await expect(within(err).getByText(/这不代表资源充足/).tagName).toBe('STRONG');
    await expect(canvas.getByRole('button', { name: '确认，开始使用' })).toBeEnabled();
  },
};

export const Finishing: Story = { args: { isFinishing: true } };
