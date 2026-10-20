import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { OfflineNoticeView } from '@/views/init/OfflineNotice.view';

// view/stories 不跨层引用 lib；这里提供明确探测目标范围的展示夹具。
const OFFLINE_VERDICT_TEXT =
  '本次探测的模型 API 目标均未连通。任务实际连通性以其配置和执行结果为准。';

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
    // 确认只表示了解探测快照，不是全部 Agent 的能力结论。
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('只覆盖上列探测目标');
    await expect(canvas.getByTestId('offline-notice')).toHaveTextContent('不代表所有 Agent 不可用');
    // ⛔ 不点名具体 runtime：runtime 是开放注册表，点名的那句在装了第三方 runtime 的
    //    平台上是错的（判定与文案都在 lib，本页只负责把它原样说出来）。
    await expect(canvas.getByTestId('offline-notice')).not.toHaveTextContent(/codex|claude/i);
    // MUTATION：把 `<X>` 换回 🔴 字符或换成另一个图标 ⇒ 这条先红。
    await expect(canvas.getByTestId('offline-notice').querySelector('svg.lucide-x')).not.toBeNull();
    await userEvent.click(button);
    await expect(args.onContinue).toHaveBeenCalled();
  },
};

/** 确认之后**不消失**：用户要能看见自己确认了什么。 */
export const Acknowledged: Story = {
  args: { acknowledged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const ack = canvas.getByTestId('offline-acknowledged');
    await expect(ack).toHaveTextContent('确认不会禁用任务入口');
    await expect(ack.querySelector('svg.lucide-check')).not.toBeNull();
    await expect(canvas.queryByRole('button', { name: '我知道，继续' })).toBeNull();
  },
};
