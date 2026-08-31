// F21-7 §7.2 / §9.1 #4：列表常态 / 空态 / 上限 / 加载 / 取不回来。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AutomationListView } from '@/views/project/AutomationList.view';
import type { AutomationRow } from '@/types/automation';

function row(overrides: Partial<AutomationRow> & Pick<AutomationRow, 'id'>): AutomationRow {
  return {
    name: '每天凌晨数据分析',
    lifecycle: 'on',
    icon: '✅',
    statusText: '已启用',
    summaryText: 'codex · 每天 08:00',
    nextTriggerText: '8-10 08:00',
    timezone: 'Asia/Shanghai',
    needsAttention: false,
    consecutiveFailures: 0,
    ...overrides,
  };
}

const ROWS: AutomationRow[] = [
  row({ id: 'a1' }),
  row({ id: 'a2', name: '每周一日志备份', summaryText: 'claude-code · 每周一 03:00' }),
  row({
    id: 'a3',
    name: '每小时内存检查',
    lifecycle: 'off',
    icon: '⏸️',
    statusText: '已禁用（不会触发）',
    nextTriggerText: undefined,
  }),
  row({
    id: 'a4',
    name: '每日报表',
    lifecycle: 'autoDisabled',
    icon: '🔴',
    statusText: '连续失败 10 次，已自动暂停',
    nextTriggerText: undefined,
    needsAttention: true,
    consecutiveFailures: 10,
  }),
];

const meta: Meta<typeof AutomationListView> = {
  title: 'Project/AutomationList',
  component: AutomationListView,
  parameters: { layout: 'fullscreen' },
  args: {
    rows: ROWS,
    loading: false,
    atLimit: false,
    onCreate: fn(),
    onSelect: fn(),
    onToggle: fn(),
    onShowFailure: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof AutomationListView>;

export const FourRules: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('automation-list-item')).toHaveLength(4);
    await expect(canvas.getByTestId('automation-create')).toBeEnabled();
    await expect(canvas.queryByTestId('automation-limit-note')).toBeNull();
  },
};

export const Empty: Story = {
  args: { rows: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('automation-empty')).toBeInTheDocument();
  },
};

/** 达 20 条上限：入口置灰 + 提示（P21-7 §3.2）。 */
export const AtLimit: Story = {
  args: {
    rows: Array.from({ length: 20 }, (_, i) => row({ id: `a${String(i)}` })),
    atLimit: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-create')).toBeDisabled();
    await expect(canvas.getByTestId('automation-limit-note')).toHaveTextContent('20');
  },
};

export const Loading: Story = { args: { rows: [], loading: true } };

/**
 * ⭐ 取不回来 ≠ 取回来是空的。
 * 一次 500 若被空态盖住，用户会以为自己从来没建过规则（useAuditStream ⑥ 同源的谎）。
 */
export const LoadFailed: Story = {
  args: { rows: [], loadErrorMessage: '网络错误，请稍后重试。' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('automation-load-error')).toBeInTheDocument();
    await expect(canvas.queryByTestId('automation-empty')).toBeNull();
  },
};
