import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { PresetImageDownloadView } from '@/views/image/PresetImageDownload.view';
const meta: Meta<typeof PresetImageDownloadView> = {
  title: 'Image/PresetImageDownload',
  component: PresetImageDownloadView,
  args: {
    offer: {
      from: 'ghcr.io/agent-infra/sandbox:latest',
      to: '本机镜像库',
      sizeBytes: 320 * 1024 * 1024,
      why: '可以提前下载',
    },
    isProvisioning: false,
  },
};
export default meta;
type Story = StoryObj<typeof PresetImageDownloadView>;
export const Ready: Story = {};
export const Downloading: Story = {
  args: {
    isProvisioning: true,
    progress: 0.37,
    elapsedSeconds: 18,
    statusText: '下载：正在读取镜像包',
  },
};
export const Unknown: Story = {
  args: { isProvisioning: true, progress: null, elapsedSeconds: 30 },
};
export const Failed: Story = {
  args: {
    error: '校验 sha256 对不上：已停在校验这一步，没有装载。',
    statusText: '校验完整性：正在校验镜像包…',
  },
};
