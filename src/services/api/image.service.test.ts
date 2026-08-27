// @vitest-environment node
// 镜像 REST 协议编解码（F21-4 §7.1，node 环境 + MSW/undici 拦截，对齐 runtime.service.test）。
//
// 这里断言的**不是"能拿到数据"**，而是本页最容易在重构里被合并掉的那几条区分：
// 两个 validate 端点各拼各的路径、PATCH 的两半各自只发自己那一份、`isActive:true` 根本没有入口。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import * as imageService from '@/services/api/image.service';
import { ApiErrorException } from '@/services/api/apiError';
import type { ImageManifestDto, ValidationOutcomeDto } from '@/types/image';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

const DIGEST = 'sha256:4b17e0c1f2a34b5c6d7e8f90112233445566778899aabbccddeeff0011223344';
const DIGEST_BASE = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function manifest(overrides: Partial<ImageManifestDto> = {}): ImageManifestDto {
  return {
    id: 'm-1',
    imageId: 'img-1',
    imageName: 'docker.io/myrepo/ml-agent',
    isBuiltin: false,
    ref: 'docker.io/myrepo/ml-agent:v1.0',
    version: 'v1.0',
    baseImage: 'docker.io/myrepo/ml-agent',
    digest: DIGEST,
    entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
    supportedRuntimes: ['codex'],
    resourceDefaults: { cores: 2, ramMb: 4096, diskMb: 20480 },
    labelsRequired: [],
    // 04 §7 ★血统：这几个夹具都是**第三方镜像**且注册于切片之后，按准入规则它们
    // 必须能证明派生自某张内置锚点，所以这里是 digest 而不是 `null`。
    // `null` 的两种语义（① 内置根镜像 ② 切片前存量行）见 `drizzle/0012`——
    // 想测那两种，用 override 显式写 `derivedFromDigest: null`。
    derivedFromDigest: DIGEST_BASE,
    validationStatus: 'valid',
    validationErrors: null,
    isActive: true,
    imageConfig: null,
    registeredAt: '2026-08-01T00:00:00.000Z',
    resolvedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const OUTCOME: ValidationOutcomeDto = { status: 'valid', errors: [], warnings: [] };

describe('image.service · 端点表（10 §6.4 / 27 §6）', () => {
  it('listImages 不带 runtimeId 时**不发这个查询参数**（带上就看不见历史版本了）', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${API_BASE}/api/images`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await imageService.listImages();
    const url = new URL(seenUrl);
    expect(url.pathname).toBe('/api/images');
    expect(url.searchParams.has('runtimeId')).toBe(false);
  });

  it('listImages(runtimeId) 把它拼进 query（向导可选集那条路）', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${API_BASE}/api/images`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await imageService.listImages('codex');
    expect(new URL(seenUrl).searchParams.get('runtimeId')).toBe('codex');
  });

  /**
   * ★ 审计 P1-3 的那条区分。两个方法拼的是两条路径，**不可互换**：
   * 前者不落库（注册前预检）、后者写回结论（已注册镜像重验）。
   *
   * MUTATION：把 `validateImageRef` 改成打 `/api/images/{id}/validate`
   * ⇒ 第一条断言红（路径变成 `/api/images/undefined/validate` 或直接类型错）。
   */
  it('validatePreflight 与 revalidate 拼的是两条不同的路径（两个方法不可互换）', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API_BASE}/api/images/validate`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(OUTCOME);
      }),
      http.post(`${API_BASE}/api/images/:id/validate`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({
          ...OUTCOME,
          currentDigest: DIGEST,
          upstreamDigest: DIGEST,
          digestChanged: false,
        });
      }),
    );
    await imageService.validateImageRef('docker.io/myrepo/ml-agent:v1.0');
    await imageService.revalidateImage('m-1');
    expect(seen).toEqual(['/api/images/validate', '/api/images/m-1/validate']);
  });

  it('validatePreflight 的 body 只有 ref（无 id）', async () => {
    let seenBody: unknown;
    server.use(
      http.post(`${API_BASE}/api/images/validate`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(OUTCOME);
      }),
    );
    await imageService.validateImageRef('docker.io/myrepo/ml-agent:v1.0');
    expect(seenBody).toEqual({ ref: 'docker.io/myrepo/ml-agent:v1.0' });
  });

  /**
   * ★ 201 vs 200 = 「新插了一行」vs「这个 digest 早就有了」。后端刻意不把它放进 body
   *（同一个事实两个来源），所以只能从状态码提。前端两条路完全不同：201 是"注册成功"，
   * 200 是"就地提示 + [定位到该镜像]"。
   *
   * MUTATION：把 `created` 写死成 `true` ⇒ 第二条断言红（重复注册被当成一次成功注册，
   * 用户会以为又建了一张）。
   */
  it('registerImage：201 ⇒ created:true；200 ⇒ created:false（重复粘贴同一个 URI）', async () => {
    server.use(
      http.post(`${API_BASE}/api/images`, () =>
        HttpResponse.json({ manifest: manifest(), validation: OUTCOME }, { status: 201 }),
      ),
    );
    expect((await imageService.registerImage('x:1')).created).toBe(true);

    server.use(
      http.post(`${API_BASE}/api/images`, () =>
        HttpResponse.json({ manifest: manifest(), validation: OUTCOME }, { status: 200 }),
      ),
    );
    expect((await imageService.registerImage('x:1')).created).toBe(false);
  });

  it('checkImageUpdate 拼 POST /api/images/:id/check-update（与 revalidate 是两条路）', async () => {
    let seenPath = '';
    server.use(
      http.post(`${API_BASE}/api/images/:id/check-update`, ({ request }) => {
        seenPath = new URL(request.url).pathname;
        return HttpResponse.json({
          current: { digest: DIGEST, resolvedAt: '2026-08-01T00:00:00.000Z' },
          upstream: null,
          changed: false,
        });
      }),
    );
    const result = await imageService.checkImageUpdate('m-1');
    expect(seenPath).toBe('/api/images/m-1/check-update');
    // `upstream: null` 是契约里真实存在的一档（上游连 tag 都没了），不能当成失败。
    expect(result.upstream).toBeNull();
  });

  it('activateImage 拼 POST /api/images/:id/activate，且**不带 body**', async () => {
    let seenPath = '';
    let seenBody = '';
    server.use(
      http.post(`${API_BASE}/api/images/:id/activate`, async ({ request }) => {
        seenPath = new URL(request.url).pathname;
        seenBody = await request.text();
        return HttpResponse.json(manifest());
      }),
    );
    await imageService.activateImage('m-9');
    expect(seenPath).toBe('/api/images/m-9/activate');
    expect(seenBody).toBe('');
  });

  /**
   * ★ 本文件最要紧的一条。`disableImage` 的 body **只有** `isActive:false`：
   * 带上 `imageConfig` 会把用户的环境变量冲掉，而界面上看不出任何异常。
   *
   * MUTATION：给 body 加一个 `imageConfig: undefined` 之外的字段（比如把整行 manifest 发上去）
   * ⇒ 第二条断言红。
   */
  it('disableImage 的 body **只有** { isActive:false }', async () => {
    let seenBody: unknown;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(manifest({ isActive: false }));
      }),
    );
    await imageService.disableImage('m-1');
    expect(seenBody).toEqual({ isActive: false });
  });

  it('saveImageConfig 的 body **只有** { imageConfig }（不顺手改启停状态）', async () => {
    let seenBody: unknown;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async ({ request }) => {
        seenBody = await request.json();
        return HttpResponse.json(manifest());
      }),
    );
    await imageService.saveImageConfig('m-1', { env: [{ key: 'A', value: 'b', secret: false }] });
    expect(seenBody).toEqual({ imageConfig: { env: [{ key: 'A', value: 'b', secret: false }] } });
  });

  /**
   * ★ **否定断言：service 上没有任何方法能发出 `isActive: true`。**
   *
   * 后端对 `PATCH { isActive:true }` 明确回 400 并指向 `/activate`。一个
   * `setActive(id, next: boolean)` 式的签名等于把那个 400 留在类型系统里当成合法调用——
   * 类型检查全绿、跑起来必 400。所以启用的入口只有 `activateImage`。
   *
   * ⚠️ 这条**只能**写成结构断言（导出面 + 源码文本），因为"没有这个能力"不是一次调用能证明的。
   * MUTATION：在 service 里加一个 `export async function enableImage(id) { PATCH {isActive:true} }`
   * ⇒ 本条红。
   */
  it('service 上不存在"发 isActive:true"的入口（启用只能走 activate）', () => {
    const exported = Object.keys(imageService).sort();
    expect(exported).toEqual([
      'activateImage',
      'checkImageUpdate',
      'deleteImage',
      'disableImage',
      'listImages',
      'registerImage',
      'revalidateImage',
      'saveImageConfig',
      'validateImageRef',
    ]);
    // `disableImage` 不收布尔参数——不是"传 false"，是根本没有那个入口。
    expect(imageService.disableImage.length).toBe(1);
  });

  it('deleteImage 拼 DELETE /api/images/:id；409（被引用）原样抛成 ApiErrorException', async () => {
    server.use(
      http.delete(`${API_BASE}/api/images/:id`, () =>
        HttpResponse.json(
          {
            code: 'INVALID_STATE',
            message: '还有 2 个 Task 在使用这个版本…请改为禁用',
            retryable: false,
            sideEffectFree: true,
          },
          { status: 409 },
        ),
      ),
    );
    await expect(imageService.deleteImage('m-1')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('非 2xx 一律抛 ApiErrorException，并带上后端信封里那句具体的话', async () => {
    server.use(
      http.post(`${API_BASE}/api/images`, () =>
        HttpResponse.json(
          {
            code: 'MANIFEST_INVALID',
            message: '镜像没有声明 platform.tmux',
            retryable: false,
            sideEffectFree: true,
            details: [
              { path: 'labels', code: 'IMAGE_TMUX_MISSING', message: '缺少 platform.tmux' },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    await expect(imageService.registerImage('x:1')).rejects.toMatchObject({
      httpStatus: 422,
      envelope: { code: 'MANIFEST_INVALID' },
    });
  });

  it('全部请求都带 cookie（口令门 11 §3.1：跨源须显式带凭据）', async () => {
    let seenCreds: RequestCredentials | undefined;
    server.use(
      http.get(`${API_BASE}/api/images`, ({ request }) => {
        seenCreds = request.credentials;
        return HttpResponse.json([]);
      }),
    );
    await imageService.listImages();
    expect(seenCreds).toBe('include');
  });
});
