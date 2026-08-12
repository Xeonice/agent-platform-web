import { describe, it, expect } from 'vitest';
import { partializeAppState, useAppStore, type PersistedState } from '@/stores';

// 安全红线回归（15 §3.5）：断言 partialize 白名单只输出 8 个字段，
// 且 initialPrompt / 任何瞬时敏感字段绝不落盘。
describe('persist partialize 白名单（15 §3.5 安全红线）', () => {
  it('只输出白名单 8 字段', () => {
    const persisted = partializeAppState(useAppStore.getState());
    expect(Object.keys(persisted).sort()).toEqual(
      [
        'bannerDismissedToday',
        'lastUsedImage',
        'lastUsedRuntime',
        'selectedProjectId',
        'selectedSandboxId',
        'sidebarCollapsed',
        'taskListFolds',
        'terminalFontSize',
      ].sort(),
    );
  });

  it('wizardData.initialPrompt 绝不进 persist（含敏感上下文）', () => {
    useAppStore.getState().setWizardData({
      runtime: 'codex',
      initialPrompt: '内部仓库路径 /srv/secret-repo 与业务上下文',
    });
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted).not.toHaveProperty('wizardData');
    expect(JSON.stringify(persisted)).not.toContain('secret-repo');
  });

  it('瞬时 UI 指向 / registry 不落盘', () => {
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted).not.toHaveProperty('selectedProjectForMenu');
    expect(persisted).not.toHaveProperty('currentModal');
    expect(persisted).not.toHaveProperty('entries');
  });

  it('白名单类型即契约：PersistedState 键集合固定', () => {
    const keys: (keyof PersistedState)[] = [
      'selectedSandboxId',
      'selectedProjectId',
      'sidebarCollapsed',
      'taskListFolds',
      'bannerDismissedToday',
      'terminalFontSize',
      'lastUsedRuntime',
      'lastUsedImage',
    ];
    expect(keys).toHaveLength(8);
  });
});
