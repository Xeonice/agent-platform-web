import type { Preview } from '@storybook/nextjs-vite';
import '../src/app/globals.css';

const preview: Preview = {
  // 全局给所有 story 打 `test` tag，纳入 @storybook/addon-vitest 的浏览器测试（tagsFilter 默认只收 test）。
  tags: ['test'],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    backgrounds: { default: 'dark' },
  },
  // 产品全局暗色（P21 §3）：story 容器套 dark class。
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
};

export default preview;
