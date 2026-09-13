import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { InitWizardShellView } from '@/views/init/InitWizardShell.view';
import type { InitStepKey, InitStepModel } from '@/types/init';

// ⚠️ story 位于 `src/views/` 下，被 boundaries 归类为 `view` 元素 ⇒ **不能 import `lib/`**。
// 所以这里手搭 model（与 `lib/system/initWizardModel.ts::initSteps` 同形），
// 那条派生逻辑自己的用例在 `lib/system/__tests__/initWizardModel.test.ts`。
const ORDER: InitStepKey[] = ['connectivity', 'proxy', 'preset-image', 'subscription', 'resource'];
const LABEL: Record<InitStepKey, string> = {
  connectivity: '出网检测',
  proxy: '代理配置',
  'preset-image': '沙箱镜像',
  subscription: '订阅配置',
  resource: '资源确认',
};
function steps(current: InitStepKey, proxyActive: boolean): InitStepModel[] {
  const currentIndex = ORDER.indexOf(current);
  return ORDER.map((key, i) => ({
    key,
    ordinal: i + 1,
    label: LABEL[key],
    active: key === 'proxy' ? proxyActive : true,
    // ⚠️ 这份手搭 model 跟着 `initSteps` 的语义走：done = **达成**，skipped = 走过没达成。
    //    story 只演渲染，不演判定 —— 判定的用例在 `lib/system/__tests__/initWizardModel.test.ts`。
    done: i < currentIndex,
    skipped: false,
    current: key === current,
  }));
}

const meta: Meta<typeof InitWizardShellView> = {
  title: 'Init/InitWizardShell',
  component: InitWizardShellView,
  parameters: { layout: 'fullscreen' },
  args: {
    steps: steps('connectivity', true),
    title: '第 1 步 · 出网可达性',
    description: '平台需要够得着模型 API 与镜像仓库。',
    children: <p>内容插槽</p>,
    onNext: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof InitWizardShellView>;

export const Step1: Story = {};

export const Step2: Story = {
  args: {
    steps: steps('proxy', true),
    title: '第 2 步 · 代理配置',
    description: '上一步有目标不可达。',
    onBack: fn(),
  },
};

export const Step3: Story = {
  args: {
    steps: steps('preset-image', true),
    title: '第 3 步 · 沙箱镜像就绪',
    description: '平台自建的沙箱镜像备齐了没有。',
    onBack: fn(),
    nextLabel: '稍后配置，下一步',
    footerNote: '⚠️ 跳过后平台能进、项目能建，但在镜像就绪之前无法发起任何任务。',
  },
};

/** 出网全通过 ⇒ 代理那一步标「可跳过」而**不隐藏**（步数不跳动）。 */
export const ProxySkippable: Story = {
  args: { steps: steps('connectivity', false) },
  // ⚠️ 内容经 `BlockingDialog` 的 `Portal` 挂到 `document.body`，⛔ 不在 `canvasElement` 内。
  play: async () => {
    const body = within(document.body);
    await expect(body.getByTestId('init-step-proxy')).toHaveTextContent('可跳过');
  },
};

/**
 * ⭐ **阻塞语义的回归**（F21-8 §2 / §7.2）：向导里没有 [取消]，Esc 也不会触发任何关闭。
 *
 * 这是全局 Esc 分层规则（P20 §8.4）的唯一例外 —— 关掉向导之后没有"回到哪里"，
 * `AppBootGate` 在 `initialized === false` 时压根不挂载工作台。
 *
 * ⚠️ **本壳现在是 `BlockingDialog`，内容经 Radix `Portal` 挂到 `document.body`**，
 * ⛔ 不在 `canvasElement` 子树内——下面几条 play 函数改用 `within(document.body)`（与
 * `ui/__stories__/blocking-dialog.stories.tsx` 同一条约定），而不是 `canvas`。
 */
/**
 * ⭐ **第一屏的第一行字要说得出"要做什么、多长"。**
 * 原文只有「平台初始化」四个字 —— 用户的第一反应是"还要装多久"，而屏幕上没有任何答案。
 * ⛔ **不许承诺时间**（"约 5 分钟"是编的）：说得出的是**步数**与**哪一步要离开这一页**。
 */
export const TitleSaysWhatAndHowLong: Story = {
  play: async () => {
    const body = within(document.body);
    const heading = body.getByRole('heading', { level: 1 });
    await expect(heading).toHaveTextContent('共 5 步');
    const wizard = body.getByTestId('init-wizard');
    await expect(wizard).toHaveTextContent('只有配模型帐号那一步需要你离开这一页');
    // ⛔ 不许承诺时间。
    await expect(heading).not.toHaveTextContent('分钟');
  },
};

/**
 * ⚠️ **这条 story 冻住的是产品事实**（"按 Esc / 点遮罩外，向导确实还在"），⛔ **不是**三条
 * `preventDefault` 守卫本身的证据——真的用变异验证过：把 `blocking-dialog.tsx` 里三个
 * `onEscapeKeyDown`/`onInteractOutside`/`onPointerDownOutside` **全部**摘掉，这条 story
 * 依然全绿。原因与 Phase 0 的发现完全一致（见 `blocking-dialog.tsx` 顶部注释、
 * `blocking-dialog.stories.tsx` 里 `PreventDefaultWiredForAllThreeGuards` 上方那段）：
 * `BlockingDialog` 故意不传 `onOpenChange`，Radix 因 Esc/点外部触发的 `onDismiss()` 落到
 * 一个没有回调的受控 Root 上本来就是空操作——**这一层"关不掉"是"没有可以被翻转的 open
 * 状态"这件事本身决定的，不是三条 preventDefault 决定的**。三条守卫是否接线正确，唯一
 * 具备"摘掉任意一条都精确变红"钉子力度的是 `blocking-dialog.stories.tsx` 的
 * `PreventDefaultWiredForAllThreeGuards`（机制级：直接调用三个导出的 handler 断言
 * `preventDefault` 被调用）——本文件不重复造一个测不出问题的行为断言。
 *
 * 本文件在这一层要守的是**另一件事**：`InitWizardShellView` 真的接了 `BlockingDialog`，
 * 而不是自己糊一个 `role="dialog"` 的 div（那样的话上面那条"产品事实"就无处安放——
 * 见下面的 `UsesBlockingDialog`）。
 */
export const NoCancelNoEscape: Story = {
  play: async () => {
    const body = within(document.body);
    // DOM 里根本没有取消/关闭。
    await expect(body.queryByRole('button', { name: '取消' })).toBeNull();
    await expect(body.queryByRole('button', { name: '关闭' })).toBeNull();
    await expect(body.queryByRole('button', { name: '✕' })).toBeNull();

    // 按 Esc 之后向导仍在（产品事实的回归冻结，见上方大注释）。
    await userEvent.keyboard('{Escape}');
    // Radix 的关闭是异步的（Presence 动画）；给一拍之后再确认还在文档里。
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(body.getByTestId('init-wizard')).toBeInTheDocument();

    // 点遮罩外同样关不掉（同一条产品事实）。
    const overlay = document.querySelector('[data-testid="blocking-dialog-overlay"]');
    if (overlay instanceof HTMLElement) {
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(body.getByTestId('init-wizard')).toBeInTheDocument();
  },
};

/**
 * ⭐ **本壳真的接了 `BlockingDialog`，不是自己写的 `<div role="dialog">`。**
 *
 * 这是上面 `NoCancelNoEscape` 那条"关不掉"回归的**前提**——如果本壳退回手写 div（哪怕
 * 手写版本本身也没有 Esc 监听、行为上一样"关不掉"），`NoCancelNoEscape` 依然会绿，
 * 但那时"关不掉"就不再是 `BlockingDialog` 提供的、全站统一维护的那一份实现，而是本文件
 * 自己重新发明的一套——正是设计稿要收敛掉的重复实现。
 *
 * MUTATION：把 `InitWizardShell.view.tsx` 里的 `<BlockingDialog>` 换回
 * `<div role="dialog" aria-modal>` ⇒ 这两个 testid 找不到，本条红；而 `NoCancelNoEscape`
 * 不会红——这正是这条 story 存在的理由。
 */
export const UsesBlockingDialog: Story = {
  play: async () => {
    const body = within(document.body);
    await expect(body.getByTestId('blocking-dialog-content')).toBeInTheDocument();
    await expect(body.getByTestId('blocking-dialog-overlay')).toBeInTheDocument();
  },
};

/**
 * 步骤指示条的三态标记：达成 / 走过没达成 / 还没走到。
 *
 * ⚠️ **锁到具体是哪一个 lucide 组件，⛔ 不能只锁 `data-done`/`data-skipped`**：
 * 那两个属性在「有图标」「没图标」两种写法下都一样，锁不住"标记真的画出来了没有"。
 * 这个项目里这类假绿已经实测到六次。
 *
 * ⚠️ class 按**实际渲染**写：lucide 的 `AlertTriangle` 渲染出来是 `lucide-triangle-alert`
 * （历史别名），⛔ 别照组件名猜成 `lucide-alert-triangle`。
 *
 * ⛔ 这里曾经是 `{s.done ? '✅ ' : s.skipped ? '⚠️ ' : ''}` —— emoji 的字形与尺寸随系统字体
 * 变，跟旁边的文字对不齐，也吃不到设计 token 的颜色。`scripts/check-no-emoji.ts` 现在会拦。
 */
export const StepMarkersUseLucideNotEmoji: Story = {
  args: {
    ...Step3.args,
    steps: [
      {
        key: 'connectivity',
        ordinal: 1,
        label: '达成的',
        done: true,
        skipped: false,
        current: false,
        active: true,
      },
      {
        key: 'proxy',
        ordinal: 2,
        label: '跳过的',
        done: false,
        skipped: true,
        current: false,
        active: true,
      },
      {
        key: 'preset-image',
        ordinal: 3,
        label: '没走到的',
        done: false,
        skipped: false,
        current: true,
        active: true,
      },
    ],
  },
  play: async () => {
    // ⚠️ `BlockingDialog` 走 portal，内容**不在 `canvasElement` 子树内**（同文件 §87 那条
    //    注释早就写明了，我第一版照抄成 `canvasElement` 直接找不到元素）。
    const body = within(document.body);
    const done = body.getByTestId('init-step-connectivity');
    const skipped = body.getByTestId('init-step-proxy');
    const pending = body.getByTestId('init-step-preset-image');

    await expect(done.querySelector('svg.lucide-check')).not.toBeNull();
    await expect(skipped.querySelector('svg.lucide-triangle-alert')).not.toBeNull();
    // ⛔ 还没走到的那一格**不该有任何标记** —— 它与「跳过」共用无标记时，
    //    用户没法从指示条上看出自己跳过了什么（这正是三态要分开的理由）。
    await expect(pending.querySelector('svg')).toBeNull();

    // ⛔ 一处都不许倒退回 emoji。
    for (const el of [done, skipped, pending]) {
      await expect(el.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  },
};
