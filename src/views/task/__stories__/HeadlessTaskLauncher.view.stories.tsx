import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { HeadlessTaskLauncherView } from '@/views/task/HeadlessTaskLauncher.view';

const noop = (): void => undefined;

const meta: Meta<typeof HeadlessTaskLauncherView> = {
  title: 'Task/HeadlessTaskLauncher',
  component: HeadlessTaskLauncherView,
  parameters: { layout: 'fullscreen' },
  args: {
    prompt: '',
    onPromptChange: noop,
    timeoutMinutes: 120,
    onTimeoutChange: noop,
    verbose: false,
    onVerboseChange: noop,
    onSubmit: noop,
    submitting: false,
  },
};
export default meta;

type Story = StoryObj<typeof HeadlessTaskLauncherView>;

/** 空表单：指令为空 ⇒ [发起] 禁用（prompt 下限 1）。 */
export const Empty: Story = {};

/** 常规：填了指令、选了 4 小时档位、勾了 --verbose。 */
export const Filled: Story = {
  args: {
    prompt: '把 src/lib 下缺失的单测补齐，并输出改动摘要',
    timeoutMinutes: 240,
    verbose: true,
  },
};

/** 接近上限：计数仍是常规灰字。 */
export const NearLimit: Story = {
  args: { prompt: 'x'.repeat(7990) },
};

/** 超 8000 码点：红字计数 + 禁用发起（P21-2 §6）。 */
export const TooLong: Story = {
  args: { prompt: 'x'.repeat(8001) },
};

/** 发起中：按钮与输入区一并进入 pending。 */
export const Submitting: Story = {
  args: { prompt: '跑一轮回归', submitting: true },
};

/**
 * 能力位显隐：所选 provider `capabilities.headlessTask === false` ⇒ **置灰 + 原因**，
 * 与 `spawnTty=false` 禁用终端入口同一套做法。
 *
 * ⚠️ **2026-09-11：理由里不再出现档位名，也不再出现字段名。**
 * 「运行档位」这个开关已从界面退休（选择权收回后端）——把一个用户既选不了、
 * 也在别处看不到的名字摆给他，只会让他去找一个不存在的下拉；`headlessTask=false`
 * 则是能力位的字段名，属于"只进日志与 data 属性"那一层（P22 §6）。
 * 两条相反的出路（换机器 / 改用交互式终端）仍然都摆出来，不替用户选。
 */
export const CapabilityBlocked: Story = {
  args: {
    prompt: '跑一轮回归',
    disabledReason:
      '这台机器的沙箱环境跑不了无头任务（不开终端、直接跑完的那种）。换一台支持它的机器重新发起，或者改用交互式终端。',
  },
};

/**
 * 能力位**未知**（还没取到这台机器的沙箱环境信息）：不置灰，就地照实说。
 * ⚠️ 「不知道」不能说成「不支持」—— 这是本仓的一条硬纪律。
 */
export const CapabilityUnknown: Story = {
  args: {
    capabilityUnknownNote:
      '还不确定这台机器的沙箱环境能不能跑无头任务（环境信息还没取回来）。可以先发起，以平台的校验结果为准。',
  },
};

/** 续接：本轮将带上一轮的 sessionRef（`resumeFrom`），按钮文案随之变化。 */
export const Resuming: Story = {
  args: { prompt: '再把 README 更新一下', resumeFrom: 'sess-7f3a9c', onClearResume: noop },
};

/** 发起失败：人话（已按码翻译），不裸抛错误码。 */
export const Failed: Story = {
  args: {
    prompt: '跑一轮回归',
    errorMessage: '运行时凭证未配置或已失效，agent 无法继续。请到凭证管理完成授权后重跑。',
  },
};
