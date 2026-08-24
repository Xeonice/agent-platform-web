import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { TaskOutcomeView } from '@/views/task/TaskOutcome.view';
import type { TaskArtifactView } from '@/types/taskStream';

const noop = (): void => undefined;

const ARTIFACTS: TaskArtifactView[] = [
  { name: 'summary.md', sizeLabel: '2.0 KB', modifiedAt: '2026-08-22T01:05:00Z' },
  { name: 'patch.diff', sizeLabel: '128.0 KB', modifiedAt: '2026-08-22T01:05:02Z' },
];

const meta: Meta<typeof TaskOutcomeView> = {
  title: 'Task/Outcome',
  component: TaskOutcomeView,
  parameters: { layout: 'fullscreen' },
  args: {
    artifacts: ARTIFACTS,
    onDownload: noop,
    onResume: noop,
    onNewTask: noop,
    sessionRef: 'sess-7f3a9c',
  },
};
export default meta;

type Story = StoryObj<typeof TaskOutcomeView>;

/** 成功：唯一给 success 调性的形态（status=succeeded 且 exitCode===0）。 */
export const Succeeded: Story = {
  args: {
    copy: {
      tone: 'success',
      title: '✅ 任务完成（退出码 0）',
      advice: '产物可在下方列表下载；也可以基于这一轮会话接着提新指令。',
      exitCodeLabel: '0',
      exitCodeMissing: false,
    },
  },
};

/** 非零退出：失败调性 + 把退出码说清楚。 */
export const NonZeroExit: Story = {
  args: {
    copy: {
      tone: 'failed',
      title: '❌ 任务失败',
      advice: 'CLI 以退出码 1 结束。',
      exitCodeLabel: '1',
      exitCodeMissing: false,
    },
    artifacts: [],
  },
};

/**
 * ⚠️ **退出码缺席**（被信号杀掉的进程没有退出码）：
 * 按**非零退出**处理、解释原因，界面上**绝不出现 `undefined`**。
 */
export const ExitCodeMissing: Story = {
  args: {
    copy: {
      tone: 'failed',
      title: '⛔ 任务被终止',
      advice:
        '本次没有拿到退出码——进程被信号终止（超时强杀 / OOM / 手动终止）时不会留下退出码，已按**非零退出**处理。',
      exitCodeLabel: '未知（进程被信号终止，没有退出码）',
      exitCodeMissing: true,
    },
    artifacts: [],
  },
};

/** 超时：退出码同样缺席，另有错误码人话与诊断码。 */
export const TimedOut: Story = {
  args: {
    copy: {
      tone: 'failed',
      title: '⏱️ 任务超时，已被强制终止',
      advice:
        '任务运行超过设定的超时上限，已被平台强制终止。可以调大超时档位后重跑。 本次没有拿到退出码——进程被信号终止（超时强杀 / OOM / 手动终止）时不会留下退出码，已按**非零退出**处理。',
      exitCodeLabel: '未知（进程被信号终止，没有退出码）',
      exitCodeMissing: true,
      diagnosticCode: 'TASK_TIMEOUT',
    },
    artifacts: [],
  },
};

/** 无产物：明说"没有产出文件"，不留空白区。 */
export const NoArtifacts: Story = {
  args: {
    copy: {
      tone: 'success',
      title: '✅ 任务完成（退出码 0）',
      advice: '产物可在下方列表下载；也可以基于这一轮会话接着提新指令。',
      exitCodeLabel: '0',
      exitCodeMissing: false,
    },
    artifacts: [],
  },
};

/** 下载中：同一时间只允许一个下载在跑。响应没给 content-length ⇒ **不显示进度**（不猜百分比）。 */
export const Downloading: Story = {
  args: {
    copy: {
      tone: 'success',
      title: '✅ 任务完成（退出码 0）',
      advice: '产物可在下方列表下载。',
      exitCodeLabel: '0',
      exitCodeMissing: false,
    },
    downloadingName: 'patch.diff',
  },
};

/** 流式落盘 + 响应带 content-length：边写盘边报进度（文案是 hook 侧派生的成品）。 */
export const DownloadingWithProgress: Story = {
  args: {
    copy: {
      tone: 'success',
      title: '✅ 任务完成（退出码 0）',
      advice: '产物可在下方列表下载。',
      exitCodeLabel: '0',
      exitCodeMissing: false,
    },
    downloadingName: 'patch.diff',
    downloadProgressLabel: '已下载 128.0 MB / 512.0 MB（25%）',
  },
};

/** 无 sessionRef：[接着聊] 禁用并说明原因，不给点了没反应的按钮。 */
export const NoSessionRef: Story = {
  args: {
    copy: {
      tone: 'failed',
      title: '❌ 任务失败',
      advice: 'CLI 以退出码 1 结束。',
      exitCodeLabel: '1',
      exitCodeMissing: false,
    },
    artifacts: [],
    sessionRef: undefined,
  },
};
