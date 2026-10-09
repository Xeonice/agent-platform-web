import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import { SearchSelect, type SearchSelectProps } from '@/components/ui/search-select';

function ControlledSearchSelect(args: SearchSelectProps) {
  const [value, setValue] = useState(args.value);
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 p-6">
      <label htmlFor={args.id}>项目</label>
      <SearchSelect {...args} value={value} onValueChange={setValue} />
      <button type="button">下一个字段</button>
    </div>
  );
}

const meta: Meta<typeof SearchSelect> = {
  title: 'UI/SearchSelect',
  component: SearchSelect,
  render: (args) => <ControlledSearchSelect {...args} />,
  args: {
    id: 'story-project',
    value: 'web',
    options: [
      { value: 'web', label: 'acme-web' },
      { value: 'api', label: 'Acme-API', disabled: true, reason: '克隆中' },
      { value: 'docs', label: '文档项目' },
    ],
    onValueChange: () => undefined,
    searchLabel: '搜索项目',
    emptyLabel: '没有匹配的项目',
    placeholder: '请选择项目',
  },
};
export default meta;
type Story = StoryObj<typeof SearchSelect>;

export const SearchAndReopen: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = page.getByLabelText('项目');
    await userEvent.click(trigger);
    const input = page.getByRole('combobox', { name: '搜索项目' });
    await expect(input).toHaveFocus();
    await userEvent.type(input, '  ACME  ');
    await expect(page.getAllByRole('option')).toHaveLength(2);
    await expect(page.getByRole('option', { name: /Acme-API/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(trigger).toHaveTextContent('acme-web');
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await expect(page.getByRole('combobox', { name: '搜索项目' })).toHaveValue('');
    await expect(page.getAllByRole('option')).toHaveLength(3);
  },
};

export const KeyboardAndIme: Story = {
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const trigger = page.getByLabelText('项目');
    await userEvent.click(trigger);
    const input = page.getByRole('combobox', { name: '搜索项目' });
    await fireEvent.compositionStart(input);
    await fireEvent.change(input, { target: { value: '文档' } });
    await fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await expect(trigger).toHaveTextContent('acme-web');
    await expect(input).toBeVisible();
    await fireEvent.compositionEnd(input);
    await userEvent.keyboard('{Enter}');
    await expect(trigger).toHaveTextContent('文档项目');
    await expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Tab}');
    await expect(page.getByRole('button', { name: '下一个字段' })).toHaveFocus();
  },
};

export const FixedDefaultAndEmpty: Story = {
  args: { fixedOption: { value: '', label: '跟随项目当前的分支（默认）' } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(page.getByLabelText('项目'));
    await userEvent.type(page.getByRole('combobox', { name: '搜索项目' }), '没有这个项目');
    await expect(page.getByRole('status')).toHaveTextContent('没有匹配的项目');
    await expect(page.getByRole('option', { name: '跟随项目当前的分支（默认）' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: '清空搜索' }));
    await expect(page.getAllByRole('option')).toHaveLength(4);
  },
};

export const AliasAndLongReference: Story = {
  args: {
    options: [
      {
        value: 'web',
        label: '研发环境',
        secondary: `docker.io/acme/${'very-long-image-name-'.repeat(8)}:v1`,
        searchText: '研发环境 docker.io/acme/ml-agent:v1',
        warning: '没有预装 Claude Code，启动会明显变慢',
      },
    ],
    searchLabel: '搜索镜像',
  },
};

export const Loading: Story = {
  args: { options: [], loading: true, fixedOption: { value: '', label: '默认' } },
};
export const Disabled: Story = { args: { disabled: true } };
