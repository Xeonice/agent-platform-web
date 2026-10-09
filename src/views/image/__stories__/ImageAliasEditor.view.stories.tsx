import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ImageAliasEditorView } from '@/views/image/ImageAliasEditor.view';

const noop = () => undefined;
const meta: Meta<typeof ImageAliasEditorView> = {
  title: 'Image/ImageAliasEditor',
  component: ImageAliasEditorView,
  args: {
    value: '研发环境',
    count: 4,
    onChange: noop,
    onSave: noop,
    onCancel: noop,
    onClear: noop,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;
export const Editing: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return (
      <ImageAliasEditorView
        {...args}
        value={value}
        count={Array.from(value.trim()).length}
        onChange={setValue}
        onClear={() => {
          setValue('');
        }}
      />
    );
  },
};
export const Saving: Story = {
  args: { saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: '镜像别名' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: '取消' })).toBeDisabled();
  },
};
export const Failed: Story = { args: { error: '别名保存失败，请重试。' } };
export const TooLong: Story = {
  args: { value: '😀'.repeat(65), count: 65, error: '别名最多 64 个字符', invalid: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.getByRole('button', { name: '保存别名' })).toBeDisabled();
  },
};
export const Cleared: Story = { args: { value: '', count: 0 } };
