// useImageManager（F21-4 §7.1 的 ①—⑥）。默认 handlers 给三行：
// 预置 ✅ · ml-agent ⚠️（当前活行）· ml-agent 旧版本（已下线 ⇒ 历史里可回滚）。
//
// ★ 本文件真正要守的那条线：**乐观更新只有 `disableImage` 一条边**。
// 断言的形态是「`setQueryData` 在服务端返回前**一次都没被调用**」，
// 而不是「最终值对」——后者在有乐观更新时同样会绿。
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { useImageManager, imageKeys } from '@/hooks/image/useImages';
import { useAppStore } from '@/stores';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
const DIGEST_NEW = 'sha256:aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

function makeWrapper(): {
  client: QueryClient;
  wrapper: ({ children }: { children: ReactNode }) => React.JSX.Element;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, wrapper: Wrapper };
}

/** 渲染并等第一份列表落地。 */
async function mountManager() {
  const { client, wrapper } = makeWrapper();
  const { result } = renderHook(() => useImageManager(), { wrapper });
  await waitFor(() => {
    expect(result.current.cards.length).toBeGreaterThan(0);
  });
  return { client, result };
}

/** 一个可以卡住的 handler：调用方决定什么时候放行。 */
function gate(): { hold: Promise<void>; release: () => void } {
  let release = (): void => undefined;
  const hold = new Promise<void>((resolve) => {
    release = () => {
      resolve();
    };
  });
  return { hold, release };
}

describe('useImageManager · 列表与聚合', () => {
  /**
   * 夹具里出现过的 imageId（`src/mocks/handlers.ts` 的 `IMAGE_MANIFESTS`）。
   * 显式列出来而不是 `new Set(cards.map(...))` —— 后者会用被测对象自己的输出当期望，
   * 那样无论聚合逻辑怎么错都恒绿。
   */
  const IMAGE_MANIFESTS_FIXTURE_IMAGE_IDS = ['img-1', 'img-2', 'img-2', 'img-3'];

  it('按 imageId 聚成卡片，ml-agent 的旧版本收进历史（不是多出一张卡）', async () => {
    const { result } = await mountManager();
    // ⚠️ 断言的是**卡数 = 不同 imageId 的个数**，不是一个写死的数字。
    // 原文写死 `2`，2026-08 夹具加了一条 `pending` 的第三个 image 之后当场红 ——
    // 而这条用例真正要钉的性质（同一 imageId 的多个版本只出一张卡）与总数无关。
    // 写死数字会让「加一条无关夹具」看起来像功能坏了。
    const distinctImageIds = new Set(IMAGE_MANIFESTS_FIXTURE_IMAGE_IDS);
    expect(result.current.cards).toHaveLength(distinctImageIds.size);
    const mlAgent = result.current.cards.find((c) => c.imageId === 'img-2');
    expect(mlAgent?.manifestId).toBe('img-manifest-2');
    expect(mlAgent?.history.map((h) => h.id)).toEqual(['img-manifest-3']);
    // ⚠️ 档的后果说明来自 warning 档的 findings（后端把它放在 `validationErrors` 里）。
    expect(mlAgent?.model.warnings[0]).toContain('未预装 claude-code');
    expect(mlAgent?.model.errors).toEqual([]);
  });

  it('搜索按名称/坐标过滤；过滤为空 ≠ 一张都没注册', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.setSearch('ml-agent');
    });
    expect(result.current.cards).toHaveLength(1);
    act(() => {
      result.current.setSearch('不存在的镜像');
    });
    expect(result.current.cards).toHaveLength(0);
    expect(result.current.noImagesAtAll).toBe(false);
  });
});

describe('useImageManager · 乐观更新只有一条边（F21-4 §5.1）', () => {
  /**
   * ① [禁用] 立刻改本地缓存 —— 断言的是**服务端还没返回时**开关已经翻了。
   *
   * MUTATION：删掉 `useDisableImage` 的 `onMutate` ⇒ 本条红。
   */
  it('① disable 乐观更新：服务端返回前缓存里已经是 isActive:false', async () => {
    const { client, result } = await mountManager();
    const g = gate();
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async () => {
        await g.hold;
        return HttpResponse.json({ ok: true });
      }),
    );

    act(() => {
      result.current.toggle('img-manifest-2', false);
    });

    await waitFor(() => {
      const rows = client.getQueryData<{ id: string; isActive: boolean }[]>(imageKeys.list());
      expect(rows?.find((r) => r.id === 'img-manifest-2')?.isActive).toBe(false);
    });
    g.release();
  });

  /** ② 失败回滚到原 `isActive`（15 §2.4）。 */
  it('② disable 失败 ⇒ 回滚到原来的 isActive', async () => {
    const { client, result } = await mountManager();
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, () =>
        HttpResponse.json({ code: 'INTERNAL', message: 'boom', retryable: true }, { status: 500 }),
      ),
    );

    act(() => {
      result.current.toggle('img-manifest-2', false);
    });

    await waitFor(() => {
      const rows = client.getQueryData<{ id: string; isActive: boolean }[]>(imageKeys.list());
      expect(rows?.find((r) => r.id === 'img-manifest-2')?.isActive).toBe(true);
    });
  });

  /**
   * ★ ③ **四条不该乐观的边，在服务端返回前 `setQueryData` 一次都不许被调用。**
   *
   * 这是 §5.1 那条纪律**唯一能被证伪**的形态。没有它，日后有人给 `revalidate` 加个
   * `onMutate` 把卡片先刷成 ✅，所有"最终值对"的断言照旧全绿——而用户会在那一瞬间
   * 看到一个平台自己编出来的结论。
   *
   * MUTATION：给 `useRevalidateImage` 加一个 `onMutate` 调 `setQueryData` ⇒ 本条红。
   */
  it('③ revalidate / checkUpdate / activate / saveConfig 在服务端返回前都不碰缓存', async () => {
    const { client, result } = await mountManager();
    const spy = vi.spyOn(client, 'setQueryData');
    const gates = [gate(), gate(), gate(), gate()];
    server.use(
      http.post(`${API_BASE}/api/images/:id/validate`, async () => {
        await gates[0]?.hold;
        return HttpResponse.json({});
      }),
      http.post(`${API_BASE}/api/images/:id/check-update`, async () => {
        await gates[1]?.hold;
        return HttpResponse.json({});
      }),
      http.post(`${API_BASE}/api/images/:id/activate`, async () => {
        await gates[2]?.hold;
        return HttpResponse.json({});
      }),
      http.patch(`${API_BASE}/api/images/:id`, async () => {
        await gates[3]?.hold;
        return HttpResponse.json({});
      }),
    );

    act(() => {
      result.current.revalidate('img-manifest-2');
      result.current.checkUpdate('img-manifest-2');
      result.current.activateVersion('img-manifest-3');
    });
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.saveEnv();
    });

    await waitFor(() => {
      expect(result.current.cards.some((c) => c.revalidating)).toBe(true);
    });
    // 三态文字、digest 一个字都没变（服务端还没返回）。
    const card = result.current.cards.find((c) => c.imageId === 'img-2');
    expect(card?.model.validationStatus).toBe('warning');
    expect(card?.model.digestShort).toBe('sha256:8e05a…d77');
    // ★ 关键断言：一次都没有。
    expect(spy).not.toHaveBeenCalled();

    for (const g of gates) g.release();
  });

  it('③b 四个写 mutation 成功后都 invalidate 镜像缓存（向导下拉共用它）', async () => {
    const { client, result } = await mountManager();
    const spy = vi.spyOn(client, 'invalidateQueries');
    server.use(http.post(`${API_BASE}/api/images/:id/activate`, () => HttpResponse.json({})));
    act(() => {
      result.current.activateVersion('img-manifest-3');
    });
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith({ queryKey: imageKeys.all() });
    });
  });

  /**
   * ★ ④ **[检查更新] 不 invalidate**：后端什么都没写，invalidate 会让整列表白重取一次，
   * 而没有任何一行变过——那次重取只会让卡片闪一下，还容易被读成"检查更新改了什么"。
   *
   * MUTATION：给 `useCheckImageUpdate` 加上 `onSuccess: invalidate` ⇒ 本条红。
   */
  it('④ checkUpdate 成功后**不**invalidate（它什么都没写）', async () => {
    const { client, result } = await mountManager();
    const spy = vi.spyOn(client, 'invalidateQueries');
    act(() => {
      result.current.checkUpdate('img-manifest-2');
    });
    await waitFor(() => {
      expect(result.current.cards.every((c) => !c.checkingUpdate)).toBe(true);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('useImageManager · 两颗按钮 / 两个端点，不互相顶替', () => {
  /**
   * ★ [重新验证] 与 [检查更新] 打的是两条路径。
   * MUTATION：把 `checkUpdate` 接到 `revalidateImage` 上 ⇒ 本条红（只会看到一条路径被打）。
   */
  it('revalidate 打 /:id/validate，checkUpdate 打 /:id/check-update', async () => {
    const { result } = await mountManager();
    const hit: string[] = [];
    server.use(
      http.post(`${API_BASE}/api/images/:id/validate`, ({ request }) => {
        hit.push(new URL(request.url).pathname);
        return HttpResponse.json({
          status: 'valid',
          errors: [],
          warnings: [],
          currentDigest: 'x',
          upstreamDigest: 'x',
          digestChanged: false,
        });
      }),
      http.post(`${API_BASE}/api/images/:id/check-update`, ({ request }) => {
        hit.push(new URL(request.url).pathname);
        return HttpResponse.json({
          current: { digest: 'x', resolvedAt: '2026-08-01T00:00:00.000Z' },
          upstream: { digest: 'x', validation: { status: 'valid', errors: [], warnings: [] } },
          changed: false,
        });
      }),
    );

    act(() => {
      result.current.revalidate('img-manifest-2');
    });
    await waitFor(() => {
      expect(hit).toContain('/api/images/img-manifest-2/validate');
    });
    act(() => {
      result.current.checkUpdate('img-manifest-2');
    });
    await waitFor(() => {
      expect(hit).toContain('/api/images/img-manifest-2/check-update');
    });
  });

  /**
   * ★ **[启用] 走 activate，绝不发 `PATCH { isActive:true }`**（后端对后者回 400）。
   * MUTATION：把 `toggle` 的 `next===true` 分支改成走 `disableMutation` / 或直接 PATCH ⇒ 本条红。
   */
  it('toggle(id, true) 打 /activate，而**没有任何** PATCH 发出去', async () => {
    const { result } = await mountManager();
    const paths: string[] = [];
    let patched = false;
    server.use(
      http.post(`${API_BASE}/api/images/:id/activate`, ({ request }) => {
        paths.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
      http.patch(`${API_BASE}/api/images/:id`, () => {
        patched = true;
        return HttpResponse.json({});
      }),
    );

    act(() => {
      result.current.toggle('img-manifest-3', true);
    });
    await waitFor(() => {
      expect(paths).toEqual(['/api/images/img-manifest-3/activate']);
    });
    expect(patched).toBe(false);
  });

  /**
   * [检查更新] 探到新 digest ⇒ 开对比弹层；采纳时是 **register + activate 两步**，
   * 因为 check-update 只探测、什么都没写（后端 I-IMG-7：不改旧行）。
   */
  it('checkUpdate 探到 changed ⇒ 开对比弹层；[更新到新版本] = register 再 activate', async () => {
    const { result } = await mountManager();
    server.use(
      http.post(`${API_BASE}/api/images/:id/check-update`, () =>
        HttpResponse.json({
          current: { digest: 'sha256:old', resolvedAt: '2026-08-01T00:00:00.000Z' },
          upstream: {
            digest: DIGEST_NEW,
            validation: { status: 'valid', errors: [], warnings: [] },
          },
          changed: true,
        }),
      ),
    );

    act(() => {
      result.current.checkUpdate('img-manifest-2');
    });
    await waitFor(() => {
      expect(result.current.compare).not.toBeNull();
    });
    expect(result.current.compare?.upstreamDigestShort).toBe('sha256:aa11b…899');
    expect(result.current.compare?.adopt).toEqual({
      kind: 'register',
      ref: 'docker.io/myrepo/ml-agent:v1.0',
    });
    // 🔄 角标同时挂上（**蓝色信息**，不是告警——当前镜像仍然完全可用）。
    expect(
      result.current.cards.find((c) => c.imageId === 'img-2')?.upstreamUpdate?.newDigestShort,
    ).toBe('sha256:aa11b…899');

    const seen: string[] = [];
    server.use(
      http.post(`${API_BASE}/api/images`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json(
          { manifest: { id: 'm-brand-new', digest: DIGEST_NEW }, validation: {} },
          { status: 201 },
        );
      }),
      http.post(`${API_BASE}/api/images/:id/activate`, ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return HttpResponse.json({});
      }),
    );
    act(() => {
      result.current.adoptNewVersion();
    });
    await waitFor(() => {
      expect(seen).toEqual(['/api/images', '/api/images/m-brand-new/activate']);
    });
  });

  it('checkUpdate 拿到 upstream:null（上游连 tag 都没了）⇒ 不开弹层、不当失败', async () => {
    const { result } = await mountManager();
    server.use(
      http.post(`${API_BASE}/api/images/:id/check-update`, () =>
        HttpResponse.json({
          current: { digest: 'sha256:old', resolvedAt: '2026-08-01T00:00:00.000Z' },
          upstream: null,
          changed: false,
        }),
      ),
    );
    act(() => {
      result.current.checkUpdate('img-manifest-2');
    });
    await waitFor(() => {
      expect(result.current.cards.every((c) => !c.checkingUpdate)).toBe(true);
    });
    expect(result.current.compare).toBeNull();
  });
});

describe('useImageManager · 注册弹窗', () => {
  it("openRegister 把 currentModal 设成 'registerImage'（set 与 read 同时落地）", async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.openRegister();
    });
    expect(useAppStore.getState().currentModal).toBe('registerImage');
    expect(result.current.registerOpen).toBe(true);
    act(() => {
      result.current.closeRegister();
    });
    expect(useAppStore.getState().currentModal).toBeNull();
  });

  /**
   * ★ 改动 URI ⇒ 结论**整块清掉**；**改回原值也不复活**（P21-4 §5「⏳ 结论已作废」）。
   * MUTATION：删掉 `onUriChange` 里的 `setValidationResult(undefined)` ⇒ 本条红。
   * ⚠️ **试过一个无效的变异**：删掉 `validatedUriRef.current = null` ⇒ **仍然全绿**——
   * result 已经被清掉了，ref 指向哪儿都换不回一个绿勾。这条交互的防线是"清掉"，
   * 不是"记住上次验的是谁"。记在这里，免得下一个人照着那句去改实现却看不到红。
   */
  it('验证通过后改动 URI ⇒ 结论清掉；改回原值仍是作废态', async () => {
    const { result } = await mountManager();
    server.use(
      http.post(`${API_BASE}/api/images/validate`, () =>
        HttpResponse.json({ status: 'valid', errors: [], warnings: [] }),
      ),
    );
    act(() => {
      result.current.openRegister();
    });
    act(() => {
      result.current.onUriChange('docker.io/a/b:v1');
    });
    act(() => {
      result.current.validate();
    });
    await waitFor(() => {
      expect(result.current.validationResult?.status).toBe('valid');
    });

    act(() => {
      result.current.onUriChange('docker.io/a/b:v1x');
    });
    expect(result.current.validationResult).toBeUndefined();
    expect(result.current.conclusionInvalidated).toBe(true);

    act(() => {
      result.current.onUriChange('docker.io/a/b:v1');
    });
    expect(result.current.validationResult).toBeUndefined();
    expect(result.current.conclusionInvalidated).toBe(true);
  });

  /** 重复注册（HTTP 200）**不当错误弹**：弹窗留在原地，就地提示 + [定位到该镜像]。 */
  it('注册命中已有 digest（200）⇒ 弹窗不关、给就地提示', async () => {
    const { result } = await mountManager();
    server.use(
      http.post(`${API_BASE}/api/images`, () =>
        HttpResponse.json(
          {
            manifest: {
              id: 'img-manifest-2',
              imageId: 'img-2',
              ref: 'docker.io/myrepo/ml-agent:v1.0',
              digest: 'sha256:8e05a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d77',
              isActive: true,
            },
            validation: {},
          },
          { status: 200 },
        ),
      ),
    );
    act(() => {
      result.current.openRegister();
    });
    act(() => {
      result.current.onUriChange('docker.io/myrepo/ml-agent:v1.0');
    });
    act(() => {
      result.current.save();
    });
    await waitFor(() => {
      expect(result.current.duplicate?.message).toContain('已注册');
    });
    expect(result.current.registerOpen).toBe(true);

    act(() => {
      result.current.locateExisting();
    });
    expect(result.current.registerOpen).toBe(false);
    expect(result.current.highlightedImageId).toBe('img-2');
  });

  it('URI 里有空白 ⇒ 即时提示（与后端 INVALID_IMAGE_REFERENCE 同口径）', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.onUriChange('docker.io/a b:v1');
    });
    expect(result.current.uriError).toContain('空格');
  });
});

describe('useImageManager · 环境变量（校验在 hook 层跑，不在 view）', () => {
  it('打开编辑器：secret 行 value 为空且 secretStored 为真（原值从未进过 props）', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    expect(result.current.envEditor?.rows).toEqual([
      { id: 'env-0', key: 'LOG_LEVEL', value: 'info', secret: false, secretStored: false },
      { id: 'env-1', key: 'MY_SECRET', value: '', secret: true, secretStored: true },
    ]);
  });

  /**
   * ★ 校验跑在 hook 层：view 连 `lib/` 都不能 import，所以 `errors` 必须是从这里下发的 prop。
   * MUTATION：把 `validateEnvVars(...)` 换成 `{errors:[],canAddRow:true,valueByteCounts:[]}` ⇒ 本条红。
   */
  it('输入保留变量名 ⇒ errors 里就地出现 ENV_NAME_RESERVED，且不发请求', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.changeEnvKey('env-0', 'OPENAI_API_KEY');
    });
    expect(result.current.envEditor?.errors).toEqual([
      { index: 0, field: 'key', code: 'ENV_NAME_RESERVED', path: 'env[0].key' },
    ]);

    // 预检没过就不发请求（后端会拿同一个码拒回来，白跑一趟网络）。
    let posted = false;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, () => {
        posted = true;
        return HttpResponse.json({});
      }),
    );
    act(() => {
      result.current.saveEnv();
    });
    expect(posted).toBe(false);
  });

  /** VALUE 上限按**字节**：4096 个 ASCII 通过、1366 个中文（4098 字节）超限。 */
  it('VALUE 上限按字节而不是字符（全中文的值会先超）', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.changeEnvValue('env-0', '中'.repeat(1366));
    });
    expect(result.current.envEditor?.valueByteCounts[0]).toBe(4098);
    expect(result.current.envEditor?.errors.some((e) => e.code === 'ENV_LIMIT_EXCEEDED')).toBe(
      true,
    );
  });

  it('secret 行一被输入即不再是"保持不变"（secretStored 转 false）', async () => {
    const { result } = await mountManager();
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.changeEnvValue('env-1', 'new-secret');
    });
    expect(result.current.envEditor?.rows[1]).toMatchObject({
      secret: true,
      secretStored: false,
      value: 'new-secret',
    });
  });

  /**
   * ★ 后端 400 按 `details[].path` **逐行归位**，不整表报错。
   * MUTATION：把 `mapEnvErrorResponse(...)` 的结果丢掉、只 toast 一句 ⇒ 本条红。
   */
  it('后端 400 的 details[] 归位到具体行（顶层码是 VALIDATION_FAILED，不参与查表）', async () => {
    const { result } = await mountManager();
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
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.saveEnv();
    });
    await waitFor(() => {
      expect(result.current.envEditor?.errors).toEqual([
        { index: 1, field: 'key', code: 'ENV_DUPLICATE_KEY', path: 'env[1].key' },
      ]);
    });
    // 编辑器仍开着（用户要改的正是那一行），且没有整表级错误盖住它。
    expect(result.current.envEditor?.generalError).toBeUndefined();
  });

  /**
   * ★ **"打开面板直接保存"必须是无操作**：secret 行的 value 保持 `''`（= 保持不变），
   * 而不是把库里的 secret 清空。请求体里那一行的 value 就是空串。
   */
  it('原样保存 ⇒ 请求体里 secret 行 value 为空串（= 保持不变，不是清空）', async () => {
    const { result } = await mountManager();
    let body: unknown;
    server.use(
      http.patch(`${API_BASE}/api/images/:id`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({});
      }),
    );
    act(() => {
      result.current.openEnvEditor('img-manifest-2');
    });
    act(() => {
      result.current.saveEnv();
    });
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
});
