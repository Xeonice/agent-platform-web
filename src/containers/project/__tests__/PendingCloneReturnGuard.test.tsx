// 回程态守卫测试（F21-3 §10.2 修）：离开凭证页即清 pendingProjectCreate，
// 避免下次进入陈旧横幅复现、对已处理/已删项目误发 retry-clone。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PendingCloneReturnGuard } from '@/containers/project/PendingCloneReturnGuard';
import { useAppStore } from '@/stores';

// next/navigation：用 vi.hoisted 持有可变 pathname，逐用例切换。
const nav = vi.hoisted(() => ({ pathname: '/settings/credentials' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

function seedPending(): void {
  useAppStore.getState().setPendingProjectCreate({
    projectId: 'proj-A',
    name: '项目 A',
    source: 'git',
    url: 'git@git.internal.example.com:team/a.git',
  });
}

beforeEach(() => {
  cleanup();
  nav.pathname = '/settings/credentials';
  useAppStore.getState().setPendingProjectCreate(null);
});

describe('PendingCloneReturnGuard · pendingProjectCreate 生命周期', () => {
  it('停留在凭证页：保留回程态（横幅仍可用）', () => {
    seedPending();
    render(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).not.toBeNull();
  });

  it('切到非凭证页（镜像/系统等设置子页）：清除回程态', () => {
    seedPending();
    nav.pathname = '/settings/images';
    render(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).toBeNull();
  });

  it('离开设置区回到工作台（Esc/返回工作台后的 /）：清除回程态', () => {
    seedPending();
    nav.pathname = '/';
    render(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).toBeNull();
  });

  it('创建流时序：在非凭证页写入回程态、再导航到凭证页 → 回程态存活（不被误清）', () => {
    // 守卫先在工作台挂载（此时无回程态）。
    nav.pathname = '/';
    const { rerender } = render(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).toBeNull();

    // 创建流权限失败：写入回程态（pathname 未变）→ 守卫按 pathname 触发，不应清。
    seedPending();
    rerender(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).not.toBeNull();

    // 跳到凭证页：命中凭证 pathname，仍不清 → 横幅可用。
    nav.pathname = '/settings/credentials';
    rerender(<PendingCloneReturnGuard />);
    expect(useAppStore.getState().pendingProjectCreate).not.toBeNull();
  });
});
