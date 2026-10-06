import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './support/server';
import { API, NOW, body, deferred, project, sandbox } from './support/fixtures';
import { mount } from './support/mount';
import { NewProjectContainer } from '@/containers/project/NewProjectContainer';
import { ProjectRecoveryContainer } from '@/containers/project/ProjectRecoveryContainer';
import { ProjectMenuContainer } from '@/containers/project/ProjectMenuContainer';
import { RetainedVolumesContainer } from '@/containers/project/RetainedVolumesContainer';
import { useAppStore } from '@/stores';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const close = () => undefined;
describe('PRJ · create → clone/recovery → governance', () => {
  it('AC-PRJ-005: fast Git completion still waits for Open project', async () => {
    const ready = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, () =>
        HttpResponse.json(project({ cloneStatus: 'ready' }), { status: 202 }),
      ),
    );
    mount(<NewProjectContainer onProjectReady={ready} onCancel={close} />);
    fireEvent.change(await screen.findByLabelText('项目名称'), {
      target: { value: 'infra-scripts' },
    });
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/infra.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(await screen.findByRole('status')).toHaveTextContent('项目可用了');
    expect(ready).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '打开项目' }));
    expect(ready).toHaveBeenCalledWith('project-a');
  });
  it('AC-PRJ-005: failure announces its title, subject and cause before the credential return', async () => {
    const cancel = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, () =>
        HttpResponse.json(project({ cloneStatus: 'cloning' }), { status: 202 }),
      ),
    );
    mount(<NewProjectContainer onProjectReady={vi.fn()} onCancel={cancel} />);
    fireEvent.change(await screen.findByLabelText('项目名称'), {
      target: { value: 'infra-scripts' },
    });
    fireEvent.change(screen.getByLabelText('仓库地址'), {
      target: { value: 'https://github.com/acme/infra.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    await screen.findByText('正在克隆项目…');
    act(() => {
      useAppStore.getState().applyProjectCloneEvent({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'failed',
        errorCode: 'CLONE_FAILED_PERMISSION',
      });
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('克隆失败');
    expect(alert).toHaveTextContent('acme-web');
    expect(alert).toHaveTextContent('远端拒绝了这次访问');
    fireEvent.click(screen.getByRole('button', { name: '配置 Git 凭证' }));
    expect(cancel).toHaveBeenCalledOnce();
    expect(useAppStore.getState().pendingProjectCreate).toMatchObject({
      projectId: 'project-a',
      url: 'https://github.com/acme/infra.git',
    });
  });
  it('AC-PRJ-002/006: empty source omits repository/branch and becomes ready without clone UI', async () => {
    const accepted = vi.fn();
    const ready = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, async ({ request }) => {
        accepted(await body(request));
        return HttpResponse.json(project({ sourceType: 'empty' }), { status: 202 });
      }),
    );
    mount(
      <NewProjectContainer initialSourceType="empty" onProjectReady={ready} onCancel={close} />,
    );
    const input = await screen.findByLabelText('项目名称');
    fireEvent.change(input, { target: { value: '我的空项目' } });
    expect(screen.queryByLabelText('仓库地址')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() => {
      expect(accepted).toHaveBeenCalledWith({ name: '我的空项目', sourceType: 'empty' });
    });
    await waitFor(() => {
      expect(ready).toHaveBeenCalledWith('project-a');
    });
    expect(screen.queryByText('正在克隆项目…')).not.toBeInTheDocument();
  });
  it('AC-PRJ-003: name conflict preserves Git fields and leaves a usable correction path', async () => {
    server.use(
      http.post(`${API}/api/projects`, () =>
        HttpResponse.json(
          { code: 'ALREADY_EXISTS', message: 'private backend detail', retryable: false },
          { status: 409 },
        ),
      ),
    );
    mount(<NewProjectContainer onProjectReady={vi.fn()} onCancel={close} />);
    fireEvent.change(await screen.findByLabelText('项目名称'), { target: { value: 'acme-web' } });
    fireEvent.change(screen.getByLabelText(/仓库地址/), {
      target: { value: 'https://github.com/acme/web.git' },
    });
    fireEvent.change(screen.getByLabelText('分支（可选）'), { target: { value: 'feat/fix' } });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('项目名已存在，请换一个名称。');
    expect(screen.getByLabelText(/仓库地址/)).toHaveValue('https://github.com/acme/web.git');
    expect(screen.getByLabelText('分支（可选）')).toHaveValue('feat/fix');
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled();
  });
  it.each(['retry-clone', 'convert-to-empty'] as const)(
    'AC-PRJ-014/016: real recovery click sends project id to %s, never the React event',
    async (action) => {
      const path = vi.fn();
      const converted = vi.fn();
      server.use(
        http.post(`${API}/api/projects/:id/${action}`, ({ params }) => {
          path(params['id']);
          return HttpResponse.json(
            project({
              sourceType: action === 'convert-to-empty' ? 'empty' : 'git',
              cloneStatus: action === 'convert-to-empty' ? 'ready' : 'cloning',
            }),
          );
        }),
      );
      mount(
        <ProjectRecoveryContainer
          projectId="project-a"
          projectName="acme-web"
          errorCode="CLONE_FAILED_NETWORK"
          onConverted={converted}
        />,
      );
      fireEvent.click(
        screen.getByRole('button', { name: action === 'retry-clone' ? '重试克隆' : '改为空项目' }),
      );
      await waitFor(() => {
        expect(path).toHaveBeenCalledWith('project-a');
      });
      if (action === 'convert-to-empty')
        await waitFor(() => {
          expect(converted).toHaveBeenCalledWith('project-a');
        });
    },
  );
  it('AC-PRJ-005: new-project clone failure recovery uses the accepted object id and never creates twice', async () => {
    const creates = vi.fn();
    const converted = vi.fn();
    const ready = vi.fn();
    server.use(
      http.post(`${API}/api/projects`, () => {
        creates();
        return HttpResponse.json(project({ cloneStatus: 'cloning', cloneErrorCode: null }), {
          status: 202,
        });
      }),
      http.post(`${API}/api/projects/:id/convert-to-empty`, ({ params }) => {
        converted(params['id']);
        return HttpResponse.json(project({ sourceType: 'empty' }));
      }),
    );
    mount(<NewProjectContainer onProjectReady={ready} onCancel={close} />);
    fireEvent.change(await screen.findByLabelText('项目名称'), { target: { value: 'acme-web' } });
    fireEvent.change(screen.getByLabelText(/仓库地址/), {
      target: { value: 'https://github.com/acme/web.git' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));
    await screen.findByText('正在克隆项目…');
    act(() => {
      useAppStore.getState().applyProjectCloneEvent({
        event: 'project.clone_progress',
        projectId: 'project-a',
        phase: 'failed',
        errorCode: 'CLONE_FAILED_PERMISSION',
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: '改为空项目' }));
    await waitFor(() => {
      expect(converted).toHaveBeenCalledWith('project-a');
    });
    expect(creates).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: '重试克隆' })).not.toBeInTheDocument();
  });
  it('AC-PRJ-042: fresh deletion preview blocks active and retained objects; failed reads never pretend zero', async () => {
    const deleted = vi.fn();
    let read = 0;
    server.use(
      http.get(`${API}/api/projects/project-a/deletion-preview`, () =>
        ++read === 1
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'unavailable', retryable: true },
              { status: 500 },
            )
          : HttpResponse.json({
              activeTasks: [{ id: 'task-a', name: '正在修复首页' }],
              retainedVolumeCount: 2,
              automationCount: 1,
              automationRunCount: 4,
              taskCount: 1,
            }),
      ),
      http.get(`${API}/api/sandboxes`, () => HttpResponse.json([sandbox()])),
      http.delete(`${API}/api/projects/project-a`, () => {
        deleted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(
      <ProjectMenuContainer
        ownDialog
        projectId="project-a"
        projectName="acme-web"
        cloneStatus="ready"
        taskCount={1}
        createdAt={NOW}
        initialConfirmingDelete
        onDeleted={vi.fn()}
        onClose={close}
      />,
    );
    await screen.findByRole('button', { name: '重试' });
    expect(screen.getByTestId('delete-confirm')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await screen.findByText(/正在修复首页/);
    expect(screen.getByTestId('delete-running-warning')).toHaveTextContent('2');
    fireEvent.click(screen.getByTestId('delete-confirm'));
    expect(deleted).not.toHaveBeenCalled();
  });
  it('AC-PRJ-051/052/053: retained sources/sizes, same-dialog cancellation and native archive links', async () => {
    const row = {
      id: 'volume-a',
      projectId: 'project-a',
      sandboxId: 'removed-task',
      sandboxName: '真实来源任务',
      source: 'manual-destroy',
      retainedAt: NOW,
      retainUntil: '2026-11-01T00:00:00Z',
      diskBytes: 1024 ** 3,
      downloadBytes: 14 * 1024 ** 2,
    };
    const deleted = vi.fn();
    server.use(
      http.get(`${API}/api/projects`, () => HttpResponse.json([project()])),
      http.get(`${API}/api/retained-volumes`, () => HttpResponse.json([row])),
      http.delete(`${API}/api/retained-volumes/:id`, () => {
        deleted();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mount(
      <RetainedVolumesContainer projectId="project-a" projectName="acme-web" onClose={close} />,
    );
    const dialog = await screen.findByRole('dialog');
    const link = await screen.findByTestId('retained-volume-download');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('download');
    expect(link).toHaveAttribute('href', `${API}/api/retained-volumes/volume-a/archive`);
    expect(screen.getByTestId('retained-volume-sizes')).toHaveTextContent(
      '占用 1.0 GB · 下载 14 MB',
    );
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByTestId('retained-volume-confirm');
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    await screen.findByTestId('retained-volume-row');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '删除' })).toHaveFocus();
    });
    expect(deleted).not.toHaveBeenCalled();
  });
  it('AC-PRJ-053: deleting waits for HTTP success; a stale 404 returns to refreshed list with an explanation', async () => {
    const gate = deferred();
    let deleted = false;
    server.use(
      http.get(`${API}/api/retained-volumes`, () =>
        HttpResponse.json(
          deleted
            ? []
            : [
                {
                  id: 'volume-a',
                  projectId: 'project-a',
                  source: 'manual-destroy',
                  retainedAt: NOW,
                  retainUntil: NOW,
                  diskBytes: 10,
                  downloadBytes: 2,
                },
              ],
        ),
      ),
      http.delete(`${API}/api/retained-volumes/volume-a`, async () => {
        await gate.promise;
        deleted = true;
        return HttpResponse.json(
          { code: 'NOT_FOUND', message: 'gone', retryable: false },
          { status: 404 },
        );
      }),
    );
    mount(
      <RetainedVolumesContainer projectId="project-a" projectName="acme-web" onClose={close} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除成果' }));
    expect(await screen.findByRole('button', { name: '删除中…' })).toBeDisabled();
    gate.release();
    await screen.findByTestId('retained-volumes-empty');
    expect(screen.getByRole('alert')).toHaveTextContent('已经不在了');
  });
  it('AC-PRJ-004.8: elapsed clone time only uses the workflow timestamp, never the first browser frame', () => {
    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'project-a',
      phase: 'cloning',
      stage: 'receiving',
      percent: 42,
    });
    expect(useAppStore.getState().projectClones['project-a']?.startedAt).toBeUndefined();
    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'project-a',
      phase: 'slow',
      startedAt: NOW,
    });
    expect(useAppStore.getState().projectClones['project-a']?.startedAt).toBe(Date.parse(NOW));
    useAppStore.getState().applyProjectCloneEvent({
      event: 'project.clone_progress',
      projectId: 'project-a',
      phase: 'cloning',
    });
    expect(useAppStore.getState().projectClones['project-a']?.phase).toBe('slow');
    expect(useAppStore.getState().projectClones['project-a']?.startedAt).toBe(Date.parse(NOW));
  });
  it('AC-PRJ-040/041/043: deletion starts on cancel, blocks every dismissal while pending and preserves the project after a failed DELETE', async () => {
    const gate = deferred();
    const closed = vi.fn();
    const gone = vi.fn();
    server.use(
      http.get(`${API}/api/projects/project-a/deletion-preview`, () =>
        HttpResponse.json({
          activeTasks: [],
          retainedVolumeCount: 0,
          automationCount: 1,
          automationRunCount: 3,
          taskCount: 0,
        }),
      ),
      http.delete(`${API}/api/projects/project-a`, async () => {
        await gate.promise;
        return HttpResponse.json(
          { code: 'NETWORK_ERROR', message: 'private transport detail', retryable: true },
          { status: 500 },
        );
      }),
    );
    mount(
      <ProjectMenuContainer
        ownDialog
        projectId="project-a"
        projectName="acme-web"
        cloneStatus="ready"
        taskCount={0}
        createdAt={NOW}
        initialConfirmingDelete
        onDeleted={gone}
        onClose={closed}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('delete-cancel')).toHaveFocus();
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-confirm')).toHaveAttribute('aria-disabled', 'false');
    });
    fireEvent.click(screen.getByTestId('delete-confirm'));
    await screen.findByText('正在删除项目「acme-web」…');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(closed).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-cancel')).toBeDisabled();
    act(gate.release);
    await screen.findByTestId('delete-error');
    expect(gone).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-cancel')).toBeEnabled();
    expect(screen.getByText(/项目原样保留/)).toBeInTheDocument();
  });
});
