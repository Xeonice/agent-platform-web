import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VersionUpdateCardView } from '@/views/system/VersionUpdateCard.view';
import type { UpgradeDisplayModel } from '@/types/upgrade';

const initial: UpgradeDisplayModel = {
  phase: 'available',
  showEntry: true,
  showDot: true,
  title: '发现新版本',
  subtitle: '0.2.4 → 0.2.5 · 待升级',
  percent: null,
  progressText: null,
  lastSeenText: null,
  canUpgrade: true,
  canRefresh: false,
  facts: [],
  artifactDetails: [],
};
function card(model: UpgradeDisplayModel) {
  return (
    <VersionUpdateCardView
      model={model}
      headingRef={null}
      busy={false}
      isChecking={false}
      commandMessage={null}
      onCheck={vi.fn()}
      onUpgrade={vi.fn()}
      onRefresh={vi.fn()}
      onLater={vi.fn()}
      onDetails={vi.fn()}
    />
  );
}
const recovery: UpgradeDisplayModel = {
  ...initial,
  phase: 'recovery',
  title: '版本与更新',
  subtitle: '正在恢复服务',
  showEntry: false,
  canUpgrade: false,
  facts: [{ label: '本次升级结果', value: '最终目标曾确认完成 · 100%（历史）' }],
  recoverySummary: {
    stateText: '正在恢复服务',
    phaseText: '验证服务与原任务',
    confirmedAt: null,
    lastObservedAt: '2026-10-20T01:00:00.000Z',
    stale: false,
  },
};

describe('UPG persistent accessible state announcements', () => {
  it('updates one polite atomic status node through upgrade, recovery and actual confirmation', () => {
    const view = render(card(initial));
    const status = screen.getByRole('status', { name: '升级与恢复状态' });
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveClass('sr-only');
    view.rerender(
      card({
        ...initial,
        phase: 'ongoing',
        title: '实例升级中',
        canUpgrade: false,
        percent: 45,
        progressText: '验证服务与任务连续性 · 45%',
      }),
    );
    expect(screen.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    expect(status).toHaveTextContent('实例升级中。验证服务与任务连续性 · 45%');
    view.rerender(card(recovery));
    expect(screen.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    expect(status).toHaveTextContent('正在恢复服务。验证服务与原任务');
    expect(status).not.toHaveTextContent('100%');
    expect(status).not.toHaveTextContent('2026-10-20');
    view.rerender(
      card({
        ...recovery,
        recoverySummary: {
          ...recovery.recoverySummary!,
          stateText: '服务恢复已确认',
          phaseText: '恢复已确认',
          confirmedAt: '2026-10-20T01:01:10.000Z',
        },
      }),
    );
    expect(screen.getByRole('status', { name: '升级与恢复状态' })).toBe(status);
    expect(status).toHaveTextContent('服务恢复已确认。恢复已确认');
  });

  it('leaves the live DOM unchanged when only timestamps, elapsed time and diagnostic facts change', () => {
    const view = render(card(recovery));
    const status = screen.getByRole('status', { name: '升级与恢复状态' });
    const observer = new MutationObserver(() => undefined);
    observer.observe(status, { subtree: true, childList: true, characterData: true });
    view.rerender(
      card({
        ...recovery,
        lastSeenText: '最后确认 2026-10-20T01:00:01.000Z',
        artifactDetails: [{ label: '诊断关联标识', value: 'fault-only-in-details' }],
        recoverySummary: {
          ...recovery.recoverySummary!,
          lastObservedAt: '2026-10-20T01:00:01.000Z',
        },
      }),
    );
    expect(observer.takeRecords()).toEqual([]);
    view.rerender(
      card({
        ...initial,
        phase: 'ongoing',
        progressText: '本次总体进度待确认',
        stageProgress: {
          label: '安装包下载阶段',
          percent: 64,
          workText: '60.4 MB / 94.3 MB',
          elapsedText: '当前阶段已用 2:18',
          lastProgressText: '最后实质进展 刚刚',
          stale: false,
        },
      }),
    );
    observer.takeRecords();
    view.rerender(
      card({
        ...initial,
        phase: 'ongoing',
        progressText: '本次总体进度待确认',
        stageProgress: {
          label: '安装包下载阶段',
          percent: 64,
          workText: '60.4 MB / 94.3 MB',
          elapsedText: '当前阶段已用 2:19',
          lastProgressText: '最后实质进展 1 秒前',
          stale: false,
        },
      }),
    );
    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(status).toHaveTextContent('本次总体进度待确认。安装包下载阶段 · 64%（仅当前阶段）');
    expect(status).not.toHaveTextContent('2:19');
  });

  it('announces uncertain or blocked recovery without replaying the previous successful percentage', () => {
    const view = render(
      card({
        ...recovery,
        phase: 'unknown',
        recoverySummary: {
          ...recovery.recoverySummary!,
          stateText: '上次记录：服务恢复已确认 · 当前状态待确认',
          phaseText: '恢复已确认',
          stale: true,
        },
      }),
    );
    const status = screen.getByRole('status', { name: '升级与恢复状态' });
    expect(status).toHaveTextContent('当前状态待确认');
    expect(status).not.toHaveTextContent('100%');
    view.rerender(
      card({
        ...recovery,
        recoverySummary: {
          ...recovery.recoverySummary!,
          stateText: '恢复受阻',
          phaseText: '恢复受阻',
        },
      }),
    );
    expect(status).toHaveTextContent('恢复受阻');
    expect(status).not.toHaveTextContent('100%');
    view.rerender(card({ ...initial, phase: 'ongoing', progressText: null, percent: null }));
    expect(status).toHaveTextContent('等待进度确认');
    expect(status).not.toHaveTextContent('%');
  });
});
