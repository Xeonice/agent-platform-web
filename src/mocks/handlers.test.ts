// @vitest-environment node
// ★ **替身自洽性门禁**（12 §3.4 / 14 §10.4）。
//
// 起因：`src/mocks/handlers.ts` 两处返回过 `runtime: 'shell'`，而后端注册表里只有 codex / claude-code。
// 前端硬编码了同一个 `'shell'` ⇒ **前端与它自己的替身完全自洽**，单测 / Storybook / Playwright 全绿，
// 真后端从头到尾没进过回路。类型拦不住（契约是开放 `string`，且不该收窄）、
// docs:check 也拦不住（那个值在契约层面完全合规）。
//
// 于是这里补上唯一还能拦住它的那一层：**在替身内部把"开放集的取值必须来自替身自己的注册表"钉死**。
// 判据不是"等于某个字面量"（那只是把硬编码搬了个家），而是"∈ `GET /api/runtimes` / `GET /api/providers`
// 当场返回的集合"——注册表怎么变，判据跟着变；凭空造一个键就红。
//
// 走**真实 service 层**打这些请求（而不是裸 fetch）：既守住 07 §3 规则 5，也顺带证明替身的形状
// 真的能被生产代码消费下去。MSW node server 由 vitest.setup.ts 全局 listen。
//
// ⚠️ 这条**不能替代真跑**：替身再自洽，也只证明"前端与它理解的后端一致"（12 §3.4 末节）。
import { describe, it, expect } from 'vitest';
import { listRuntimes, getRuntimeAuthStatus } from '@/services/api/runtime.service';
import { listProviders } from '@/services/api/provider.service';
import { createSandbox, getSandbox } from '@/services/api/sandbox.service';
import { listAgentTasks } from '@/services/api/task.service';
import { listImages } from '@/services/api/image.service';
import { ApiErrorException } from '@/services/api/apiError';

describe('MSW 替身：开放集的取值必须来自替身自己的注册表', () => {
  it('POST /api/sandboxes 回的 runtime ∈ GET /api/runtimes（不是凭空的 shell）', async () => {
    const registry = (await listRuntimes()).map((r) => r.id);
    expect(registry.length).toBeGreaterThan(0);

    const created = await createSandbox({ projectId: 'proj-demo', runtime: registry[0] ?? '' });
    expect(registry).toContain(created.runtime);
  });

  it('GET /api/sandboxes/:id 回的 runtime 同样 ∈ 注册表（刷新恢复那条路也不许撒谎）', async () => {
    const registry = (await listRuntimes()).map((r) => r.id);
    const restored = await getSandbox('sb-1');
    expect(registry).toContain(restored.runtime);
  });

  it('沙箱响应的 provider ∈ GET /api/providers（DTO 里它是必填，漏掉过一次）', async () => {
    const providers = (await listProviders()).map((p) => p.name);
    expect(providers.length).toBeGreaterThan(0);

    const restored = await getSandbox('sb-1');
    expect(providers).toContain(restored.provider);
  });

  it('任务 DTO 的 runtime ∈ 注册表（无头链路的 :rt 取的就是它）', async () => {
    const registry = (await listRuntimes()).map((r) => r.id);
    const tasks = await listAgentTasks('sb-1');
    expect(tasks.length).toBeGreaterThan(0);
    for (const t of tasks) expect(registry).toContain(t.runtime);
  });

  it('建沙箱时用户选了哪个 runtime/provider，替身就回哪个（开放集不许被"纠正"）', async () => {
    // 第三方在运行时注册的键——它不在替身的注册表里，替身也不该把它改写成自己认识的那个。
    const created = await createSandbox({
      projectId: 'p',
      runtime: 'acme-agent',
      provider: 'acme-box',
    });
    expect(created.runtime).toBe('acme-agent');
    expect(created.provider).toBe('acme-box');
  });
});

describe('MSW 替身：注册表本身说的是真话', () => {
  it('runtime 注册表里是后端真实注册的两个 adapter id', async () => {
    // 依据：api/packages/modules/runtime/src/infrastructure/adapters/{codex,claude-code}/*.adapter.ts
    // 的 `readonly id`。这条是"值不能凭空"的锚点——注册表本身若被改成一个不存在的键，这里红。
    expect((await listRuntimes()).map((r) => r.id)).toEqual(['codex', 'claude-code']);
  });

  it('provider 注册表里是后端真实注册的两个 provider，且**恰好一个**默认档（不钉名字）', async () => {
    // 依据：api/packages/modules/sandbox/src/interface/sandbox.module.ts 注册的 aio / boxlite。
    const rows = await listProviders();
    expect(rows.map((p) => p.name)).toEqual(['aio', 'boxlite']);

    /**
     * ⚠️ 这里**曾经**写 `expect(defaults).toEqual(['aio'])`，依据是后端那时的
     * `private defaultName = 'aio'`。那行后端代码已经没了：默认档改为
     * `hostPreferredProvider()` 按宿主平台决定——macOS→boxlite（微 VM，Apple
     * Hypervisor.framework，原生），Linux→aio（原生 docker）。原因是
     * `AioSandboxProvider extends DockerContainerBackend`：aio 就是 docker 容器，
     * Mac 上要 Docker Desktop，把它当默认，用户看到的是「镜像尚未注册」而不是真原因。
     *
     * 于是「默认档叫 aio」从**契约**降级成了**Linux 上的巧合**，替身自洽性门禁不能再钉它
     * （钉了就是拿一个只在半数平台成立的事实当依据，正是本文件开头那个 `'shell'` 的病）。
     * 改成与后端 `provider-registry.spec.ts` 同一口径：**恰好一个 default**。
     *
     * 「且它在已注册的集合里」那半句在这个 DTO 形状下是结构自动成立的——`isDefault`
     * 是每一项自己的布尔位，不是顶层的一个名字字符串（后端那边它是独立字段，所以
     * 那边的 `has(defaultProvider)` 才抓得到东西）。这里再写一句只是自证，故不写。
     *
     * 变异：把替身两项都标 isDefault:true（或都 false）⇒ 这条红。
     */
    expect(rows.filter((p) => p.isDefault)).toHaveLength(1);
  });

  it('替身里两个内置 provider 的 spawnTty / headlessTask 都是 true（后端两个类都这么声明）', async () => {
    /**
     * 只钉这两位，因为**前端今天只读这两位**：`spawnTty=false` 禁建沙箱入口、
     * `headlessTask=false` 置灰无头入口。其余五位（volumeMount / updateResources /
     * pauseResume / snapshot / watchEvents）没有任何 UI 读，替身里写错也变不出界面差异，
     * 在这里钉它们只是把七个字面量抄两遍——**这条断言的价值来自"错了会让 dev 看到假界面"**，
     * 不来自"覆盖得全"。
     *
     * 依据：`aio-sandbox.provider.ts` 与 `boxlite-sandbox.provider.ts` 各自的
     * `capabilities`——两个内置档位这两位现在都是 `true`（`headlessTask` 是 S6 落地后才都开的）。
     * 替身此前给 boxlite 写 `headlessTask: false`，理由是"这样置灰那条路径在 dev 里看得见"：
     * 那就是 14 §10 的形状——**为了看见一个界面态，在替身里造一个后端没有的事实**。
     * 置灰态该由 story / 容器单测显式构造（它们用第三方档位名 `acme-box`，不冒充内置档位）。
     *
     * 变异：把 `handlers.ts` 里 boxlite 的 `headlessTask` 改回 `false` ⇒ 这条红。
     */
    for (const p of await listProviders()) {
      expect(p.capabilities.spawnTty, `${p.name}.spawnTty`).toBe(true);
      expect(p.capabilities.headlessTask, `${p.name}.headlessTask`).toBe(true);
    }
  });

  it('单 runtime 状态端点回的是**被问的那个** runtime（不是永远回第一张卡）', async () => {
    const second = (await listRuntimes())[1];
    expect(second).toBeDefined();
    const status = await getRuntimeAuthStatus(second?.id ?? '');
    expect(status.id).toBe(second?.id);
    expect(status.displayName).toBe(second?.displayName);
  });

  it('未注册的 runtime → 404（与后端 `unknown runtime <id>` 同口径）', async () => {
    await expect(getRuntimeAuthStatus('not-a-runtime')).rejects.toBeInstanceOf(ApiErrorException);
  });
});

describe('MSW 替身：默认任务名按后端的领域策略算', () => {
  // 依据：api/packages/modules/sandbox/src/domain/services/task-name.policy.ts
  async function nameFor(initialPrompt?: string): Promise<string> {
    const created = await createSandbox({
      projectId: 'p',
      runtime: 'codex',
      ...(initialPrompt === undefined ? {} : { initialPrompt }),
    });
    return created.name;
  }

  it('取**首个非空行**的前 20 个码点（不是第一行、不是 UTF-16 单元）', async () => {
    expect(await nameFor('\n  \n把这个仓库的架构分析一遍并输出摘要给我看看')).toBe(
      '把这个仓库的架构分析一遍并输出摘要给我看…',
    );
  });

  it('没超 20 且后面没有别的非空行 ⇒ 不补省略号', async () => {
    expect(await nameFor('跑一下测试')).toBe('跑一下测试');
  });

  it('首行没超 20 但后面还有非空行 ⇒ 仍补省略号（名字没展示完整指令）', async () => {
    expect(await nameFor('跑一下测试\n然后把失败的贴出来')).toBe('跑一下测试…');
  });

  it('无指令 ⇒ `<Runtime displayName> · <UTC YYYY-MM-DD HH:mm>`（不是本地时区、不是 runtime id）', async () => {
    expect(await nameFor()).toMatch(/^Codex · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});

/**
 * ★ 镜像替身的同一条不变量：**`supportedRuntimes` 的取值必须来自替身自己的 runtime 注册表**。
 *
 * 向导下拉的过滤规则是 `is_active ∧ (valid|warning) ∧ supportedRuntimes 含所选 runtime`
 *（`lib/image/selectableImages.ts`）。替身里凭空写一个 `'shell'`，
 * 过滤在测试与 Storybook 里会**完全自洽**（前端与它自己的替身一致），
 * 而真后端上永远过滤不出任何镜像——14 §10 那次事故的原样复刻，只是换了个字段。
 *
 * MUTATION：把某一行的 `supportedRuntimes` 改成 `['shell']` ⇒ 本条红。
 */
describe('MSW 替身：镜像的 supportedRuntimes 必须来自 runtime 注册表', () => {
  it('每一行 manifest 声明的 runtime 都 ∈ GET /api/runtimes', async () => {
    const registry = (await listRuntimes()).map((r) => r.id);
    const manifests = await listImages();
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      expect(manifest.supportedRuntimes.length).toBeGreaterThan(0);
      for (const runtimeId of manifest.supportedRuntimes) {
        expect(registry, `manifest ${manifest.id} 声明了注册表里没有的 runtime`).toContain(
          runtimeId,
        );
      }
    }
  });

  /**
   * ⚠️ **本条 2026-08 整条改写。原断言守着的是一条错规则**，存档如下：
   *
   *     expect(manifest.validationStatus).not.toBe('invalid');      // ① 放行了 pending
   *     expect(manifest.supportedRuntimes).toContain('claude-code'); // ② 预装当成了能跑
   *
   * ① 与 `lib/image/selectableImages` 的白名单用例**直接冲突**——那条专门禁止
   *   「≠ invalid」的写法，因为 13 §2.4 的 `pending` 默认值会从这个口子漏进向导下拉。
   * ② 已被真机实测否掉：给平台预制镜像打上诚实标签（只预装 codex）之后，
   *   `?runtimeId=claude-code` 返回 **0 张**，而那是平台唯一的镜像。
   *
   * ⚠️ 更要紧的是这两条错**只存在于替身里**——替身与生产实现了两条不同的规则，
   * 于是集成测试全绿，而它验证的是替身的行为。
   *
   * ⚠️ 一度想让 handler 直接 import `lib/image/selectableImages` 来根除分叉，
   * 被 `boundaries`（`{ from:'mock', allow:['type','mock'] }`）挡了 —— **而那条规则是对的**：
   * 本 handler 替的是**后端** `listSelectable`，复用前端的客户端过滤会把两件事混成一件；
   * 而且替身 import 生产代码之后就再也抓不出生产代码的 bug。
   * ⇒ 规则在两处各写一遍，由**本条断言行为**去钉住它们不分叉。
   */
  it('带 runtimeId 的那条路：白名单放行，且 runtime 不参与过滤', async () => {
    const all = await listImages();
    const selectable = await listImages('claude-code');

    for (const manifest of selectable) {
      expect(manifest.isActive).toBe(true);
      // MUTATION: 替身改回「≠ invalid」⇒ pending 漏进来，本行红。
      expect(['valid', 'warning']).toContain(manifest.validationStatus);
    }
    // ⭐ 与旧断言相反：**只预装 codex 的镜像仍在可选集里**。
    // MUTATION: 替身加回 `supportedRuntimes.includes(runtimeId)` ⇒ 本行红。
    const codexOnly = all.filter(
      (m) =>
        m.isActive &&
        m.validationStatus !== 'invalid' &&
        !m.supportedRuntimes.includes('claude-code'),
    );
    if (codexOnly.length > 0) {
      expect(selectable.map((m) => m.id)).toEqual(
        expect.arrayContaining(codexOnly.map((m) => m.id)),
      );
    }
  });
});

/**
 * ★ 镜像替身的第二条不变量：**`derivedFromDigest` 必须指向替身里真的存在的那张锚点**。
 *
 * 后端的准入规则（04 §7 ★血统）是「非内置镜像必须能证明派生自某张已注册的内置锚点」，
 * 而这一列存的就是**匹配到的那张锚点的 digest**（`drizzle/0012`）。替身里凭空写一个
 * 查无此人的 digest，"基于 X"这类呈现在测试与 Storybook 里会完全自洽，真后端上
 * 那张镜像**根本注册不进来**——与上面 `'shell'` 那条同一形状，只是换了个字段。
 *
 * 判据同样是**当场返回的集合**而不是字面量：内置锚点怎么变，判据跟着变。
 *
 * MUTATION：把任一条第三方夹具的 `derivedFromDigest` 改成 `sha256:${'f'.repeat(64)}` ⇒ 本条红。
 */
describe('MSW 替身：血统指向的锚点必须在替身内部查得到', () => {
  it('每一条非 null 的 derivedFromDigest 都 ∈ 同一批里内置行的 digest', async () => {
    const manifests = await listImages();
    const anchors = manifests.filter((m) => m.isBuiltin).map((m) => m.digest);
    expect(anchors.length, '替身里必须至少有一张内置锚点，否则本条无从证伪').toBeGreaterThan(0);

    const derived = manifests.filter((m) => m.derivedFromDigest !== null);
    // ⚠️ 与 `pending` 那条同一手法：**先有能触发它的数据**，断言才谈得上有效。
    expect(derived.length, '替身里必须至少有一条带血统的行').toBeGreaterThan(0);

    for (const manifest of derived) {
      expect(anchors, `manifest ${manifest.id} 的血统指向替身里不存在的锚点`).toContain(
        manifest.derivedFromDigest,
      );
    }
  });

  /**
   * ⚠️ `null` 有**两种**语义（0012）：① 内置根镜像自己就是锚点；② 切片前的存量行。
   * 把 NULL 一律读成 ① 会把存量行说成平台根镜像，一律读成「没有基于任何平台镜像」
   * 又会把存量行冤成违规。这条钉住的是：**替身里两种 NULL 都有**，
   * 于是下游任何"NULL ⇒ 内置"的简写都能被证伪。
   */
  it('替身同时提供了两种 null：内置根镜像、以及切片前的存量行', async () => {
    const manifests = await listImages();
    const nulls = manifests.filter((m) => m.derivedFromDigest === null);
    expect(nulls.some((m) => m.isBuiltin)).toBe(true);
    expect(nulls.some((m) => !m.isBuiltin)).toBe(true);
  });
});
