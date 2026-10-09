import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { API, body, deferred, project, provider, runtime, sandbox } from './support/fixtures';
import { server } from './support/server';
import { mount } from './support/mount';
import { SandboxTerminalContainer } from '@/containers/sandbox/SandboxTerminalContainer';
import { useAppStore, partializeAppState } from '@/stores';
import type { ImageManifestDto } from '@/types/image';
import { imageKeys } from '@/hooks/image/useImages';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
});
function launch(overview = false) {
  useAppStore.setState({ currentModal: 'newTask' });
  return mount(
    <SandboxTerminalContainer
      wsBaseUrl="ws://localhost:3001"
      projectId="project-a"
      projectName="acme-web"
      projectSourceType="git"
      launchProjectId={overview ? null : 'project-a'}
      projects={[
        project(),
        project({ id: 'project-b', name: 'Acme-API' }),
        project({ id: 'project-empty', name: '空项目', sourceType: 'empty' }),
        project({ id: 'project-cloning', name: '正在克隆', cloneStatus: 'cloning' }),
        project({ id: 'project-failed', name: '失败项目', cloneStatus: 'failed' }),
      ]}
    />,
  );
}
async function pick() {
  fireEvent.click(await screen.findByRole('radio', { name: /Codex/ }));
}
async function choose(field: string, name: string | RegExp) {
  const trigger = await screen.findByLabelText(field);
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('option', { name }));
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
}

function image(overrides: Partial<ImageManifestDto> = {}): ImageManifestDto {
  return {
    id: 'manifest-custom',
    imageId: 'image-custom',
    imageName: 'docker.io/acme/ml-agent',
    imageAlias: '研发环境',
    version: 'v1',
    ref: 'docker.io/acme/ml-agent:v1',
    digest: `sha256:${'a'.repeat(64)}`,
    isBuiltin: false,
    isActive: true,
    baseImage: 'ghcr.io/agent-infra/sandbox',
    derivedFromDigest: `sha256:${'b'.repeat(64)}`,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: ['codex'],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 20480 },
    labelsRequired: [],
    validationStatus: 'valid',
    validationErrors: null,
    imageConfig: null,
    registeredAt: '2026-10-09T00:00:00Z',
    resolvedAt: '2026-10-09T00:00:00Z',
    ...overrides,
  };
}
describe('LCH · explicit project/Agent selection through admission', () => {
  it('AC-LCH-001/002: overview preselects the first ready project but requires an Agent; blocked primary remains focusable and sends no POST', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, () => {
        sent();
        return HttpResponse.json(sandbox({ status: 'pending' }));
      }),
    );
    launch(true);
    await screen.findByRole('radio', { name: /Codex/ });
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    expect(screen.getByLabelText('项目')).toHaveTextContent('acme-web');
    fireEvent.click(screen.getByLabelText('项目'));
    expect(await screen.findByRole('option', { name: '正在克隆（克隆中）' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索项目' }), { key: 'Escape' });
    primary.focus();
    expect(primary).toHaveFocus();
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(primary);
    expect(sent).not.toHaveBeenCalled();
  });
  it('AC-LCH-003/004: changing project preserves Agent/prompt, resets branch and omits it for empty projects', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        sent(await body(request));
        return HttpResponse.json(
          sandbox({ status: 'pending', hasRun: false, projectId: 'project-empty' }),
          { status: 201 },
        );
      }),
    );
    launch();
    await pick();
    await choose('分支（可选）', 'feat/login-refresh');
    fireEvent.change(screen.getByLabelText('任务指令（可选）'), {
      target: { value: '修复登录状态' },
    });
    await choose('项目', '空项目');
    expect(screen.queryByLabelText('分支（可选）')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('修复登录状态');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        projectId: 'project-empty',
        runtime: 'codex',
        initialPrompt: '修复登录状态',
      });
    });
    await screen.findByTestId('sandbox-startup-progress');
    expect(useAppStore.getState().selectedProjectId).toBe('project-empty');
  });
  it('AC-LCH-005/006: pending clears local instruction, locks dismissal, then branch rejection restores it without creating an object', async () => {
    const gate = deferred();
    server.use(
      http.post(`${API}/api/sandboxes`, async () => {
        await gate.promise;
        return HttpResponse.json(
          {
            code: 'BRANCH_NOT_FOUND',
            message: 'remote disappeared',
            retryable: false,
            sideEffectFree: true,
          },
          { status: 400 },
        );
      }),
    );
    launch();
    await pick();
    fireEvent.change(screen.getByLabelText('任务指令（可选）'), {
      target: { value: '保留这段本地指令' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await screen.findByRole('button', { name: '创建中…' });
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    act(gate.release);
    expect(await screen.findByRole('alert')).toHaveTextContent('本次请求未创建任何任务');
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('保留这段本地指令');
    expect(useAppStore.getState().selectedSandboxId).toBeNull();
    expect(JSON.stringify(partializeAppState(useAppStore.getState()))).not.toContain(
      '保留这段本地指令',
    );
  });
  it('AC-LCH-007: RESOURCE_EXHAUSTED uses real registered/max capacity, including stopped tasks', async () => {
    server.use(
      http.post(`${API}/api/sandboxes`, () =>
        HttpResponse.json(
          { code: 'RESOURCE_EXHAUSTED', message: 'full', retryable: true },
          { status: 429 },
        ),
      ),
    );
    launch();
    await pick();
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('8 / 8');
    });
    expect(screen.getByRole('alert')).toHaveTextContent('停止任务不会腾出名额');
    expect(screen.getByRole('button', { name: '发起任务并打开终端' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });
  it('AC-LCH-008: a host without TTY blocks before POST and gives a factual destination', async () => {
    const sent = vi.fn();
    server.use(
      http.get(`${API}/api/providers`, () =>
        HttpResponse.json([
          { ...provider, capabilities: { ...provider.capabilities, spawnTty: false } },
        ]),
      ),
      http.post(`${API}/api/sandboxes`, () => {
        sent();
        return HttpResponse.json(sandbox());
      }),
    );
    launch();
    await pick();
    const primary = screen.getByRole('button', { name: '发起任务并打开终端' });
    expect(primary).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(primary);
    expect(sent).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).not.toHaveTextContent('改发无头任务');
  });
  it('AC-LCH-003/AC-AUTH-001.4: credential expansion alone starts no helper and scrolls the actual panel into the form body', async () => {
    const begin = vi.fn();
    const scroll = vi.fn();
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    try {
      server.use(
        http.get(`${API}/api/runtimes`, () =>
          HttpResponse.json([runtime({ credentialStatus: 'none' })]),
        ),
        http.post(`${API}/api/runtimes/codex/auth/begin`, () => {
          begin();
          return HttpResponse.json({});
        }),
      );
      launch();
      await pick();
      expect(begin).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId('auth-gate-start'));
      const panel = document.getElementById('launch-auth-panel');
      expect(panel).not.toBeNull();
      await waitFor(() => {
        expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
      });
      expect(scroll.mock.contexts).toContain(panel);
      expect(within(panel!).getByRole('button', { name: '开始帐号登录' })).toBeInTheDocument();
      expect(begin).not.toHaveBeenCalled();
    } finally {
      if (originalScroll !== undefined)
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });
});

describe('REQ-LCH-018 · local searchable task choices', () => {
  it.each(['平台基础环境', null])(
    'AC-LCH-018.4/5: fixed default shows its alias/ref (%s), stays visible while searching and still omits image on creation',
    async (alias) => {
      const sent = vi.fn();
      const builtinRef = 'ghcr.io/agent-infra/sandbox:latest';
      server.use(
        http.get(`${API}/api/images`, () =>
          HttpResponse.json([
            image(),
            image({
              id: 'manifest-builtin',
              imageId: 'image-builtin',
              imageName: 'ghcr.io/agent-infra/sandbox',
              imageAlias: alias,
              ref: builtinRef,
              version: 'latest',
              isBuiltin: true,
              isProviderDefault: true,
              derivedFromDigest: null,
            }),
          ]),
        ),
        http.post(`${API}/api/sandboxes`, async ({ request }) => {
          sent(await body(request));
          return HttpResponse.json(sandbox({ status: 'pending' }), { status: 201 });
        }),
      );
      launch();
      await pick();
      await choose('镜像（可选）', /研发环境/);
      fireEvent.click(screen.getByLabelText('镜像（可选）'));
      fireEvent.change(await screen.findByRole('combobox', { name: '搜索镜像' }), {
        target: { value: 'no-image-match' },
      });
      const defaultOption = screen.getByRole('option', { name: /平台预制镜像（默认）/ });
      expect(defaultOption).toHaveTextContent(
        alias === null ? builtinRef : `${alias} · ${builtinRef}`,
      );
      expect(screen.getAllByRole('option')).toHaveLength(1);
      fireEvent.click(defaultOption);
      await waitFor(() => {
        expect(screen.getByLabelText('镜像（可选）')).toHaveFocus();
      });
      expect(screen.getByLabelText('镜像（可选）')).toHaveTextContent('平台预制镜像（默认）');
      fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
      await waitFor(() => {
        expect(sent).toHaveBeenCalledWith({ projectId: 'project-a', runtime: 'codex' });
      });
    },
  );
  it('AC-LCH-018.1/5: trimmed case-insensitive project filtering preserves choice/order and makes no request', async () => {
    const reads = vi.fn();
    server.use(
      http.get(`${API}/api/projects/:id/branches`, () => {
        reads('branches');
        return HttpResponse.json(['main']);
      }),
      http.get(`${API}/api/images`, () => {
        reads('images');
        return HttpResponse.json([]);
      }),
    );
    launch();
    await pick();
    await waitFor(() => {
      expect(reads).toHaveBeenCalledTimes(3);
    });
    fireEvent.click(screen.getByLabelText('项目'));
    const search = await screen.findByRole('combobox', { name: '搜索项目' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: '  ACME  ' } });
    expect(screen.getAllByRole('option').map((item) => item.textContent)).toEqual([
      'acme-web（已选）',
      'Acme-API',
    ]);
    expect(screen.getByLabelText('项目')).toHaveTextContent('acme-web');
    expect(reads).toHaveBeenCalledTimes(3);
    fireEvent.change(search, { target: { value: '没有这个项目' } });
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的项目');
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    expect(screen.getAllByRole('option')).toHaveLength(5);
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByLabelText('项目')).toHaveFocus();
    });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('项目'));
    expect(await screen.findByRole('combobox', { name: '搜索项目' })).toHaveValue('');
    expect(window.location.href).not.toContain('没有这个项目');
    expect(localStorage.getItem('agent-platform-ui') ?? '').not.toContain('没有这个项目');
  });

  it('AC-LCH-018.2/5: full unicode branch search keeps the fixed default and sends only the committed branch', async () => {
    const sent = vi.fn();
    server.use(
      http.get(`${API}/api/projects/:id/branches`, () =>
        HttpResponse.json(['main', 'feature/中文搜索', 'release/2026']),
      ),
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        sent(await body(request));
        return HttpResponse.json(sandbox({ status: 'pending' }), { status: 201 });
      }),
    );
    launch();
    await pick();
    await choose('分支（可选）', 'main');
    await choose('项目', /acme-web/);
    expect(screen.getByLabelText('分支（可选）')).toHaveTextContent('main');
    fireEvent.click(screen.getByLabelText('分支（可选）'));
    const search = await screen.findByRole('combobox', { name: '搜索分支' });
    fireEvent.change(search, { target: { value: '  FEATURE/中文  ' } });
    expect(screen.getByRole('option', { name: 'feature/中文搜索' })).toBeInTheDocument();
    expect(screen.getByLabelText('分支（可选）')).toHaveTextContent('main');
    fireEvent.change(search, { target: { value: 'branch-search-secret' } });
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的分支');
    expect(screen.getByRole('option', { name: '跟随项目当前的分支（默认）' })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        projectId: 'project-a',
        runtime: 'codex',
        branch: 'main',
      });
    });
  });

  it('AC-LCH-018.3/4/5: alias/ref selection keeps the image ID, provider restrictions and CLI warnings; project changes preserve task input', async () => {
    const sent = vi.fn();
    server.use(
      http.get(`${API}/api/images`, () =>
        HttpResponse.json([
          image(),
          image({
            id: 'manifest-warning',
            imageId: 'image-warning',
            imageAlias: '启动较慢',
            imageName: 'docker.io/acme/slow',
            ref: 'docker.io/acme/slow:v1',
            validationStatus: 'warning',
            supportedRuntimes: [],
          }),
          image({
            id: 'manifest-disabled',
            imageId: 'image-disabled',
            imageAlias: '禁用环境',
            isActive: false,
          }),
          image({
            id: 'manifest-invalid',
            imageId: 'image-invalid',
            imageAlias: '无效环境',
            validationStatus: 'invalid',
          }),
          image({
            id: 'manifest-mismatch',
            imageId: 'image-mismatch',
            imageAlias: '其他宿主',
            providerCompatibility: { aio: false },
          }),
        ]),
      ),
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        sent(await body(request));
        return HttpResponse.json(sandbox({ status: 'pending', projectId: 'project-b' }), {
          status: 201,
        });
      }),
    );
    launch();
    await pick();
    await choose('分支（可选）', 'feat/login-refresh');
    await choose('镜像（可选）', /研发环境/);
    fireEvent.change(screen.getByLabelText('任务指令（可选）'), {
      target: { value: '保留任务指令' },
    });
    fireEvent.click(screen.getByLabelText('镜像（可选）'));
    expect(screen.queryByRole('option', { name: /其他宿主/ })).not.toBeInTheDocument();
    const invalid = screen.getByRole('option', { name: /无效环境/ });
    expect(invalid).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(invalid);
    expect(screen.getByLabelText('镜像（可选）')).toHaveTextContent('研发环境');
    expect(screen.getByRole('option', { name: /启动较慢/ })).toHaveTextContent('没有预装 codex');
    expect(screen.getByRole('option', { name: /启动较慢/ })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
    const search = screen.getByRole('combobox', { name: '搜索镜像' });
    fireEvent.change(search, { target: { value: '  DOCKER.IO/ACME/ML-AGENT  ' } });
    expect(screen.getByRole('option', { name: /研发环境/ })).toHaveTextContent(
      'docker.io/acme/ml-agent:v1',
    );
    expect(screen.getByRole('option', { name: /平台预制镜像/ })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    await choose('项目', 'Acme-API');
    expect(screen.getByLabelText('分支（可选）')).toHaveTextContent('跟随项目当前的分支（默认）');
    expect(screen.getByRole('radio', { name: /Codex/ })).toBeChecked();
    expect(screen.getByLabelText('镜像（可选）')).toHaveTextContent('研发环境');
    expect(screen.getByLabelText('任务指令（可选）')).toHaveValue('保留任务指令');
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        projectId: 'project-b',
        runtime: 'codex',
        image: 'docker.io/acme/ml-agent:v1',
        initialPrompt: '保留任务指令',
      });
    });
  });

  it('AC-LCH-018.5/REQ-IMG-060: requerying a renamed image updates its caption while an unmatched old alias cannot change its selected ID or submitted ref', async () => {
    let currentAlias = '研发环境';
    const reads = vi.fn();
    const sent = vi.fn();
    server.use(
      http.get(`${API}/api/images`, () => {
        reads(currentAlias);
        return HttpResponse.json([image({ imageAlias: currentAlias })]);
      }),
      http.post(`${API}/api/sandboxes`, async ({ request }) => {
        sent(await body(request));
        return HttpResponse.json(sandbox({ status: 'pending' }), { status: 201 });
      }),
    );
    const { client } = launch();
    await pick();
    await choose('镜像（可选）', /研发环境/);
    fireEvent.click(screen.getByLabelText('镜像（可选）'));
    const search = await screen.findByRole('combobox', { name: '搜索镜像' });
    fireEvent.change(search, { target: { value: '研发' } });
    const original = screen.getByRole('option', { name: /研发环境/ });
    expect(original).toHaveAttribute('data-value', 'option:image-custom');
    expect(original).toHaveAttribute('aria-current', 'true');
    const beforeRefresh = reads.mock.calls.length;
    await act(async () => {
      currentAlias = '生产构建';
      await client.invalidateQueries({ queryKey: imageKeys.all() });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('镜像（可选）')).toHaveTextContent('生产构建');
    });
    expect(reads.mock.calls.length).toBeGreaterThan(beforeRefresh);
    expect(reads).toHaveBeenLastCalledWith('生产构建');
    expect(search).toHaveValue('研发');
    expect(screen.getByRole('status')).toHaveTextContent('没有匹配的镜像');
    expect(screen.queryByRole('option', { name: /研发环境|生产构建/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /平台预制镜像/ })).not.toHaveAttribute(
      'aria-current',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }));
    const renamed = screen.getByRole('option', { name: /生产构建/ });
    expect(renamed).toHaveAttribute('data-value', 'option:image-custom');
    expect(renamed).toHaveAttribute('aria-current', 'true');
    expect(renamed).toHaveTextContent('docker.io/acme/ml-agent:v1');
    fireEvent.keyDown(search, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByLabelText('镜像（可选）')).toHaveFocus();
    });
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await waitFor(() => {
      expect(sent).toHaveBeenCalledWith({
        projectId: 'project-a',
        runtime: 'codex',
        image: 'docker.io/acme/ml-agent:v1',
      });
    });
  });

  it('AC-LCH-018.3: a delayed previous-project branch response cannot replace current choices and empty projects make no branch request', async () => {
    const old = deferred();
    const branches = vi.fn();
    server.use(
      http.get(`${API}/api/projects/:id/branches`, async ({ params }) => {
        branches(params['id']);
        if (params['id'] === 'project-a') {
          await old.promise;
          return HttpResponse.json(['old-project-only']);
        }
        return HttpResponse.json(['new-project-only']);
      }),
    );
    launch();
    await pick();
    await choose('项目', 'Acme-API');
    await choose('分支（可选）', 'new-project-only');
    await act(async () => {
      old.release();
      await old.promise;
    });
    fireEvent.click(screen.getByLabelText('分支（可选）'));
    expect(await screen.findByRole('option', { name: /new-project-only/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'old-project-only' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索分支' }), { key: 'Escape' });
    await choose('项目', '空项目');
    expect(screen.queryByLabelText('分支（可选）')).not.toBeInTheDocument();
    expect(branches).not.toHaveBeenCalledWith('project-empty');
  });

  it('AC-LCH-018.6/7: IME Enter/229 never selects or creates; Escape and Tab preserve the outer dialog', async () => {
    const sent = vi.fn();
    server.use(
      http.post(`${API}/api/sandboxes`, () => {
        sent();
        return HttpResponse.json(sandbox());
      }),
    );
    launch();
    await pick();
    fireEvent.click(screen.getByLabelText('项目'));
    const input = await screen.findByRole('combobox', { name: '搜索项目' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'Acme-API' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(screen.getByLabelText('项目')).toHaveTextContent('acme-web');
    expect(input).toBeInTheDocument();
    expect(sent).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByLabelText('项目')).toHaveTextContent('Acme-API');
    });
    fireEvent.click(screen.getByLabelText('项目'));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索项目' }), { key: 'Escape' });
    await waitFor(() => {
      expect(screen.getByLabelText('项目')).toHaveFocus();
    });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('项目'));
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索项目' }), { key: 'Tab' });
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /Codex/ })).toHaveFocus();
    });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
  });

  it('AC-LCH-018.8: creating closes an open list, locks the three fields and leaves no input in persistence', async () => {
    const pending = deferred();
    server.use(
      http.post(`${API}/api/sandboxes`, async () => {
        await pending.promise;
        return HttpResponse.json(
          { code: 'BRANCH_NOT_FOUND', message: 'missing', sideEffectFree: true, retryable: false },
          { status: 400 },
        );
      }),
    );
    launch();
    await pick();
    fireEvent.click(screen.getByLabelText('项目'));
    fireEvent.change(await screen.findByRole('combobox', { name: '搜索项目' }), {
      target: { value: 'private-search-draft' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发起任务并打开终端' }));
    await screen.findByRole('button', { name: '创建中…' });
    expect(screen.queryByRole('combobox', { name: '搜索项目' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('项目')).toBeDisabled();
    expect(screen.getByLabelText('分支（可选）')).toBeDisabled();
    expect(screen.getByLabelText('镜像（可选）')).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByTestId('modal-new-task')).toBeInTheDocument();
    expect(JSON.stringify(partializeAppState(useAppStore.getState()))).not.toContain(
      'private-search-draft',
    );
    await act(async () => {
      pending.release();
      await pending.promise;
    });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByLabelText('项目'));
    expect(await screen.findByRole('combobox', { name: '搜索项目' })).toHaveValue('');
  });
});
