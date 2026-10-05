import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';
const meta: Meta<typeof SettingsLayoutView> = {
  title: 'Settings/SettingsLayout',
  component: SettingsLayoutView,
  parameters: { layout: 'fullscreen' },
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
  args: { pageTitle: '凭证管理', children: <p>配置内容</p> },
};
export default meta;
type Story = StoryObj<typeof SettingsLayoutView>;
export const SharedHeaderIsHidden: Story = {
  args: { hideHeader: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('heading', { name: '凭证管理' })).not.toBeInTheDocument();
    await expect(canvas.getByText('配置内容')).toBeInTheDocument();
  },
};
export const FormLeftAlignedWith768Content: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByText('配置内容').parentElement;
    await expect(box).toHaveAttribute('data-width', 'form');
    await expect(box).toHaveClass('max-w-[832px]');
    await expect(box).not.toHaveClass('mx-auto');
    await expect(box).toHaveClass('md:p-8');
  },
};
export const WideCanvas: Story = {
  args: { width: 'wide' },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByText('配置内容').parentElement;
    await expect(box).toHaveAttribute('data-width', 'wide');
    await expect(box).toHaveClass('max-w-none');
  },
};
