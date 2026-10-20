import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { upgradeViewFixture } from './versionUpdateFixture';
import { VersionUpdateCardView } from '@/views/system/VersionUpdateCard.view';
const meta: Meta<typeof VersionUpdateCardView> = {
  title: 'System/VersionUpdateCard',
  component: VersionUpdateCardView,
  args: {
    model: upgradeViewFixture(),
    busy: false,
    isChecking: false,
    commandMessage: null,
    onCheck: fn(),
    onUpgrade: fn(),
    onRefresh: fn(),
    onLater: fn(),
    onDetails: fn(),
    headingRef: null,
  },
};
export default meta;
type Story = StoryObj<typeof VersionUpdateCardView>;
export const Available: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: '版本与更新' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: '立即升级' }));
    await expect(args.onUpgrade).toHaveBeenCalledOnce();
  },
};
export const UpgradeUnavailable: Story = {
  args: { model: upgradeViewFixture({ canUpgrade: false }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: '授权升级' })).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '检查更新' })).toBeVisible();
  },
};
export const Unknown: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'unknown',
      title: '版本与更新',
      subtitle: '暂时无法确认版本与升级状态',
      showEntry: false,
      canUpgrade: false,
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '检查状态' })).toBeVisible();
  },
};
export const PartialFailure: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'failed',
      title: '本次升级未完成',
      subtitle: '升级未完成，部分组件已更新',
      showEntry: false,
      showDot: false,
      canUpgrade: false,
      canContinueWorking: true,
      diagnosticText: '脱敏设计诊断',
      facts: [
        { label: '服务可用性', value: '可继续使用' },
        { label: '上次完整确认版本', value: '0.2.4' },
        { label: '本次最终目标', value: '0.2.5 · 未完成' },
      ],
    }),
    onContinue: fn(),
    onCopyDiagnostics: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '继续使用' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '复制诊断信息' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
  },
};
export const BridgeConfirmedContinueFinal: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'ongoing',
      title: '正在升级到最终版本',
      subtitle: '0.2.5 · 兼容准备完成，继续更新最终版本',
      canUpgrade: false,
      percent: null,
      progressText: '本次总体进度待确认；按实际阶段展示',
    }),
  },
};
export const IndependentRecovery: Story = {
  args: {
    model: upgradeViewFixture({
      phase: 'recovery',
      title: '版本与更新',
      subtitle: '正在恢复服务',
      showEntry: false,
      showDot: false,
      canUpgrade: false,
      diagnosticText: 'trace-recovery-1',
      facts: [
        { label: '上次完整确认版本', value: '0.2.4' },
        { label: '本次升级结果', value: '最终目标曾确认完成 · 100%（历史）' },
      ],
      recoverySummary: {
        stateText: '正在恢复服务',
        phaseText: '验证服务与原任务',
        confirmedAt: null,
        lastObservedAt: '2026-10-20T01:00:00.000Z',
        stale: false,
      },
      artifactDetails: [
        { label: '升级控制系统版本', value: 'control-1.0.0' },
        { label: '升级控制协议', value: '1' },
        { label: '诊断关联标识', value: 'trace-recovery-1' },
      ],
    }),
    onCopyDiagnostics: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: '失败恢复' })).toBeVisible();
    await expect(canvas.getByText('最终目标曾确认完成 · 100%（历史）')).toBeVisible();
    await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
    await expect(canvas.getByText('control-1.0.0')).not.toBeVisible();
    await userEvent.click(canvas.getByText('运行产物详情'));
    await expect(canvas.getByText('control-1.0.0')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '立即升级' })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: '复制诊断信息' }));
    await expect(args.onCopyDiagnostics).toHaveBeenCalledOnce();
  },
};

export const AccessibleStateTransitions: Story = {
  render: function StateTransitions(args) {
    const [model, setModel] = useState(args.model);
    return (
      <div className="space-y-3">
        <VersionUpdateCardView {...args} model={model} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setModel(
                upgradeViewFixture({
                  phase: 'ongoing',
                  title: '实例升级中',
                  canUpgrade: false,
                  percent: 45,
                  progressText: '验证服务与任务连续性 · 45%',
                }),
              );
            }}
          >
            演示升级进度
          </button>
          <button
            type="button"
            onClick={() => {
              setModel(
                upgradeViewFixture({
                  phase: 'recovery',
                  title: '版本与更新',
                  subtitle: '正在恢复服务',
                  canUpgrade: false,
                  showEntry: false,
                  percent: null,
                  facts: [{ label: '本次升级结果', value: '最终目标曾确认完成 · 100%（历史）' }],
                  recoverySummary: {
                    stateText: '正在恢复服务',
                    phaseText: '验证服务与原任务',
                    confirmedAt: null,
                    lastObservedAt: '2026-10-20T01:00:00.000Z',
                    stale: false,
                  },
                }),
              );
            }}
          >
            演示恢复阶段
          </button>
          <button
            type="button"
            onClick={() => {
              setModel((current) => ({
                ...current,
                recoverySummary:
                  current.recoverySummary === undefined
                    ? undefined
                    : {
                        ...current.recoverySummary,
                        lastObservedAt: '2026-10-20T01:00:01.000Z',
                      },
              }));
            }}
          >
            演示观测时间更新
          </button>
          <button
            type="button"
            onClick={() => {
              setModel((current) => ({
                ...current,
                recoverySummary:
                  current.recoverySummary === undefined
                    ? undefined
                    : {
                        ...current.recoverySummary,
                        stateText: '服务恢复已确认',
                        phaseText: '恢复已确认',
                        confirmedAt: '2026-10-20T01:01:10.000Z',
                      },
              }));
            }}
          >
            演示恢复确认
          </button>
        </div>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByRole('status', { name: '升级与恢复状态' });
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(status).toHaveAttribute('aria-atomic', 'true');
    await expect(status).toHaveClass('sr-only');
    await expect(window.getComputedStyle(status).position).toBe('absolute');
    await userEvent.click(canvas.getByRole('button', { name: '演示升级进度' }));
    await expect(canvas.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    await expect(status).toHaveTextContent('实例升级中。验证服务与任务连续性 · 45%');
    await userEvent.click(canvas.getByRole('button', { name: '演示恢复阶段' }));
    await expect(canvas.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    await expect(status).toHaveTextContent('正在恢复服务。验证服务与原任务');
    await expect(status).not.toHaveTextContent('100%');
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(status, { subtree: true, childList: true, characterData: true });
    await userEvent.click(canvas.getByRole('button', { name: '演示观测时间更新' }));
    await expect(status).not.toHaveTextContent('2026-10-20');
    await expect([...mutations, ...observer.takeRecords()]).toEqual([]);
    observer.disconnect();
    await userEvent.click(canvas.getByRole('button', { name: '演示恢复确认' }));
    await expect(canvas.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    await expect(status).toHaveTextContent('服务恢复已确认。恢复已确认');
  },
};
