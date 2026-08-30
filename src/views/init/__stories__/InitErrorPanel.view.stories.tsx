import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { InitErrorPanelView } from '@/views/init/InitErrorPanel.view';

const meta: Meta<typeof InitErrorPanelView> = {
  title: 'Init/InitErrorPanel',
  component: InitErrorPanelView,
  parameters: { layout: 'padded' },
  args: {
    message: '写入失败：数据目录只读（/data）。请检查挂载权限后重试。',
    isRetrying: false,
    onRetry: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof InitErrorPanelView>;

/** ⭐ 原因**原样上 UI**：换成一句「初始化失败，请重试」等于把唯一有用的信息删掉。 */
export const WriteFailed: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('init-error-panel')).toHaveTextContent('数据目录只读');
    await userEvent.click(canvas.getByRole('button', { name: '重试' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** 离线未确认的 409（`OFFLINE_NOT_ACKNOWLEDGED`）走这里 —— 与「已初始化」那种 409 是两个码，
 * 处置恰好相反：那一种放行进工作台，这一种必须停在向导上把这句话说出来（见 `useInitWizard` ⑤）。 */
export const OfflineNotAcknowledged: Story = {
  args: {
    message:
      '模型 API 全部不可达（api.openai.com、api.anthropic.com）—— 当前为离线环境，Agent 将不可用。配置代理后重新检测，或明确以离线模式继续（平台其余功能可用）。',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('init-error-panel')).toHaveTextContent('模型 API 全部不可达');
  },
};

export const Retrying: Story = {
  args: { isRetrying: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '重试中…' })).toBeDisabled();
  },
};
