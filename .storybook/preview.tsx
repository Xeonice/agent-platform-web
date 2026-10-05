import type { Preview } from '@storybook/nextjs-vite';
import { useLayoutEffect, type ReactNode } from 'react';
import '../src/app/globals.css';

function ThemePreview({ children, theme }: { children: ReactNode; theme: string }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('dark', wasDark);
    };
  }, [theme]);
  return <div className="min-h-screen bg-background text-foreground">{children}</div>;
}

const preview: Preview = {
  initialGlobals: { theme: 'dark' },
  globalTypes: {
    theme: {
      description: 'Application theme, including portaled dialogs',
      toolbar: { icon: 'circlehollow', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  // 全局给所有 story 打 `test` tag，纳入 @storybook/addon-vitest 的浏览器测试（tagsFilter 默认只收 test）。
  tags: ['test'],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { default: 'dark' },
  },
  // Match the application root: Radix portals also need the chosen theme.
  decorators: [
    (Story, context) => (
      <ThemePreview theme={String(context.globals['theme'] ?? 'dark')}>
        <Story />
      </ThemePreview>
    ),
  ],
};

export default preview;
