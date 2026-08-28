import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { AuditEventRowView } from '@/views/system/AuditEventRow.view';
import type { AuditRowModel } from '@/types/audit';

function row(overrides: Partial<AuditRowModel> = {}): AuditRowModel {
  return {
    seq: 1024,
    timeText: '13:45:30.123',
    severity: 'info',
    summary: '沙箱 sb-1 完成 workspace 准备',
    actorText: '系统',
    ...overrides,
  };
}

const meta: Meta<typeof AuditEventRowView> = {
  title: 'System/AuditEventRow',
  component: AuditEventRowView,
  parameters: { layout: 'padded' },
  args: { onToggleDetail: fn(), onOpenTimeline: fn() },
  decorators: [
    (Story) => (
      <ul className="w-[860px] max-w-full">
        <Story />
      </ul>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof AuditEventRowView>;

export const Info: Story = {
  args: { row: row({ durationText: '4.2s', outcome: 'ok' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // **三重线索**：图标 + 文字 + 颜色。断言的是"文字也在"——只上色的版本在灰度屏上等于没有严重度。
    await expect(canvas.getByText('信息')).toBeInTheDocument();
    await expect(canvas.getByText('ℹ️')).toBeInTheDocument();
  },
};

export const Warn: Story = {
  args: {
    row: row({ seq: 1025, severity: 'warn', summary: '镜像 ml-agent:v1.0 校验有告警' }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('警告')).toBeInTheDocument();
  },
};

export const ErrorWithCode: Story = {
  args: {
    row: row({
      seq: 1026,
      severity: 'error',
      summary: '沙箱 sb-2 创建失败：provider 不可用',
      outcome: 'failed',
      errorCode: 'PROVIDER_UNAVAILABLE',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('错误')).toBeInTheDocument();
    // errorCode 是**独立一列**，不拼在 summary 里（与 10 §6.8 同一闭集，要能按码筛/统计）。
    await expect(canvas.getByText('PROVIDER_UNAVAILABLE')).toBeInTheDocument();
    await expect(canvas.getByText('沙箱 sb-2 创建失败：provider 不可用')).toBeInTheDocument();
  },
};

export const WithDetailExpandsInline: Story = {
  args: {
    row: row({ detailText: '{\n  "provider": "aio"\n}' }),
    expanded: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId('audit-detail-panel');
    // **行内展开，不弹层**：父节点是列表行本身。
    await expect(panel.closest('li')).toBe(canvas.getByTestId('audit-row-1024'));
    await expect(panel.closest('[role="dialog"]')).toBeNull();
  },
};

export const ClickTogglesDetail: Story = {
  args: { row: row({ detailText: '{}' }) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { expanded: false }));
    await expect(args.onToggleDetail).toHaveBeenCalledWith(1024);
  },
};

export const NoDetailNoArrow: Story = {
  args: { row: row({ seq: 1027 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 没有 detail 的行**没有展开箭头**——判据是 model 不产出 detailText。
    await expect(canvas.queryByRole('button', { expanded: false })).toBeNull();
  },
};

export const WithSandboxTimelineLink: Story = {
  args: {
    row: row({ subjectLink: { subjectId: 'sb-1', label: '查看该沙箱完整时间线' } }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '查看该沙箱完整时间线' }));
    await expect(args.onOpenTimeline).toHaveBeenCalledWith('sb-1');
  },
};

export const LongSummaryTruncates: Story = {
  args: {
    row: row({
      seq: 1028,
      summary:
        '沙箱 sb-9 provision 第 3 阶段失败：拉取镜像 docker.io/myrepo/very-long-image-name-that-keeps-going:v1.2.3 超时，已重试 2 次后放弃',
    }),
  },
};
