import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { OfflineNoticeView } from '@/views/init/OfflineNotice.view';

/**
 * 离线结论那句话的**出处是 `lib/system/connectivityVerdict.ts`**，本文件只是把它当 story
 * 夹具复制一份 —— view 层（含 story）被 boundaries 禁止 import `lib/`，复制不可避免。
 * ⚠️ 它与生产文案分叉时，红的是 `lib/system/__tests__/connectivityVerdict.test.ts`
 * 里那条「⛔ 不许点名具体 runtime」的用例，不是这里。
 */
const OFFLINE_VERDICT_TEXT =
  '当前为离线环境，Agent 将不可用 —— 每个 runtime 都必须能访问自己的模型 API，这是物理约束，不是配置问题。' +
  '平台其余功能（项目管理、凭证与镜像配置、系统诊断）照常可用。';

const meta: Meta<typeof OfflineNoticeView> = {
  title: 'Init/OfflineNotice',
  component: OfflineNoticeView,
  parameters: { layout: 'padded' },
  args: { verdictText: OFFLINE_VERDICT_TEXT, acknowledged: false, onContinue: fn() },
};
export default meta;

type Story = StoryObj<typeof OfflineNoticeView>;

/**
 * ⭐ **[继续] 必须可点**（F21-8 §7.2）：离线不阻断初始化 —— air-gapped 是产品支持的一档部署
 * （P21-8 §1），把它做成"离线就不让装"等于把一个受支持的形态堵死。
 */
export const Offline: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: '我知道，继续' });
    await expect(button).toBeEnabled();
    // 说清是**物理约束**而不是"请检查网络设置"——后者会让用户在一台确实没外网的机器上一直找自己的错。
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('物理约束');
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('其余功能');
    // ⛔ 不点名具体 runtime：runtime 是开放注册表，点名的那句在装了第三方 runtime 的
    //    平台上是错的（判定与文案都在 lib，本页只负责把它原样说出来）。
    await expect(canvas.getByTestId('offline-notice')).not.toHaveTextContent(/codex|claude/i);
    await userEvent.click(button);
    await expect(args.onContinue).toHaveBeenCalled();
  },
};

/** 确认之后**不消失**：用户要能看见自己确认了什么。 */
export const Acknowledged: Story = {
  args: { acknowledged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('offline-acknowledged')).toHaveTextContent(
      '已确认以离线模式继续',
    );
    await expect(canvas.queryByRole('button', { name: '我知道，继续' })).toBeNull();
  },
};
