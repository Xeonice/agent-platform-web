import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TerminalTabBarView } from '@/views/terminal/TerminalTabBar.view';

const meta: Meta<typeof TerminalTabBarView> = {
  title: 'Terminal/TerminalTabBar',
  component: TerminalTabBarView,
};
export default meta;

type Story = StoryObj<typeof TerminalTabBarView>;

const noop = (): void => undefined;

const AGENT_TAB = { sessionId: 'sb-1:0', label: 'Agent', closable: false };
const TABS = [
  AGENT_TAB,
  { sessionId: 'sb-1:shell:1', label: '终端 1', closable: true },
  { sessionId: 'sb-1:shell:2', label: '终端 2', closable: true },
];

/**
 * ⭐ 单标签态：一个 Task 打开时的样子 —— 只有 Agent 那个会话，**没有 [×]**。
 *
 * MUTATION: 把 `closable` 改成 true ⇒ 第二条断言红。
 */
export const AgentOnly: Story = {
  args: {
    tabs: [AGENT_TAB],
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: noop,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tab', { name: 'Agent' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // ⛔ Agent 标签永远没有关闭键：关掉它并不会停下任务（后端只会 detach），
    //    那个按钮唯一能做到的就是让人以为按了就停了。
    await expect(canvas.queryByLabelText('关闭 Agent')).toBeNull();
  },
};

/**
 * ⭐ 多标签态 + **按钮叫「+ 新终端」**。
 *
 * ⚠️ 名字是有来历的：左下角 [＋ 新任务] 是发起一个新 Task，这里是在同一个 Task 里
 * 多开一个终端。两者曾经都叫"新建"，在同一屏上分不清（design-notes 2026-09 裁决）。
 *
 * MUTATION: 把按钮文案改回「+ 新建」⇒ 第一条断言红。
 */
export const MultipleTabs: Story = {
  args: {
    tabs: TABS,
    activeSessionId: 'sb-1:shell:1',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: noop,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('terminal-tab-new')).toHaveTextContent('+ 新终端');
    // ⛔ 不许出现「新建」二字（那是 [＋ 新任务] 那一侧的词）。
    await expect(canvas.getByTestId('terminal-tab-new').textContent).not.toContain('新建');
    // 用户自己开的标签才有 [×]，而且每个都有。
    await expect(canvas.getByLabelText('关闭 终端 1')).toBeInTheDocument();
    await expect(canvas.getByLabelText('关闭 终端 2')).toBeInTheDocument();
    await expect(canvas.getByRole('tab', { name: '终端 1' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

/**
 * ⭐ 点标签 / 点 [×] / 点 [+ 新终端] 各自只触发**自己**那个回调。
 *
 * ⚠️ [×] 与标签是**兄弟按钮**、不是嵌套的 —— 嵌套的话点关闭会顺带冒泡成一次选中，
 * 在"关掉当前标签"那一支上会看到一瞬间的切回再消失。这条断言钉住的就是"点 [×]
 * 只产生一次 close，不产生 select"。
 *
 * MUTATION: 把 [×] 挪进标签 button 里（或让它也调 onSelect）⇒ 第三条断言红。
 */
export const Interactions: Story = {
  args: {
    tabs: TABS,
    activeSessionId: 'sb-1:0',
    onSelect: fn(),
    onClose: fn(),
    onNewTerminal: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('tab', { name: '终端 2' }));
    await expect(args.onSelect).toHaveBeenCalledWith('sb-1:shell:2');

    await userEvent.click(canvas.getByTestId('terminal-tab-new'));
    await expect(args.onNewTerminal).toHaveBeenCalledTimes(1);

    await userEvent.click(canvas.getByLabelText('关闭 终端 1'));
    await expect(args.onClose).toHaveBeenCalledWith('sb-1:shell:1');
    // ⛔ 点 [×] 不许顺带产生一次选中（[×] 与标签是兄弟按钮，不是嵌套的）。
    await expect(args.onSelect).toHaveBeenCalledTimes(1);
  },
};

/**
 * ⭐ **清单问不出来**（06 §5.5 的第三态）。
 *
 * 后端分不清"这个任务下还有没有别的终端"时（tmux server 不在 / 沙箱不通），标签栏
 * **必须就地说出来**。
 *
 * ⛔ 为什么不能什么都不说：那等于让界面替后端断言"你只有这一个终端"——而真相可能是
 * 用户有三个正跑着构建的终端在沙箱里。这是本仓最硬的一条文案纪律（「不知道」不能说成
 * 「没有」）在这一屏上的落点。
 * ⛔ 文案里也不许出现"没有别的终端"：我们不知道。
 *
 * MUTATION: 把 `inventoryUnavailable` 那一支删掉（什么都不渲染）⇒ 第一条断言红；
 *           把文案改成「没有别的终端」⇒ 第二条红。
 */
export const InventoryUnavailable: Story = {
  args: {
    tabs: [AGENT_TAB],
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: noop,
    inventoryUnavailable: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const notice = canvas.getByTestId('terminal-inventory-unavailable');
    await expect(notice).toHaveTextContent('查不到');
    await expect(notice.textContent).not.toContain('没有');
  },
};

/**
 * 对照组：**确认没有**别的终端（后端答了，就是空清单）⇒ 什么都不说。
 * 那句"查不到"只属于第三态；在这里出现就会变成一句无缘无故的噪音。
 */
export const InventoryKnownEmpty: Story = {
  args: {
    tabs: [AGENT_TAB],
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: noop,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByTestId('terminal-inventory-unavailable')).toBeNull();
  },
};

/** 刷新后恢复出来的样子：Agent + 两个从后端清单补回来的终端（都可关）。 */
export const RestoredAfterReload: Story = {
  args: {
    tabs: TABS,
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: noop,
  },
};

/**
 * ⭐ [+ 新终端] 是个**下拉**：Codex / Claude Code / 终端（06 §5.6）。
 *
 * ⛔ 下拉里只列**这个沙箱里真的能跑的** CLI。没注入凭证的列出来就是一个点开必然失败
 * 的选项 —— 「点了再报错」正是这一版要避免的形状。
 *
 * ⚠️ 「Agent」与用户开的「Codex 1」跑的是同一个 CLI，但一个是任务本身（关不掉）、
 * 一个是随手开的（可关）。名字必须分得开。
 *
 * MUTATION: 把 `launchOptions` 里的 runtime 项删光 ⇒ 第一条断言红（退回成直接建纯终端）。
 */
export const LaunchMenu: Story = {
  args: {
    tabs: [AGENT_TAB, { sessionId: 'sb-1:shell:1', label: 'Codex 1', closable: true }],
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: fn(),
    launchOptions: [
      { runtimeId: 'codex', label: 'Codex' },
      { runtimeId: 'claude-code', label: 'Claude Code' },
      { label: '终端' },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('terminal-tab-new'));
    await expect(canvas.getByTestId('terminal-launch-menu')).toBeInTheDocument();

    // 选一个 CLI ⇒ 带着 runtimeId 上报。
    await userEvent.click(canvas.getByTestId('terminal-launch-claude-code'));
    await expect(args.onNewTerminal).toHaveBeenCalledWith('claude-code');

    // 纯终端那一项**不带** runtimeId（⛔ 不许给它编一个默认 runtime）。
    await userEvent.click(canvas.getByTestId('terminal-tab-new'));
    await userEvent.click(canvas.getByTestId('terminal-launch-shell'));
    await expect(args.onNewTerminal).toHaveBeenLastCalledWith(undefined);
  },
};

/**
 * 对照组：这个沙箱一个 CLI 都开不了（凭证全没配）⇒ [+ 新终端] **不出下拉**，
 * 点一下直接建一个纯终端。
 *
 * ⚠️ 一个只有一项的菜单是纯粹多出来的一次点击。
 */
export const LaunchMenuShellOnly: Story = {
  args: {
    tabs: [AGENT_TAB],
    activeSessionId: 'sb-1:0',
    onSelect: noop,
    onClose: noop,
    onNewTerminal: fn(),
    launchOptions: [{ label: '终端' }],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('terminal-tab-new'));
    await expect(canvas.queryByTestId('terminal-launch-menu')).toBeNull();
    // 零参调用 —— 与上一个 story 里显式传 `undefined` 不是同一件事（vitest 区分这两者），
    // 而这正是本用例要说的：没有别的可选时，[+ 新终端] 直接建一个纯终端。
    await expect(args.onNewTerminal).toHaveBeenCalledWith();
  },
};
