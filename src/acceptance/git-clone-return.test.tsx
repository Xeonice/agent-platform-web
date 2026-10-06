import { StrictMode } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { GitCredentialsContainer } from '@/containers/credential/GitCredentialsContainer';
import { useAppStore } from '@/stores';
import { server } from './support/server';
import { API, deferred, project } from './support/fixtures';
import { mount } from './support/mount';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => navigation }));

function openReturn() {
  navigation.push.mockClear();
  window.history.replaceState({}, '', '/settings/credentials?section=git');
  useAppStore.setState({
    selectedProjectId: 'other-project',
    selectedSandboxId: 'other-task',
    currentModal: 'createProject',
    projectCreateSource: 'git',
    pendingProjectCreate: { projectId: 'return-project', name: '回程项目', source: 'git' },
  });
  return mount(
    <StrictMode>
      <GitCredentialsContainer />
    </StrictMode>,
  );
}

describe('PRJ-005 / CRD-034 · Git 凭证回程使用原项目', () => {
  it('等待原项目重试受理后，清掉旧任务和弹层并选中原项目，再回工作台；不再次创建', async () => {
    const answer = deferred();
    const retries: string[] = [];
    const creates = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, () => {
        creates();
        return HttpResponse.json(project(), { status: 202 });
      }),
      http.post(`${API}/api/projects/:id/retry-clone`, async ({ params }) => {
        retries.push(String(params['id']));
        await answer.promise;
        return HttpResponse.json(
          project({ id: 'return-project', name: '回程项目', cloneStatus: 'cloning' }),
          { status: 202 },
        );
      }),
    );
    openReturn();
    fireEvent.click(await screen.findByRole('button', { name: '重试克隆' }));
    expect(await screen.findByRole('button', { name: '重试中…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '放弃' })).toBeDisabled();
    await waitFor(() => {
      expect(retries).toEqual(['return-project']);
    });
    expect(useAppStore.getState().selectedSandboxId).toBe('other-task');
    expect(navigation.push).not.toHaveBeenCalled();
    answer.release();
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith('/');
    });
    expect(useAppStore.getState()).toMatchObject({
      selectedProjectId: 'return-project',
      selectedSandboxId: null,
      currentModal: null,
      projectCreateSource: null,
      pendingProjectCreate: null,
    });
    expect(screen.queryByRole('button', { name: '重试克隆' })).not.toBeInTheDocument();
    expect(creates).not.toHaveBeenCalled();
  });

  it('重试被拒保留回程和当前现场，允许同一项目再次重试', async () => {
    const retries: string[] = [];
    server.use(
      http.post(`${API}/api/projects/:id/retry-clone`, ({ params }) => {
        retries.push(String(params['id']));
        return retries.length === 1
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'private backend detail', retryable: true },
              { status: 500 },
            )
          : HttpResponse.json(project({ id: 'return-project', cloneStatus: 'cloning' }));
      }),
    );
    openReturn();
    fireEvent.click(await screen.findByRole('button', { name: '重试克隆' }));
    await waitFor(() => {
      expect(retries).toHaveLength(1);
      expect(screen.getByRole('button', { name: '重试克隆' })).toBeEnabled();
    });
    expect(useAppStore.getState()).toMatchObject({
      selectedProjectId: 'other-project',
      selectedSandboxId: 'other-task',
      pendingProjectCreate: { projectId: 'return-project' },
    });
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试克隆' }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith('/');
    });
    expect(retries).toEqual(['return-project', 'return-project']);
    expect(useAppStore.getState().selectedProjectId).toBe('return-project');
  });

  it('刷新丢失内存回程后仍可配置凭证，不显示幽灵重试入口或自动发送克隆请求', async () => {
    const retries = vi.fn();
    navigation.push.mockClear();
    window.history.replaceState({}, '', '/settings/credentials?section=git');
    server.use(
      http.post(`${API}/api/projects/:id/retry-clone`, () => {
        retries();
        return HttpResponse.json(project({ cloneStatus: 'cloning' }));
      }),
    );
    mount(<GitCredentialsContainer />);
    await screen.findByRole('button', { name: '配置 HTTPS Token' });
    expect(screen.queryByRole('button', { name: '重试克隆' })).not.toBeInTheDocument();
    expect(retries).not.toHaveBeenCalled();
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
