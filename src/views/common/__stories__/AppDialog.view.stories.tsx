// F21-2 §N.0：应用弹层外壳（2026-09-14 从手写 `ModalShell` 换成 shadcn/Radix `Dialog`）。
//
// ⭐ 三条断言钉的都是"换壳时最容易白丢"的东西 —— 它们不会因为换了组件就自动具备：
//  ① `aria-modal`：Radix 这个版本**不加**，要调用方自己写；
//  ② 关闭按钮的无障碍名是**中文「关闭」**，不是共享 DialogContent 那个英文 "Close"；
//  ③ 关闭按钮在 DOM 里**排最后**，否则首次打开的焦点会落在 [✕] 上（回车直接关掉）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AppDialogView } from '@/views/common/AppDialog.view';

const meta: Meta<typeof AppDialogView> = {
  title: 'Common/AppDialog',
  component: AppDialogView,
  parameters: { layout: 'fullscreen' },
  args: {
    title: '项目详情',
    subtitle: 'acme-web',
    testId: 'modal-demo',
    onClose: fn(),
    children: <p className="px-5 py-3 text-sm">内容区</p>,
  },
};
export default meta;

type Story = StoryObj<typeof AppDialogView>;

export const Normal: Story = {
  play: async () => {
    const body = within(document.body);
    const dialog = body.getByTestId('modal-demo');
    // ① Radix 不会自己加 aria-modal —— 变异：删掉 view 里那行 ⇒ 本条红。
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('role', 'dialog');
    await expect(dialog).toHaveTextContent('项目详情');
    await expect(dialog).toHaveTextContent('acme-web');

    // ② 中文无障碍名。变异：改用共享 `DialogContent` 的内置 Close（名为 "Close"）⇒ 红。
    await expect(body.getByRole('button', { name: '关闭' })).toBeInTheDocument();

    // ③ 关闭按钮排在 DOM 最后。变异：把它挪到标题区 ⇒ 红。
    const focusables = dialog.querySelectorAll('button, [href], input, select, textarea');
    await expect(focusables[focusables.length - 1]).toHaveAttribute('aria-label', '关闭');
  },
};

/** 点 [✕] 上抛关闭。 */
export const CloseByButton: Story = {
  play: async ({ args }) => {
    const body = within(document.body);
    await userEvent.click(body.getByRole('button', { name: '关闭' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/**
 * ⭐ **busy 是真守卫不是样式**：创建中被误关会留下一个用户以为没发生过的请求。
 * 变异：把 view 里 `onOpenChange` 的 `!busy` 去掉（或 Close 的 disabled 去掉）⇒ 本条红。
 */
export const BusyBlocksClose: Story = {
  args: { busy: true },
  play: async ({ args }) => {
    const body = within(document.body);
    const close = body.getByRole('button', { name: '关闭' });
    await expect(close).toBeDisabled();
    await userEvent.click(close);
    await expect(args.onClose).not.toHaveBeenCalled();
    // Esc 同样被拦。
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

/** 无副标题：不渲染 Description（⛔ 不编一句没信息量的描述来消 Radix 告警）。 */
export const WithoutSubtitle: Story = {
  args: { subtitle: undefined },
  play: async () => {
    const body = within(document.body);
    await expect(body.getByTestId('modal-demo')).toHaveTextContent('项目详情');
    await expect(body.queryByText('acme-web')).not.toBeInTheDocument();
  },
};
