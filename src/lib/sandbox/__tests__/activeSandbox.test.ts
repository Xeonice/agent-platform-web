import { describe, it, expect } from 'vitest';
import { activeSandbox } from '@/lib/sandbox/activeSandbox';

/**
 * ── 同时开两个任务，切换时右侧完全不变（2026-09-09 真机）─────────────────────
 *
 * 此前的形状是「本会话创建的 task 压过选中态」：一旦创建过任务，`sandboxId` 就永远等于
 * **最后创建的那一个**；而左侧列表的 `onSelectTask` 只写 store 里的 `selectedSandboxId`，
 * 压根到不了这里 ⇒ `sessionId` 不变 ⇒ WS 不重连、xterm 实例不换 ⇒ 右侧一个字都不变。
 *
 * ⚠️ 界面上**没有任何报错** —— 它看起来只是「没反应」，最难联想到「选中态被本地状态盖住」。
 */
const created = { id: 'sbx-codex', name: 'codex 那个', runtime: 'codex' };

describe('activeSandbox：选中态是唯一真相源', () => {
  it('⭐ 切到另一个任务 ⇒ 不再用本会话创建的那份，去 restore 新选中的那个', () => {
    // MUTATION: 去掉 `createdTask.id === selectedId` 那个条件 ⇒ 本条红。
    const d = activeSandbox({ selectedId: 'sbx-claude', createdTask: created });
    expect(d.localTask, '选中的不是它了,就不许再用它的附加信息').toBeNull();
    expect(d.restoreId, '要去把新选中那个拉回来').toBe('sbx-claude');
  });

  it('⭐ 选中的就是刚创建那个 ⇒ 用本地那份，免掉一次 DTO 往返', () => {
    // ⚠️ 反面同样要钉：一个「永远返回 null」的实现会让刚创建的任务多打一次请求,
    //    而且在 DTO 回来之前任务名/runtime 都是空的（创建响应里本来就有）。
    const d = activeSandbox({ selectedId: 'sbx-codex', createdTask: created });
    expect(d.localTask).toBe(created);
    expect(d.restoreId, '本地已有,不必再请求').toBeNull();
  });

  it('本会话没建过任何任务（刷新后）⇒ 一律 restore 选中的那个', () => {
    const d = activeSandbox({ selectedId: 'sbx-claude', createdTask: null });
    expect(d.localTask).toBeNull();
    expect(d.restoreId).toBe('sbx-claude');
  });

  it('什么都没选（回到新建入口）⇒ 既不用本地那份,也不发请求', () => {
    // ⛔ 创建过任务之后点「回新建入口」会把选中位清成 null;此时若仍返回 localTask,
    //    界面会停在上一个任务的终端上,而用户以为自己已经离开了它。
    const d = activeSandbox({ selectedId: null, createdTask: created });
    expect(d.localTask).toBeNull();
    expect(d.restoreId).toBeNull();
  });
});
