import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { ImageRequirementsPanelView } from '@/views/image/ImageRequirementsPanel.view';

const noop = (): void => undefined;

const meta: Meta<typeof ImageRequirementsPanelView> = {
  title: 'Image/ImageRequirementsPanel',
  component: ImageRequirementsPanelView,
  parameters: { layout: 'fullscreen' },
  args: { onClose: noop },
};
export default meta;

type Story = StoryObj<typeof ImageRequirementsPanelView>;

/**
 * 四条要求 —— play 钉住这一版修掉的三件事：
 *  ① ⛔ **不许出现 `platform.tmux=true` 这个标签要求**：后端 2026-08 删了那个检查
 *     （标签会被派生镜像继承因而会说谎），照着打标签的人注册照样被拒；
 *  ② **必须有「血统 / 来源」那一条**：真正会拒绝用户的是 `IMAGE_BASE_REQUIRED`，
 *     而旧版三条里它一个字都没有 —— 看完"要求"、照做、仍然被拒；
 *  ③ ⛔ **不许出现耗时数字**：「12.5 分钟」是 aio 那一档的数字，按档差一个数量级。
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId('image-requirements-panel');

    // ① 那个已被后端删掉的标签要求不许再教给用户。
    await expect(panel).not.toHaveTextContent('platform.tmux=true');
    // ② 血统那一条在，且被标成"会拦住你"。
    await expect(canvas.getByTestId('image-requirement-lineage')).toHaveAttribute(
      'data-blocking',
      'true',
    );
    await expect(canvas.getByTestId('image-requirement-entrypoint')).toHaveAttribute(
      'data-blocking',
      'true',
    );
    // tmux 与预装 CLI 都**不拦**注册 —— 写成"必须"会让用户去做无用功。
    await expect(canvas.getByTestId('image-requirement-tmux')).toHaveAttribute(
      'data-blocking',
      'false',
    );
    await expect(canvas.getByTestId('image-requirement-preinstall')).toHaveAttribute(
      'data-blocking',
      'false',
    );
    // ③ 不点耗时数字。
    await expect(panel).not.toHaveTextContent('12.5');
    await expect(panel).not.toHaveTextContent('分钟');
    // MUTATION：把标题的 `<ClipboardList>` 换回 📋 字符或换成另一个图标 ⇒ 这条先红。
    await expect(
      canvas.getByRole('heading').querySelector('svg.lucide-clipboard-list'),
    ).not.toBeNull();
  },
};

/** ⚠️ **不是 dialog**：注册弹窗开着时也要能对照着看，所以它不抢焦点、不阻塞。 */
export const NotADialog: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('dialog')).toBeNull();
    await expect(canvas.getByRole('complementary', { name: '平台对镜像的要求' })).toBeVisible();
  },
};
