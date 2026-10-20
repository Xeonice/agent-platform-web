import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { ImagesContainer } from '@/containers/image/ImagesContainer';
import { imageRuntimeVersionsLabel } from '@/lib/image/imageRuntimeVersions';
import { groupManifestsByImage, manifestToCardInput } from '@/lib/image/imageManifestCards';
import { imageCardModel } from '@/lib/image/imageCardModel';
import { launchImageOptions } from '@/lib/image/launchImageOptions';
import { mount } from '@/acceptance/support/mount';
import { server } from '@/acceptance/support/server';
import { API, NOW } from '@/acceptance/support/fixtures';
import type { ImageManifestDto } from '@/types/image';

const image = (extra: Partial<ImageManifestDto> = {}): ImageManifestDto => ({
  id: 'manifest-current',
  imageId: 'image-agent',
  imageName: 'registry.test/agent',
  imageAlias: '开发镜像',
  version: 'latest',
  ref: 'registry.test/agent:latest',
  digest: `sha256:${'a'.repeat(64)}`,
  isBuiltin: false,
  isActive: true,
  derivedFromDigest: `sha256:${'b'.repeat(64)}`,
  baseImage: 'registry.test/base',
  entrypointContract: { workdir: '/', entrypoint: ['/bin/sh'] },
  resourceDefaults: { cores: 1, ramMb: 512, diskMb: 1024 },
  labelsRequired: [],
  supportedRuntimes: ['codex', 'claude-code'],
  validationStatus: 'valid',
  validationErrors: [],
  registeredAt: NOW,
  resolvedAt: NOW,
  imageConfig: null,
  ...extra,
});

describe('镜像各 digest 的 CLI 构建声明', () => {
  it('只读受支持 key 的精确版本，缺值和部分声明逐项未报告', () => {
    expect(imageRuntimeVersionsLabel(undefined)).toBe('Codex 未报告 · Claude Code 未报告');
    expect(imageRuntimeVersionsLabel({ codex: '0.150.1' })).toBe(
      'Codex 0.150.1 · Claude Code 未报告',
    );
    expect(
      imageRuntimeVersionsLabel({
        codex: '0.150.1-rc.1+build.12',
        'claude-code': '2.1.251',
        other: '9.9.9',
      }),
    ).toBe('Codex 0.150.1-rc.1+build.12 · Claude Code 2.1.251');
    expect(imageRuntimeVersionsLabel(Object.create({ codex: '0.150.1' }))).toBe(
      'Codex 未报告 · Claude Code 未报告',
    );
  });

  it.each([
    'latest',
    'v1.2.3',
    '1.2',
    '01.2.3',
    '1.2.3-01',
    '1.2.3\n',
    '1.2.3\u0000',
    '<img src=x onerror=alert(1)>',
    `1.2.3+${'x'.repeat(128)}`,
    123,
    null,
  ])('不把无效或危险声明 %j 当作版本或 HTML', (bad) => {
    expect(imageRuntimeVersionsLabel({ codex: bad, 'claude-code': '2.1.251' })).toBe(
      'Codex 未报告 · Claude Code 2.1.251',
    );
  });

  it('同 tag 不同 digest 的卡面、历史和任务选项分别读取各自版本，缺声明不从适用运行时猜', () => {
    const current = image({ runtimeVersions: { codex: '0.150.1', 'claude-code': '2.1.251' } });
    const old = image({
      id: 'old',
      digest: `sha256:${'c'.repeat(64)}`,
      isActive: false,
      registeredAt: '2026-10-01T00:00:00Z',
      runtimeVersions: { codex: '0.140.0' },
    });
    const group = groupManifestsByImage([old, current])[0];
    expect(group?.history[0]?.runtimeVersionsLabel).toBe('Codex 0.140.0 · Claude Code 未报告');
    expect(imageCardModel(manifestToCardInput(current)).runtimeVersionsLabel).toBe(
      'Codex 0.150.1 · Claude Code 2.1.251',
    );
    expect(imageCardModel(manifestToCardInput(image())).runtimeVersionsLabel).toBe(
      'Codex 未报告 · Claude Code 未报告',
    );
    const option = launchImageOptions([old, current], 'boxlite', 'codex', 'Codex').options[0];
    expect(option).toMatchObject({
      value: 'image-agent',
      reference: current.ref,
      secondary: current.ref,
      detail: '镜像声明：Codex 0.150.1 · Claude Code 2.1.251',
    });
    expect(option?.searchText).toContain('0.150.1');
    expect(option?.searchText).not.toContain('0.140.0');
  });

  it('管理卡片、历史和检查更新分别显示当前/旧版/上游 digest 的声明，搜索不改变身份', async () => {
    const current = image({ runtimeVersions: { codex: '0.150.1', 'claude-code': '2.1.251' } });
    server.use(
      http.get(`${API}/api/images`, () =>
        HttpResponse.json([
          current,
          image({
            id: 'old',
            digest: `sha256:${'c'.repeat(64)}`,
            isActive: false,
            registeredAt: '2026-10-01T00:00:00Z',
            runtimeVersions: { codex: '0.140.0' },
          }),
        ]),
      ),
      http.post(`${API}/api/images/:id/check-update`, () =>
        HttpResponse.json({
          current: { digest: current.digest, resolvedAt: NOW },
          upstream: {
            digest: `sha256:${'d'.repeat(64)}`,
            validation: {
              status: 'valid',
              errors: [],
              warnings: [],
              runtimeVersions: { codex: '0.160.0' },
            },
          },
          changed: true,
        }),
      ),
    );
    mount(<ImagesContainer />);
    const card = await screen.findByTestId('image-card');
    expect(within(card).getByTestId('image-runtime-versions')).toHaveTextContent(
      'Codex 0.150.1 · Claude Code 2.1.251',
    );
    expect(screen.getByTestId('image-version-runtime-versions')).toHaveTextContent(
      'Codex 0.140.0 · Claude Code 未报告',
    );
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索镜像' }), {
      target: { value: '0.150.1' },
    });
    expect(screen.getByTestId('image-card')).toHaveAttribute('data-image-id', current.id);
    fireEvent.click(within(card).getByRole('button', { name: '检查更新' }));
    const dialog = await screen.findByRole('dialog', { name: /的上游更新/ });
    expect(within(dialog).getByTestId('current-runtime-versions')).toHaveTextContent(
      'Codex 0.150.1',
    );
    expect(within(dialog).getByTestId('upstream-runtime-versions')).toHaveTextContent(
      'Codex 0.160.0 · Claude Code 未报告',
    );
    expect(within(card).getByTestId('image-runtime-versions')).toHaveTextContent('Codex 0.150.1');
  });

  it('自定义镜像恶意版本不进入 DOM，未知不改变验证结论', async () => {
    server.use(
      http.get(`${API}/api/images`, () =>
        HttpResponse.json([
          image({
            runtimeVersions: { codex: '<img src=x onerror=alert(1)>', 'claude-code': 'latest' },
          }),
        ]),
      ),
    );
    mount(<ImagesContainer />);
    const card = await screen.findByTestId('image-card');
    expect(card).toHaveAttribute('data-status', 'valid');
    expect(within(card).getByTestId('image-runtime-versions')).toHaveTextContent(
      'Codex 未报告 · Claude Code 未报告',
    );
    expect(card.innerHTML).not.toContain('onerror');
    expect(card.querySelector('img')).toBeNull();
  });

  it('注册前验证展示本次解析声明，不用镜像名/tag推测缺失版本', async () => {
    server.use(
      http.get(`${API}/api/images`, () => HttpResponse.json([])),
      http.post(`${API}/api/images/validate`, () =>
        HttpResponse.json({
          status: 'valid',
          digest: `sha256:${'a'.repeat(64)}`,
          errors: [],
          warnings: [],
          runtimeVersions: { codex: '0.150.1' },
        }),
      ),
    );
    mount(<ImagesContainer />);
    await screen.findByTestId('images-empty');
    const register = screen.getAllByRole('button', { name: '+ 注册新镜像' })[0];
    if (register === undefined) throw new Error('Missing registration button');
    fireEvent.click(register);
    const dialog = screen.getByRole('dialog', { name: '注册新镜像' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: '镜像 URI' }), {
      target: { value: 'registry.test/claude-2.1.251:latest' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证' }));
    expect(await within(dialog).findByTestId('validation-runtime-versions')).toHaveTextContent(
      'Codex 0.150.1 · Claude Code 未报告',
    );
  });
});
