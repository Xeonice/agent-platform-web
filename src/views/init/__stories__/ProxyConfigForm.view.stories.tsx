import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProxyConfigFormView } from '@/views/init/ProxyConfigForm.view';

const meta: Meta<typeof ProxyConfigFormView> = {
  title: 'Init/ProxyConfigForm',
  component: ProxyConfigFormView,
  parameters: { layout: 'padded' },
  args: {
    initial: { httpProxy: '', httpsProxy: '', noProxy: '' },
    isSaving: false,
    cooldownSec: 0,
    errorMessage: null,
    onSaveAndRecheck: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ProxyConfigFormView>;

export const Empty: Story = {};

export const Prefilled: Story = {
  args: {
    initial: {
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'localhost,127.0.0.1',
    },
  },
};

/** ⭐ 保存 ≠ 放行（§8 约束 2）：按钮上的字写全，旁边那句话把边界说死。 */
export const SaveIsNotRelease: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText('只保存配置，不会结束初始化 —— 放行在最后一步。'),
    ).toBeInTheDocument();

    await userEvent.type(
      canvas.getByRole('textbox', { name: /HTTP_PROXY/ }),
      'http://127.0.0.1:7890',
    );
    await userEvent.click(canvas.getByRole('button', { name: '保存并重新检测' }));
    await expect(args.onSaveAndRecheck).toHaveBeenCalledWith({
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: '',
      noProxy: '',
    });
  },
};

export const Saving: Story = { args: { isSaving: true } };

/** 3s 节流冷却中：倒计时 + 禁用。 */
export const CoolingDown: Story = {
  args: { cooldownSec: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /保存并重新检测/ })).toBeDisabled();
  },
};

export const SaveFailed: Story = {
  args: { errorMessage: '代理地址不是合法 URL：http//bad' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('proxy-error')).toHaveTextContent('不是合法 URL');
  },
};
