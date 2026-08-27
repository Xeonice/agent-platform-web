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
 * ⚠️ 档位名用第三方的 `acme-box`，**不用 `boxlite`**：两个内置档位（aio / boxlite）的
 * `headlessTask` 现在都是 `true`（S6 已落地），拿 boxlite 演"不支持"是在 story 里
 * 挂一条关于后端的假事实。开放 registry 里第三方档位不支持无头任务才是这一态的真实来源。
 */
export const CapabilityBlocked: Story = {
  args: {
    prompt: '跑一轮回归',
    disabledReason:
      '运行档位「acme-box」不支持无头任务（headlessTask=false）。请改用支持的档位重建沙箱，或改用交互式终端。',
  },
};

/**
 * 能力位**未知**（刷新后拿不到沙箱的 provider —— DTO 里没有这个字段）：
 * 不置灰，就地说明"以后端校验为准"。
 */
export const CapabilityUnknown: Story = {
  args: {
    capabilityUnknownNote:
      '无法确认这个沙箱的运行档位是否支持无头任务（刷新后拿不到档位信息），发起时以后端校验为准。',
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
