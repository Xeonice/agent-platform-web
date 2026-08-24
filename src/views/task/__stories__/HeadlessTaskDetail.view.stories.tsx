import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HeadlessTaskDetailView } from '@/views/task/HeadlessTaskDetail.view';
import type { AgentTaskDto } from '@/types/task';

const noop = (): void => undefined;

/** 形状咬生成物 DTO（12 §3.4）：后端加必填字段 → 这份 fixture 编译期报红。 */
function taskDto(overrides: Partial<AgentTaskDto> = {}): AgentTaskDto {
  return {
    id: 'task-1',
    sandboxId: 'sb-1',
    runtime: 'codex',
    status: 'succeeded',
    exitCode: 0,
    timeoutMinutes: 120,
    lastSeq: 42,
    artifacts: [{ name: 'report.md', size: 2048, modifiedAt: '2026-08-22T01:02:03.000Z' }],
    startedAt: '2026-08-22T00:00:00.000Z',
    finishedAt: '2026-08-22T00:03:21.000Z',
    ...overrides,
  };
}

const meta: Meta<typeof HeadlessTaskDetailView> = {
  title: 'Task/HeadlessTaskDetail',
  component: HeadlessTaskDetailView,
  parameters: { layout: 'fullscreen' },
  args: { onNewTask: noop, onOpenTask: noop },
};
export default meta;

type Story = StoryObj<typeof HeadlessTaskDetailView>;

/**
 * **有任务 ⇒ 只读详情 + [新任务]**（§N.3）。
 * 结构性断言：详情态**没有指令 textarea**，但 [新任务] 按钮**存在** ——
 * 后半句是"多任务能力没被抹掉"的看守（一个沙箱多个任务是数据模型本来的样子）。
 */
export const Succeeded: Story = { args: { task: taskDto() } };

/** 失败：退出码与 errorCode 都是**只读事实**，不在这里给重试（重试属于输出面板/终态卡）。 */
export const Failed: Story = {
  args: { task: taskDto({ status: 'failed', exitCode: 137, errorCode: 'TASK_KILLED' }) },
};

/** `exitCode` 缺席 ⇒ 显示 `—`，**绝不渲染成 0**（"没拿到"不等于"成功退出"）。 */
export const ExitCodeMissing: Story = {
  args: { task: taskDto({ status: 'failed', exitCode: undefined, errorCode: 'TASK_FAILED' }) },
};

/** 无产物：明说"无"，不留空格子。 */
export const NoArtifacts: Story = { args: { task: taskDto({ artifacts: [] }) } };

/** **无任务 ⇒ 引导态**（仍然给 [新任务] 入口）。 */
export const EmptyGuide: Story = { args: { task: undefined } };

/** 档位不支持无头任务 ⇒ [新任务] 置灰 + 原因（与 spawnTty=false 同一套做法）。 */
export const CapabilityBlocked: Story = {
  args: {
    task: undefined,
    disabledReason: '运行档位「boxlite」不支持无头任务（headlessTask=false）。',
  },
};
