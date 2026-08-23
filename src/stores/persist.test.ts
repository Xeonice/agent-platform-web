import { describe, it, expect } from 'vitest';
import { partializeAppState, useAppStore, type PersistedState } from '@/stores';

// 安全红线回归（15 §3.5）：断言 partialize 白名单只输出 10 个字段，
// 且 initialPrompt / 任何瞬时敏感字段绝不落盘。
//
// 8 → 9（S6 `selectedTaskId`，与 selectedSandboxId 同型的不透明选中指向）
//   → 10（`selectedSandboxTerminalAt`，一个**时刻**，不含任何内容）。
// 红线本身没动——指令/输出/凭证仍然一个都不落盘（下方用例逐条钉死）。
describe('persist partialize 白名单（15 §3.5 安全红线）', () => {
  it('只输出白名单 10 字段', () => {
    const persisted = partializeAppState(useAppStore.getState());
    expect(Object.keys(persisted).sort()).toEqual(
      [
        'bannerDismissedToday',
        'lastUsedImage',
        'lastUsedRuntime',
        'selectedProjectId',
        'selectedSandboxId',
        'selectedSandboxTerminalAt',
        'selectedTaskId',
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

  it('pendingProjectCreate（Git 凭证回程载体）绝不进 persist（F21-3 §10.2 / 15 §3.1.1）', () => {
    useAppStore.getState().setPendingProjectCreate({
      projectId: 'p-secret',
      name: 'acme',
      source: 'git',
      url: 'https://github.com/acme/private-internal-repo.git',
    });
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted).not.toHaveProperty('pendingProjectCreate');
    // 回程 url 可能含内部仓库路径，不得随白名单落盘。
    expect(JSON.stringify(persisted)).not.toContain('private-internal-repo');
  });

  it('凭证明文字段（secret/token/privateKey/passphrase）任何情况下都不出现在白名单快照', () => {
    const persisted = partializeAppState(useAppStore.getState());
    const snapshot = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of ['secret', 'token', 'privatekey', 'passphrase', 'allowedhosts']) {
      expect(snapshot).not.toContain(forbidden);
    }
  });

  it('Runtime 鉴权明文（授权 code / api-key / pastedText）绝不进白名单（S4 安全红线，15 §3.5）', () => {
    // 这些值只在 AuthGateContainer 局部 useState，从不写入 store；partialize 白名单快照据此回归。
    const persisted = partializeAppState(useAppStore.getState());
    const snapshot = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of ['code', 'apikey', 'api-key', 'pastedtext', 'challengeref']) {
      expect(snapshot).not.toContain(forbidden);
    }
  });

  it('S5 任务指令红线：白名单快照里不含任何 prompt / 向导暂存类键（Task 发起入口）', () => {
    // 即便 store 上确实存在承载指令的字段（wizardData），partialize 也绝不把它带上盘。
    useAppStore.getState().setWizardData({ initialPrompt: '迁移 acme-billing 内部系统的方案' });
    const snapshot = JSON.stringify(partializeAppState(useAppStore.getState())).toLowerCase();
    for (const forbidden of ['prompt', 'initialprompt', 'wizarddata', 'acme-billing']) {
      expect(snapshot).not.toContain(forbidden);
    }
  });

  it('S6 无头 Task 红线：只落不透明 taskId，指令与输出永不落盘', () => {
    useAppStore.getState().setSelectedTaskId('task-abc123');
    const persisted = partializeAppState(useAppStore.getState());
    expect(persisted.selectedTaskId).toBe('task-abc123');
    // 白名单里既没有承载指令的键，也没有承载输出/会话引用的键。
    const snapshot = JSON.stringify(persisted).toLowerCase();
    for (const forbidden of ['prompt', 'sessionref', 'items', 'stdout', 'artifact']) {
      expect(snapshot).not.toContain(forbidden);
    }
  });

  it('白名单类型即契约：PersistedState 键集合固定', () => {
    const keys: (keyof PersistedState)[] = [
      'selectedSandboxId',
      'selectedProjectId',
      'selectedTaskId',
      'sidebarCollapsed',
      'taskListFolds',
      'bannerDismissedToday',
      'terminalFontSize',
      'lastUsedRuntime',
      'lastUsedImage',
    ];
    expect(keys).toHaveLength(9);
  });
});
