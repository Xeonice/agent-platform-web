import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ProxySettingsCardView } from '@/views/system/ProxySettingsCard.view';

const meta: Meta<typeof ProxySettingsCardView> = {
  title: 'System/ProxySettingsCard',
  component: ProxySettingsCardView,
};
export default meta;

type Story = StoryObj<typeof ProxySettingsCardView>;

const EMPTY = { httpProxy: '', httpsProxy: '', noProxy: '' };

/**
 * ⭐ 这张卡存在的理由就是「向导之外也能配代理」，所以两条断言钉的是**它与向导的区别**：
 *
 * ⚠️ ① 按钮叫 **[保存]**，⛔ 不是向导那句 [保存并重新检测] —— 这一页没有「重新检测」，
 *    那是向导的动作（用户正卡在那一步等结论）。按钮要说清它到底会做什么。
 * ⚠️ ② 说明文字必须点破 **「能连上 ≠ 够快」** —— 用户之所以会走到这张卡，往往正是因为
 *    联网检查全绿、向导判定"不需要代理"，而镜像却拉到一半断掉（实测 200 KB/s）。
 *    只写「配置代理」等于把人留在原地。
 */
export const Empty: Story = {
  args: { initial: EMPTY, isSaving: false, errorMessage: null, onSave: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '保存' })).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /重新检测/ })).toBeNull();
    const card = canvas.getByTestId('proxy-settings-card');
    await expect(card).toHaveTextContent('测不出带宽');
  },
};

/** 已存配置要回填，⛔ 不能每次进来都是空的（那会让人以为没配过）。 */
export const Prefilled: Story = {
  args: {
    initial: {
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      noProxy: 'localhost',
    },
    isSaving: false,
    errorMessage: null,
    onSave: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('HTTP_PROXY')).toHaveValue('http://127.0.0.1:7890');
    await expect(canvas.getByLabelText('NO_PROXY')).toHaveValue('localhost');
  },
};

/** 保存失败要**说出原因**，⛔ 不许静默（P22 §1）。 */
export const SaveFailed: Story = {
  args: { initial: EMPTY, isSaving: false, errorMessage: '保存失败，请稍后重试。', onSave: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('proxy-settings-card')).toHaveTextContent('保存失败');
  },
};
