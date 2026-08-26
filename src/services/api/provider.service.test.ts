// @vitest-environment node
// API 集成测试用 node 环境：MSW/node 对 undici fetch 的拦截在 node 环境下最稳定（与 health.service.test 同规格）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { listProviders } from '@/services/api/provider.service';
import { ApiErrorException } from '@/services/api/apiError';
import type { SandboxProviderCapabilities } from '@/types/sandbox';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 七位能力位 fixture（显式返回类型：契约加一位时这里编译期红，而不是替身静默少一位）。 */
function caps(overrides: Partial<SandboxProviderCapabilities> = {}): SandboxProviderCapabilities {
  return {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: true,
    snapshot: true,
    watchEvents: true,
    headlessTask: true,
    ...overrides,
  };
}

describe('provider.service（开放 registry 只读投影）', () => {
  /**
   * ⚠️ 这条**故意不吃默认 MSW 替身**，改用当场给的 stub。
   *
   * 原来写的是 `expect(names).toEqual(['aio','boxlite'])` + `find((p) => p.isDefault)?.name === 'aio'`。
   * 两句描述的都是**替身长什么样**，不是**这一层做了什么**；而且后一句现在已经是错的：
   * 后端默认档不再写死，改为按宿主平台决定（`api/.../registry/provider-registry.ts` 的
   * `hostPreferredProvider()`：macOS→boxlite / Linux→aio）。原因是
   * `AioSandboxProvider extends DockerContainerBackend` —— aio 就是 docker 容器，Mac 上要先装
   * Docker Desktop；boxlite 是微 VM，macOS 上走 Apple Hypervisor.framework，原生。
   * 所以「aio 是默认」只在 Linux 上碰巧成立，它从来不是契约。
   *
   * service 这一层做的事只有一件：**把后端的扁平数组原样交出来**——不排序、不过滤、
   * 不补默认、不动能力位。stub 因此故意给**非字母序**、且**不是内置那两个**的名字：
   * 谁要是在这一层加排序 / 只认识内置名 / 给缺省能力位补值，这条当场红。
   */
  it('GET /api/providers → 扁平数组原样透传（不排序、不过滤、能力位不补默认）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json([
          { name: 'zeta', capabilities: caps({ spawnTty: false }), isDefault: false },
          { name: 'mid', capabilities: caps({ snapshot: false }), isDefault: true },
          { name: 'alpha', capabilities: caps({ headlessTask: false }), isDefault: false },
        ]),
      ),
    );

    const providers = await listProviders();

    // 顺序与条数原样（按字母排一下就红；过滤掉不认识的名字也红）。
    expect(providers.map((p) => p.name)).toEqual(['zeta', 'mid', 'alpha']);
    // 七位能力位逐项原样（被"补全"成默认值就红——能力位是显隐判据，补一位等于凭空造能力）。
    expect(providers[0]?.capabilities).toEqual(caps({ spawnTty: false }));

    /**
     * 默认档**不看名字**，与后端同口径（对齐 `provider-registry.spec.ts`）：
     * 恰好一个 default（不是零个、不是两个），且它就是服务端标的那一项——
     * service 既不补一个默认，也不把默认挪到别人身上。
     *
     * 「它在已注册的集合里」这半句在这个 DTO 形状下是**结构自动成立**的：
     * `isDefault` 是数组每一项自己的布尔位，不是顶层的一个名字字符串，
     * 所以再写一句 `expect(names).toContain(defaultName)` 只是自证，抓不到任何回归。
     * 真正会坏的那半句是「恰好一个」，钉的就是它。
     */
    const defaults = providers.filter((p) => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe('mid');
  });

  it('第三方 provider 原样透传（service 不过滤、不枚举、不补默认）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json([
          {
            name: 'acme',
            capabilities: caps({
              volumeMount: false,
              updateResources: false,
              pauseResume: false,
              snapshot: false,
              headlessTask: false,
            }),
            isDefault: true,
          },
        ]),
      ),
    );
    const providers = await listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.name).toBe('acme');
    expect(providers[0]?.isDefault).toBe(true);
  });

  it('非 2xx → ApiErrorException（承载后端信封）', async () => {
    server.use(
      http.get(`${API_BASE}/api/providers`, () =>
        HttpResponse.json(
          { code: 'INTERNAL', message: 'registry 不可用', retryable: true },
          { status: 500 },
        ),
      ),
    );
    await expect(listProviders()).rejects.toBeInstanceOf(ApiErrorException);
  });
});
