import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { TerminalTabBarView } from '@/views/terminal/TerminalTabBar.view';
import { TerminalToolbarView } from '@/views/terminal/TerminalToolbar.view';
import { TerminalPaneView } from '@/views/terminal/TerminalPane.view';

const meta: Meta<typeof TerminalPaneView> = {
  title: 'Terminal/TerminalPane',
  component: TerminalPaneView,
  decorators: [
    (Story) => (
      <div className="h-80">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof TerminalPaneView>;

// 实例活在 registry（08 §7.4），view 只持 div ref；story 展示空态与容器骨架。
export const Empty: Story = { args: { empty: true } };
export const ContainerOnly: Story = { args: { empty: false } };

/** 画布下面没有相框空隙；工具在同一终端栏。 */
export const WithTerminalBar: Story = {
  render: () => (
    <div className="flex h-full flex-col">
      <TerminalTabBarView
        tabs={[{ sessionId: 'demo:0', label: 'Agent', closable: false }]}
        activeSessionId="demo:0"
        onSelect={() => undefined}
        onClose={() => undefined}
        onNewTerminal={() => undefined}
        toolsSlot={
          <div className="ml-auto shrink-0">
            <TerminalToolbarView
              onCopy={() => undefined}
              onClear={() => undefined}
              onDecreaseFontSize={() => undefined}
              onIncreaseFontSize={() => undefined}
            />
          </div>
        }
      />
      <div className="min-h-0 flex-1">
        <TerminalPaneView />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: '当前终端工具' })).toBeInTheDocument();
    await expect(canvas.getByTestId('terminal-tab-bar').getBoundingClientRect().height).toBe(40);
  },
};
