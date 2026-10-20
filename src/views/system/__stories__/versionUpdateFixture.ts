import type { UpgradeDisplayModel } from '@/types/upgrade';
/** Pure-view fixture, not controller or release evidence. */
export function upgradeViewFixture(over: Partial<UpgradeDisplayModel> = {}): UpgradeDisplayModel {
  return {
    phase: 'available',
    showEntry: true,
    showDot: true,
    title: '发现新版本',
    subtitle: '0.2.4 → 0.2.5 · 待升级',
    percent: null,
    progressText: null,
    lastSeenText: '上次确认 2026-10-12 12:00',
    canUpgrade: true,
    canRefresh: false,
    facts: [
      { label: '当前服务版本', value: '0.2.4' },
      { label: '当前页面版本', value: '0.2.4' },
      { label: '可安装版本', value: '0.2.5' },
    ],
    artifactDetails: [],
    ...over,
  };
}
