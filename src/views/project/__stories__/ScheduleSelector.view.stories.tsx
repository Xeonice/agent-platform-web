// F21-7 §7.2：三种预设 + 时区默认值展示 + 自定义 cron 置灰（v1.2）。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ScheduleSelectorView } from '@/views/project/ScheduleSelector.view';

const meta: Meta<typeof ScheduleSelectorView> = {
  title: 'Project/ScheduleSelector',
  component: ScheduleSelectorView,
  parameters: { layout: 'padded' },
  args: {
    kind: 'daily',
    config: { time: '08:00' },
    timezone: 'Asia/Shanghai',
    onKindChange: fn(),
    onConfigChange: fn(),
    onTimeZoneChange: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof ScheduleSelectorView>;

export const Daily: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('schedule-time')).toHaveValue('08:00');
    // ⭐ 时区始终可见，不折进「高级选项」——触发时刻只有连着时区读才有意义。
    await expect(canvas.getByTestId('schedule-timezone')).toHaveValue('Asia/Shanghai');
    // MVP 不支持裸 cron（P21-7 §3.2）：摆一个禁用项，说明这条路存在但没通。
    await expect(canvas.getByTestId('schedule-kind-cron')).toBeDisabled();
  },
};

export const Hourly: Story = {
  args: { kind: 'hourly', config: { minute: 0 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('schedule-minute')).toHaveValue(0);
    await expect(canvas.queryByTestId('schedule-time')).toBeNull();
  },
};

export const WeeklyMultiDay: Story = {
  args: { kind: 'weekly', config: { time: '08:00', days: [1, 3, 5] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('schedule-day-1')).toBeChecked();
    await expect(canvas.getByTestId('schedule-day-3')).toBeChecked();
    await expect(canvas.getByTestId('schedule-day-5')).toBeChecked();
    await expect(canvas.getByTestId('schedule-day-0')).not.toBeChecked();
  },
};

/** 新建：时区默认取环境时区，并说明"创建后快照"。 */
export const CreatingDefaultsToLocalZone: Story = {
  args: { editing: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/创建后快照保存/)).toBeInTheDocument();
  },
};

/**
 * ⭐ 编辑态：说明「不动它就不会重传」。
 * 这句话是 I-AUT-9 在界面上的落点——用户得知道改这个框会影响以后所有触发时刻。
 */
export const EditingUntouched: Story = {
  args: { editing: true, timezoneTouched: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/不动它，保存时就不会重传/)).toBeInTheDocument();
    await expect(canvas.queryByTestId('timezone-touched')).toBeNull();
  },
};

/** ⭐ 编辑态且用户显式改过时区 → 界面明说"这一次会一并提交"。 */
export const EditingTouched: Story = {
  args: { editing: true, timezoneTouched: true, timezone: 'UTC' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('timezone-touched')).toBeInTheDocument();
  },
};

export const InvalidSchedule: Story = {
  args: { kind: 'weekly', config: { time: '08:00', days: [] }, errorMessage: '请至少选择一天。' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('schedule-error')).toBeInTheDocument();
  },
};
