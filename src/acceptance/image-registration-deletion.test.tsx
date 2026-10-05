import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { ImagesContainer } from '@/containers/image/ImagesContainer';
import { useAppStore } from '@/stores';
import { server } from '@/acceptance/support/server';
import type { ImageDeletionPreviewDto, ImageManifestDto } from '@/types/image';

const base = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const digest = `sha256:${'d'.repeat(64)}`;
const image: ImageManifestDto = {
  id: 'image-actual',
  imageId: 'image',
  imageName: 'registry.test/actual',
  version: 'v2',
  ref: 'registry.test/actual:v2',
  digest,
  isBuiltin: false,
  isActive: true,
  derivedFromDigest: `sha256:${'a'.repeat(64)}`,
  baseImage: 'registry.test/platform-base',
  entrypointContract: { workdir: '/', entrypoint: ['/bin/sh'] },
  resourceDefaults: { cores: 1, ramMb: 512, diskMb: 1024 },
  labelsRequired: [],
  supportedRuntimes: ['codex'],
  validationStatus: 'valid',
  validationErrors: [],
  registeredAt: '2026-10-05T00:00:00Z',
  resolvedAt: '2026-10-05T00:00:00Z',
  imageConfig: { env: [] },
};
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ImagesContainer />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  cleanup();
  useAppStore.getState().setCurrentModal(null);
  server.use(http.get(`${base}/api/images`, () => HttpResponse.json([image])));
});

describe('IMG 注册失败与删除清单闭环', () => {
  it('验证连不上下载源在原位可重试，地址保留，真digest来自下一次接口', async () => {
    let calls = 0;
    server.use(
      http.post(`${base}/api/images/validate`, () =>
        ++calls === 1
          ? HttpResponse.json(
              { code: 'REGISTRY_UNREACHABLE', message: '未经审阅的内部原句', retryable: true },
              { status: 502 },
            )
          : HttpResponse.json({
              status: 'warning',
              digest,
              errors: [],
              warnings: [{ code: 'RUNTIME_NOT_PREINSTALLED', message: "未声明 'claude-code'" }],
            }),
      ),
    );
    mount();
    fireEvent.click(screen.getByRole('button', { name: '+ 注册新镜像' }));
    const dialog = screen.getByRole('dialog', { name: '注册新镜像' });
    const uri = within(dialog).getByRole('textbox', { name: '镜像 URI' });
    fireEvent.change(uri, { target: { value: 'docker.io/acme/agent:v2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证' }));
    await within(dialog).findByText(/连不上镜像下载源/);
    expect(uri).toHaveValue('docker.io/acme/agent:v2');
    expect(within(dialog).queryByTestId('validation-result')).not.toBeInTheDocument();
    expect(dialog.textContent).not.toContain('未经审阅');
    fireEvent.click(within(dialog).getByRole('button', { name: '重试' }));
    await within(dialog).findByText('未预装 claude-code，创建时需现装，启动会明显变慢');
    expect(within(dialog).getByTestId('pinned-digest')).toHaveTextContent('钉定 sha256:ddddd…ddd');
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeEnabled();
    fireEvent.change(uri, { target: { value: 'docker.io/acme/agent: v3' } });
    expect(uri).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(uri.getAttribute('aria-describedby') ?? '')).toHaveTextContent(
      '不能包含空格',
    );
    expect(within(dialog).queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('删除预检失败不能当零引用；重试读到停止任务后可同弹层改为禁用', async () => {
    let readable = false;
    let deletes = 0;
    let disables = 0;
    server.use(
      http.get(`${base}/api/images/:id/deletion-preview`, () =>
        readable
          ? HttpResponse.json({
              canDelete: false,
              tasks: [
                {
                  id: 'stopped-task',
                  name: '整理接口',
                  status: 'stopped',
                  projectId: 'api',
                  projectName: '示例 API 项目',
                },
              ],
              versions: [],
            } satisfies ImageDeletionPreviewDto)
          : HttpResponse.json(
              { code: 'NETWORK_ERROR', message: '读取失败', retryable: true },
              { status: 503 },
            ),
      ),
      http.delete(`${base}/api/images/:id`, () => {
        deletes++;
        return new HttpResponse(null, { status: 204 });
      }),
      http.patch(`${base}/api/images/:id`, () => {
        disables++;
        return HttpResponse.json({});
      }),
    );
    mount();
    await screen.findAllByTestId('image-card');
    const custom = screen
      .getAllByTestId('image-card')
      .find((card) => card.getAttribute('data-image-id') === 'image-actual');
    if (custom === undefined) throw new Error('夹具缺少 ml-agent');
    fireEvent.click(within(custom).getByRole('button', { name: '删除' }));
    const dialog = await screen.findByTestId('image-delete-confirm');
    await within(dialog).findByText('清单读不到，请重试。');
    expect(within(dialog).getByRole('button', { name: '删除镜像' })).toBeDisabled();
    readable = true;
    fireEvent.click(within(dialog).getByRole('button', { name: '重试清单' }));
    await within(dialog).findByText('整理接口 · 示例 API 项目 · 已停止');
    expect(within(dialog).getByRole('button', { name: '删除镜像' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '删除镜像' })).toHaveAttribute(
      'aria-describedby',
      'image-delete-blocked-reason',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '改为禁用' }));
    await waitFor(() => {
      expect(screen.queryByTestId('image-delete-confirm')).not.toBeInTheDocument();
    });
    expect(deletes).toBe(0);
    expect(disables).toBe(1);
  });
});
