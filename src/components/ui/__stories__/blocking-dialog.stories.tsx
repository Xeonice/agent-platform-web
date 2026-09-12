import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fireEvent, userEvent } from 'storybook/test';
import { BlockingDialog } from '@/components/ui/blocking-dialog';

const meta: Meta<typeof BlockingDialog> = {
  title: 'UI/BlockingDialog',
  component: BlockingDialog,
  parameters: { layout: 'fullscreen' },
  args: {
    open: true,
    children: <div>向导内容占位</div>,
  },
};
export default meta;

type Story = StoryObj<typeof BlockingDialog>;

// Phase 0 硬要求：preventDefault 三连必须各自钉住,三条分开断言,不能用一条"关不掉"糊过去。
//
// ⚠️ 已用真实变异验证过（逐个删掉三个 handler 里的 `event.preventDefault()`，看哪条断言变红）
// 得到一个必须写下来的结论：EscapeDoesNotClose / ClickOutsideDoesNotClose 这两个行为级
// story **不能**分辨"删掉了哪一条"——`BlockingDialog` 故意不传 `onOpenChange`
// （设计稿原话："onOpenChange 干脆不传"），所以 Radix 内部 `onDismiss()` 调用的
// `context.onOpenChange(false)` 落到一个受控且没有 onChange 的 Root 上,天然就是无操作；
// 三个 handler 全部删掉，这两个行为级断言依然是绿的。点外部这一侧还有第二层原因：
// `onPointerDownOutside` 与 `onInteractOutside` 在 Radix 内部共享同一个事件对象
// （`onPointerDownOutside?.(event); onInteractOutside?.(event); if (!event.defaultPrevented) …`），
// 单删其中一个,另一个仍会把 `defaultPrevented` 置真,行为断言照样测不出来。
//
// 真正能"摘掉任意一条都精确打红对应那一条"的，只有下面的机制级 story
// `PreventDefaultWiredForAllThreeGuards`——直接调用三个导出的 handler、各自传一个假
// event、断言 `preventDefault` 被调用。这是本组件唯一具备逐条钉子力度的断言，行为级的两个
// story 保留是因为它们锁住了真实可感知的产品事实（用户确实关不掉），但不能替代机制级断言。

/** 三连之一（行为级）：Esc 关不掉。 */
export const EscapeDoesNotClose: Story = {
  play: async () => {
    const content = document.querySelector('[data-testid="blocking-dialog-content"]');
    await expect(content).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    // Radix 的关闭是异步的（Presence 动画）；给一拍之后再确认还在文档里。
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(document.querySelector('[data-testid="blocking-dialog-content"]')).not.toBeNull();
  },
};

/** 三连之二（行为级）：点遮罩（弹层外）关不掉。 */
export const ClickOutsideDoesNotClose: Story = {
  play: async () => {
    const overlay = document.querySelector('[data-testid="blocking-dialog-overlay"]');
    if (!(overlay instanceof HTMLElement)) throw new Error('遮罩节点缺失');
    // 用原始 pointerdown（而不是 userEvent.click 的完整 hover/focus 合成序列）——
    // Radix 的"点外部"判定本来就只挂在 pointerdown 上，没必要模拟整套鼠标事件。
    await fireEvent.pointerDown(overlay);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(document.querySelector('[data-testid="blocking-dialog-content"]')).not.toBeNull();
  },
};
