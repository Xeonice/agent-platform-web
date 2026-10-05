import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundRecoveryContainer } from '@/containers/workbench/NotFoundRecoveryContainer';
import { useAppStore } from '@/stores';

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

describe('WB · unknown route recovery', () => {
  it('AC-WB-040.6 clears interactive and headless selections, replaces the bad path and leaves the overview notice', () => {
    window.history.replaceState({}, '', '/missing-page');
    useAppStore.setState({
      selectedProjectId: 'project-before',
      selectedSandboxId: 'interactive-before',
      selectedTaskId: 'headless-before',
    });
    render(
      <StrictMode>
        <NotFoundRecoveryContainer />
      </StrictMode>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('这个地址没有对应的页面');
    expect(navigation.replace).toHaveBeenCalledWith('/');
    expect(useAppStore.getState()).toMatchObject({
      selectedProjectId: null,
      selectedSandboxId: null,
      selectedTaskId: null,
      workbenchNotice: { message: '这个地址没有对应的页面，已打开项目总览。' },
    });
  });
});
