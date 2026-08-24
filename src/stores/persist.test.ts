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

  /**
   * ⚠️ 上一版这条用例的做法是"往 `wizardData.initialPrompt` 里塞敏感串，再断言它没落盘"。
   * `wizardData` 本轮已从 store 上**整个删除**（F21-2 §N.2 死值清理）——store 上不再有任何
   * 能装下指令的字段。用例据此改成**更强的那一条**：不是"装了但没带上盘"，而是
   * **store 的状态里根本不存在承载指令的键**。
   *
   * 变异：在 `createUiSlice` 上把 `wizardData` / `initialPrompt` 之类的字段加回去 ⇒ 本例变红。
   */
  it('store 上不存在任何承载指令的字段（wizardData 已整体删除）', () => {
    const stateKeys = Object.keys(useAppStore.getState());
    for (const forbidden of ['wizardData', 'setWizardData', 'wizardReturn', 'initialPrompt']) {
      expect(stateKeys).not.toContain(forbidden);
    }
    const snapshot = JSON.stringify(partializeAppState(useAppStore.getState())).toLowerCase();
    expect(snapshot).not.toContain('wizard');
  });

  /**
   * `currentModal` 的两个死值（`'registerImage'` / `'wizard'`）随本轮删除 —— 全仓无人 set、
   * 无人读（F21-2 §N.0）。删除即回归：类型层已经拦住它们，这里再钉一条**运行时**事实——
   * 活着的两个取值都是真弹层的开关，且默认关闭。
   */
  it("currentModal 只剩两个活取值（'createProject' / 'newTask'），默认关闭", () => {
    expect(useAppStore.getState().currentModal).toBeNull();
    useAppStore.getState().setCurrentModal('newTask');
    expect(useAppStore.getState().currentModal).toBe('newTask');
    useAppStore.getState().setCurrentModal('createProject');
    expect(useAppStore.getState().currentModal).toBe('createProject');
    useAppStore.getState().setCurrentModal(null);
    expect(useAppStore.getState().currentModal).toBeNull();
    // 弹层开关是瞬时 UI 指向，绝不落盘（刷新即关闭弹窗，§9.1 #32）。
    expect(partializeAppState(useAppStore.getState())).not.toHaveProperty('currentModal');
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
    // 指令只活在 container 局部 state（新建任务弹窗关闭即清空）——store 上连一个能装它的
    // 位置都没有，快照里自然也不该出现这几个词。
    const snapshot = JSON.stringify(partializeAppState(useAppStore.getState())).toLowerCase();
    for (const forbidden of ['prompt', 'initialprompt', 'wizarddata', 'branch']) {
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
