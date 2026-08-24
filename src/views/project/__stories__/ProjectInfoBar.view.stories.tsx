import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ProjectInfoBarView } from '@/views/project/ProjectInfoBar.view';

const noop = (): void => undefined;

const meta: Meta<typeof ProjectInfoBarView> = {
  title: 'Project/ProjectInfoBar',
  component: ProjectInfoBarView,
  parameters: { layout: 'fullscreen' },
  args: {
    projectName: 'acme-web',
    sourceType: 'git',
    repoUrl: 'https://github.com/acme/acme-web.git',
    repoBranch: 'develop',
    baselineSizeBytes: 47_185_920,
    updatedAt: '2026-08-20T09:30:00.000Z',
    createdAt: '2026-08-01T09:30:00.000Z',
    canSync: true,
    syncing: false,
    onSync: noop,
  },
};
export default meta;

type Story = StoryObj<typeof ProjectInfoBarView>;

/** 常态：四个字段全在，[重新同步] 可点。 */
export const GitReady: Story = {};

/** 同步中：按钮转 loading 并禁用（不给连点起两条同步）。 */
export const Syncing: Story = { args: { syncing: true } };

/** 同步失败：就地红字，条本身不消失（用户还得看得见自己在拿什么代码干活）。 */
export const SyncFailed: Story = { args: { syncErrorMessage: '同步失败：远端不可访问' } };

/**
 * 非 `ready` 态（克隆中 / 克隆失败）：**不给 [重新同步]**（§9.3 只对 ready 开放）。
 */
export const NotReady: Story = { args: { canSync: false } };

/**
 * 空项目：整条降级为"空项目（无远端）"，时间格显示的是**创建时间**
 *（它从来没同步过，留一个空格子会被读成"同步过但没记下来"）。
 */
export const EmptyProject: Story = {
  args: {
    projectName: '临时草稿',
    sourceType: 'empty',
    repoUrl: undefined,
    repoBranch: undefined,
    baselineSizeBytes: undefined,
    updatedAt: undefined,
  },
};

/**
 * ⏳ DTO 四字段尚未由后端下发时的降级：逐格显示 `—`，**条本身照常渲染**
 *（契约同步后自然填满，见 `types/project.ts` 的 PendingProjectBaselineFields）。
 */
export const ContractPending: Story = {
  args: { repoUrl: undefined, repoBranch: undefined, baselineSizeBytes: undefined },
};
