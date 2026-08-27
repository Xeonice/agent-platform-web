// 镜像管理页集成测试（F21-4 §7.3）：vitest + jsdom + MSW node server
//（`onUnhandledRequest: 'error'` ⇒ 路径拼错会当场红，不会静默通过）。
//
// ⚠️ **本页三条结构/安全红线一律落在这条真跑的路上，而不是只放进 story**
//（F21-4 §7.2：仓内 story 里 `play` 的覆盖是给"看得见"用的，绿灯要出现在真跑的那条路上）：
//   ① secret 原值不进 DOM；② ❌ 态没有 [保存]；③ 预置镜像没有 [删除]。
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { ImagesContainer } from '@/containers/image/ImagesContainer';
import { useAppStore } from '@/stores';
import type { ImageManifestDto } from '@/types/image';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const DIGEST_A = 'sha256:4b17e0c1f2a34b5c6d7e8f90112233445566778899aabbccddeeff0011223344';
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
    digest: DIGEST_A,
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

function seedList(rows: ImageManifestDto[]): void {
  server.use(http.get(`${API_BASE}/api/images`, () => HttpResponse.json(rows)));
}

function renderPage(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<ImagesContainer />, { wrapper: Wrapper });
}

beforeEach(() => {
  cleanup();
  useAppStore.getState().setCurrentModal(null);
});

describe('ImagesContainer · 列表与卡片', () => {
  it('空列表 ⇒ 空态 + CTA（而不是一片空白）', async () => {
    seedList([]);
    renderPage();
    expect(await screen.findByTestId('images-empty')).toBeInTheDocument();
  });

  /**
   * ★ 红线③：**预置镜像（AIO）不渲染 [删除]**，仅可禁用（P21-4 §9）。
   * MUTATION：把 `canDelete: !input.isBuiltin` 改成 `true` ⇒ 本条红。
   */
  it('预置镜像没有 [删除]，自定义镜像有', async () => {
    seedList([
      manifest({ id: 'm-builtin', imageId: 'img-b', isBuiltin: true, imageName: 'aio' }),
      manifest({ id: 'm-custom', imageId: 'img-c', isBuiltin: false }),
    ]);
    renderPage();
    const cards = await screen.findAllByTestId('image-card');
    expect(within(cards[0]!).queryByRole('button', { name: '删除' })).toBeNull();
    expect(within(cards[1]!).getByRole('button', { name: '删除' })).toBeInTheDocument();
  });

  /**
   * ★ digest 是哨兵值 ⇒ 显示「⚠️ 未解析」，且 **DOM 全文不含 `sha256:unresolved`**，
   * [检查更新] 同时置灰。哨兵串长得像哈希，漏出去比留白更误导。
   *
   * MUTATION：把 `digestStateOf` 里那句 `digest === UNRESOLVED_DIGEST_SENTINEL` 删掉 ⇒ 本条红。
   */
  it('digest 未解析：显示「未解析」、不漏哨兵串、[检查更新] 置灰', async () => {
    seedList([manifest({ digest: 'sha256:unresolved' })]);
    const { container } = renderPage();
    expect(await screen.findByTestId('digest-unresolved')).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('sha256:unresolved');
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled();
  });

  /** 同一个 imageId 的多行聚成一张卡；旧行在历史里，且给 [切换到此版本]（回滚入口）。 */
  it('历史版本收在卡片背后，且可以切回去（走 activate）', async () => {
    seedList([
      manifest({ id: 'm-new', registeredAt: '2026-08-20T00:00:00.000Z' }),
      manifest({ id: 'm-old', isActive: false, registeredAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    let activated = '';
    server.use(
      http.post(`${API_BASE}/api/images/:id/activate`, ({ params }) => {
        activated = String(params['id']);
        return HttpResponse.json(manifest());
      }),
    );
    renderPage();
    expect(await screen.findAllByTestId('image-card')).toHaveLength(1);
    fireEvent.click(await screen.findByRole('button', { name: '切换到此版本' }));
    await waitFor(() => {
      expect(activated).toBe('m-old');
    });
  });
});

describe('ImagesContainer · 两颗按钮不互相顶替（P21-4 §3）', () => {
  /**
   * ★ [重新验证] **不换镜像**：后端返回新的 `validationStatus` 而 digest 不变，
   * 卡片上的 digest 文本必须**逐字不变**。
   *
   * 这条守的是「别做成一个按钮」：一旦有人图省事把 [检查更新] 接到 revalidate 上，
   * digest 就会跟着变，本条当场红。
   */
  it('[重新验证] 只改三级结论，digest 文本逐字不变', async () => {
    seedList([manifest({ validationStatus: 'valid' })]);
    server.use(
      http.post(`${API_BASE}/api/images/:id/validate`, () =>
        HttpResponse.json({
          status: 'invalid',
          errors: [{ code: 'IMAGE_TMUX_MISSING', message: '缺少 tmux' }],
          warnings: [],
          currentDigest: DIGEST_A,
          upstreamDigest: DIGEST_A,
          digestChanged: false,
        }),
      ),
    );
    renderPage();
    const digestBefore = (await screen.findByTestId('pinned-digest')).textContent;
    fireEvent.click(screen.getByRole('button', { name: '重新验证' }));
    await waitFor(() => {
      expect(screen.getByTestId('pinned-digest').textContent).toBe(digestBefore);
    });
  });

  /**
   * ★ [启用] 走 `POST /:id/activate`，**绝不发 `PATCH { isActive:true }`**。
   * 替身对后者会回 400（与真后端一致）——如果谁把它写成 PATCH，
   * 这里不但断言红，`onUnhandledRequest` 之外还会有一个真实的 400。
   */
  it('[禁用] 发的是 PATCH { isActive:false }，body 里**只有**这一个字段', async () => {
    seedList([manifest({ isActive: true })]);
    const patchBodies: unknown[] = [];
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async ({ request }) => {
        patchBodies.push(await request.json());
        return HttpResponse.json(manifest({ isActive: false }));
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '禁用' }));
    await waitFor(() => {
      expect(patchBodies).toEqual([{ isActive: false }]);
    });
  });

  /**
   * ★ [启用] 走 `POST /:id/activate`，**一个 PATCH 都不发**。
   * 替身对 `PATCH { isActive:true }` 会回 400（与真后端一致），所以写成 PATCH 的人
   * 不但这条红，还会看到一个真实的 400——这正是要的：不要写出一个必然 400 的调用。
   *
   * MUTATION：把 `toggle` 的 `next===true` 分支改成走 `disableMutation` ⇒ 本条红。
   */
  it('[启用] 发 activate，而**没有任何** PATCH（PATCH{isActive:true} 后端会 400）', async () => {
    seedList([manifest({ isActive: false })]);
    let activateHit = '';
    let patched = false;
    server.use(
      http.post(`${API_BASE}/api/images/:id/activate`, ({ params }) => {
        activateHit = String(params['id']);
        return HttpResponse.json(manifest());
      }),
      http.patch(`${API_BASE}/api/images/:id`, () => {
        patched = true;
        return HttpResponse.json(manifest());
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '启用' }));
    await waitFor(() => {
      expect(activateHit).toBe('m-1');
    });
    expect(patched).toBe(false);
  });
});

describe('ImagesContainer · 注册弹窗', () => {
  /**
   * ★ 红线②：❌ 态**不渲染** [保存]（不是渲染出来再置灰）。
   * MUTATION：把 `canSave` 改成 `result !== undefined` ⇒ 本条红。
   */
  it('验证 ❌ ⇒ 没有 [保存]；改 URI 重验 ✅ ⇒ [保存] 出现', async () => {
    seedList([]);
    let call = 0;
    server.use(
      http.post(`${API_BASE}/api/images/validate`, () => {
        call += 1;
        return HttpResponse.json(
          call === 1
            ? {
                status: 'invalid',
                errors: [{ code: 'IMAGE_TMUX_MISSING', message: '缺少 tmux' }],
                warnings: [],
              }
            : { status: 'valid', errors: [], warnings: [] },
        );
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ 注册新镜像' }));
    const input = screen.getByLabelText('镜像 URI');
    fireEvent.change(input, { target: { value: 'docker.io/a/b:v1' } });
    fireEvent.click(screen.getByRole('button', { name: '验证' }));

    await waitFor(() => {
      expect(screen.getByTestId('validation-result')).toHaveAttribute('data-status', 'invalid');
    });
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByRole('button', { name: '查看镜像要求' })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'docker.io/a/b:v1x' } });
    fireEvent.click(screen.getByRole('button', { name: '验证' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    });
  });

  /**
   * ★ 改动 URI ⇒ 结论区**整块消失**（不是 hidden），灰字提示出现；**改回原值也不复活**。
   * MUTATION：删掉 hook 里 `onUriChange` 的 `setValidationResult(undefined)`
   *（＝把结论从"清掉"退化成"留着"）⇒ 本条红。
   */
  it('验证通过后改动 URI ⇒ 绿勾与 [保存] 都从 DOM 消失；改回原值仍是作废态', async () => {
    seedList([]);
    server.use(
      http.post(`${API_BASE}/api/images/validate`, () =>
        HttpResponse.json({ status: 'valid', errors: [], warnings: [] }),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ 注册新镜像' }));
    const input = screen.getByLabelText('镜像 URI');
    fireEvent.change(input, { target: { value: 'docker.io/a/b:v1' } });
    fireEvent.click(screen.getByRole('button', { name: '验证' }));
    await waitFor(() => {
      expect(screen.getByTestId('validation-result')).toBeInTheDocument();
    });

    fireEvent.change(input, { target: { value: 'docker.io/a/b:v1x' } });
    expect(screen.queryByTestId('validation-result')).toBeNull();
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.getByTestId('conclusion-invalidated')).toBeInTheDocument();

    // 改回原值——**仍然是作废态**（结论是被清掉的，不是被条件隐藏）。
    fireEvent.change(input, { target: { value: 'docker.io/a/b:v1' } });
    expect(screen.queryByTestId('validation-result')).toBeNull();
    expect(screen.getByTestId('conclusion-invalidated')).toBeInTheDocument();
  });

  it("[+ 注册新镜像] 是真 overlay，且把 currentModal 设成 'registerImage'", async () => {
    seedList([]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '+ 注册新镜像' }));
    const dialog = screen.getByRole('dialog', { name: '注册新镜像' });
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('inset-0');
    expect(useAppStore.getState().currentModal).toBe('registerImage');
  });
});

describe('ImagesContainer · 运行参数（env）', () => {
  const withSecret = manifest({
    imageConfig: {
      env: [
        { key: 'LOG_LEVEL', value: 'info', secret: false },
        { key: 'MY_SECRET', value: '', secret: true },
      ],
    },
  });

  /**
   * ★ 红线①：**已存 secret 的值永远不进 DOM**。后端把它掩码成 `''`，
   * 前端也绝不去别处捞一个值填进去。
   */
  it('展开已存 secret 的变量：输入框为空 + placeholder 正确，DOM 里没有任何密文', async () => {
    seedList([withSecret]);
    const { container } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '编辑环境变量' }));
    const secretInput = screen.getByLabelText('变量值 2');
    expect(secretInput).toHaveValue('');
    expect(secretInput).toHaveAttribute('placeholder', '（保持不变，输入即覆盖）');
    expect(container.innerHTML).not.toContain('super-secret');
  });

  it('直接保存 ⇒ 请求体里 secret 行传空 value（= 保持不变，不是清空）', async () => {
    seedList([withSecret]);
    let body: unknown;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(withSecret);
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '编辑环境变量' }));
    fireEvent.click(screen.getByRole('button', { name: '保存运行参数' }));
    await waitFor(() => {
      expect(body).toEqual({
        imageConfig: {
          env: [
            { key: 'LOG_LEVEL', value: 'info', secret: false },
            { key: 'MY_SECRET', value: '', secret: true },
          ],
        },
      });
    });
  });

  it('输入保留变量名 ⇒ 就地红字「系统保留」，且不发请求', async () => {
    seedList([withSecret]);
    let posted = false;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, () => {
        posted = true;
        return HttpResponse.json(withSecret);
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '编辑环境变量' }));
    fireEvent.change(screen.getByLabelText('变量名 1'), {
      target: { value: 'OPENAI_API_KEY' },
    });
    const rowError = await screen.findByTestId('env-var-row-error');
    expect(rowError).toHaveAttribute('data-code', 'ENV_NAME_RESERVED');
    fireEvent.click(screen.getByRole('button', { name: '保存运行参数' }));
    expect(posted).toBe(false);
  });

  /**
   * ★ 后端 400 按 `details[].path` **逐行归位**：只有那一行红，别的行不红。
   * MUTATION：把 `mapEnvErrorResponse` 的结果丢掉、改成整表 toast ⇒ 本条红。
   */
  it('后端 400 的 details[] 只标红对应的那一行', async () => {
    seedList([withSecret]);
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, () =>
        HttpResponse.json(
          {
            code: 'VALIDATION_FAILED',
            message: '运行参数不合法，请按提示逐项修正',
            retryable: false,
            sideEffectFree: true,
            details: [{ path: 'env[1].key', code: 'ENV_DUPLICATE_KEY', message: '变量名重复' }],
          },
          { status: 400 },
        ),
      ),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '编辑环境变量' }));
    fireEvent.click(screen.getByRole('button', { name: '保存运行参数' }));

    const errors = await screen.findAllByTestId('env-var-row-error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toHaveAttribute('data-code', 'ENV_DUPLICATE_KEY');
    // 归位到第 2 行（下标 1），不是整表报错。
    const rows = screen.getAllByTestId('env-var-row');
    expect(within(rows[1]!).getByTestId('env-var-row-error')).toBeInTheDocument();
    expect(within(rows[0]!).queryByTestId('env-var-row-error')).toBeNull();
  });
});

describe('ImagesContainer · 删除', () => {
  it('删除走二次确认；后端 409（被引用）时弹层留在原地', async () => {
    seedList([manifest()]);
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
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));
    const dialog = await screen.findByRole('dialog', { name: '删除镜像版本' });
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: '删除镜像版本' })).toBeInTheDocument();
    });
  });
});

describe('ImagesContainer · 深链', () => {
  /** `?filter=warning` 进入即应用状态过滤（F21-4 §2）。 */
  it('?filter=warning ⇒ 只列出 ⚠️ 镜像', async () => {
    // 深链初值读的是 `window.location.search`（刻意不用 `useSearchParams`，见 hook 注释），
    // 所以这里改真实 URL 而不是给 location 打桩——打桩要一次 `as unknown as Location`，
    // 而那正是本仓禁掉的双重断言。
    window.history.replaceState({}, '', '/settings/images?filter=warning');
    seedList([
      manifest({ id: 'm-ok', imageId: 'i-ok', validationStatus: 'valid' }),
      manifest({
        id: 'm-warn',
        imageId: 'i-warn',
        validationStatus: 'warning',
        validationErrors: [{ code: 'RUNTIME_NOT_PREINSTALLED', message: '未预装 claude-code' }],
      }),
    ]);
    renderPage();
    const cards = await screen.findAllByTestId('image-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAttribute('data-status', 'warning');
    window.history.replaceState({}, '', '/');
  });
});
