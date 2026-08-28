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
import { listAudit } from '@/services/api/system.service';
import { AUDIT_CATEGORY_EMIT_STATUS } from '@/lib/audit/auditStream';
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

/**
 * ★ 审计流替身的形状必须**够得着真实后端会产出的形状**（12 §3.4）。
 *
 * 起因与 `'shell'` 同形：这份替身此前只喂 `category: sandbox|image`、
 * 只有 `sandbox.provision.stage` 一种 type、**每一行都恒有** `durationMs`/`outcome`/
 * `subjectType:'sandbox'`、`actor` 清一色 `system`。于是
 *   · 后端**从不写**的 `image` 类别在 dev 里有数据（真实环境永远为空）；
 *   · 后端**最高频**的 `scheduler` 一次都没喂过；
 *   · 「无 detail 的行不给展开箭头」「非沙箱行没有时间线入口」这两条纪律
 *     在替身下几乎没被触发过——story / 测试全绿，真实界面的行密度完全不同。
 *
 * 判据取自**后端写入点的实际取值**（audit.projector.ts + provision-sandbox.workflow.ts
 * + runtime-install.orchestrator.ts），不是这份替身自己的字面量。
 */
describe('MSW 替身：审计流的形状要够得着真实后端', () => {
  /**
   * ★★ 这条是 `AUDIT_CATEGORY_EMIT_STATUS`（`lib/audit/auditStream.ts`）的**跨仓对账守卫**。
   *
   * 那张表是一份手抄：真实来源是后端的那些写入点，openapi 表达不了「契约允许 ≠ 今天在写」。
   * 前端拿它决定空态说「当前筛选无匹配记录」还是「该类事件平台尚未记录」——抄本一旦漂移，
   * 页面上明明有镜像事件，空态却还在说「尚未记录」，而**所有别的用例照旧全绿**。
   *
   * ⚠️ 判据**不是字面量清单**（那只是把手抄搬个家），而是「替身实际产出的类别集合」——
   * 替身的形状是逐条照着后端写入点对齐的（`handlers.ts` 抬头），是本仓离后端最近的参照物。
   * 且**必须两个方向都断言**，少一个方向就锁不住（下面 ①/② 的编号与断言体里的注释一致）：
   *   · 只有方向①（"标 emitted 的替身里必须有"） ⇒ **后端开始写 image、替身跟着补上、
   *     而表还标着 not-yet** 时不会红：方向①根本不看被标 not-yet 的类别，那份过期的抄本
   *     就这么留在页面上说「尚未记录」。
   *   · 只有方向②（"标 not-yet 的替身里一条都不许有"） ⇒ **有人把 image 误标成 emitted、
   *     替身里却一条都没有**时不会红：方向②根本不看被标 emitted 的类别，那句"后端在写"
   *     没有任何东西背书。
   * 两个方向一起上，单改一边过不去。
   *
   * ★ 2026-08-28 这条**真的响过一次**：后端补齐 image/system 的写入点、替身按纪律补上那两档
   * 形状的当天，方向②当场红，逼着把表改成全 `emitted`。
   * 这就是它被造出来要抓的那一刻——不是"加了个断言"，是"它替我们发现了跨仓漂移"。
   *
   * ⚠️ 今天五个类别全 `emitted` ⇒ 方向②暂时没有真实实例可管，但**不许因此删掉它**：
   * 下一个类别（`automation` v1.1、或还空着的 `sandbox.health` 那种）落地时，
   * 它就是"后端补了、前端表没跟上"唯一会响的那道锁。
   */
  it('★ 对账：AUDIT_CATEGORY_EMIT_STATUS 与替身实际产出的类别**双向**一致', async () => {
    const page = await listAudit({ limit: 300 });
    expect(page.items.length).toBeGreaterThan(0);
    const inFixture = new Set<string>(page.items.map((e) => e.category));
    const declared = Object.entries(AUDIT_CATEGORY_EMIT_STATUS);
    // 表里五个类别一个不少（少一个 = 有类别没被这条守卫看着）。
    expect(declared).toHaveLength(5);

    for (const [category, status] of declared) {
      if (status === 'emitted') {
        // 方向 ①：声称"后端在写"的，替身里必须真的有——否则这句声称没有任何东西背书。
        expect(
          [...inFixture],
          `AUDIT_CATEGORY_EMIT_STATUS 说 ${category} 后端在写，但替身一条都没产出`,
        ).toContain(category);
      } else {
        // 方向 ②：声称"一条都不写"的，替身里一条都不许有——替身补上了就说明后端已经在写了。
        expect(
          [...inFixture],
          `替身产出了 ${category}，但 AUDIT_CATEGORY_EMIT_STATUS 还标着 not-yet-emitted：` +
            `后端已经开始写了就必须改表，否则空态会一直说「该类事件平台尚未记录」`,
        ).not.toContain(category);
      }
    }
  });

  it('actor 覆盖后端的六个（含**最高频的 scheduler**），且 scheduler 就是最高频的那个', async () => {
    const page = await listAudit({ limit: 300 });
    const actors = page.items.map((e) => e.actor);
    for (const actor of [
      'scheduler',
      'reaper',
      'user',
      'health-check',
      'provider-event',
      'system',
    ]) {
      expect(actors, `替身从未产出 actor=${actor}`).toContain(actor);
    }
    const count = (a: string): number => actors.filter((x) => x === a).length;
    for (const other of ['reaper', 'user', 'health-check', 'provider-event', 'system']) {
      expect(count('scheduler')).toBeGreaterThan(count(other));
    }
  });

  it('⭐ 至少一条**没有** durationMs / outcome / detail（真实的 project.created 就长这样）', async () => {
    // 这一条行在界面上：耗时与结果两列是空的、**不给展开箭头**、也没有 [查看该沙箱完整时间线]。
    // 替身里一条都没有的那一版，这三条纪律从来没被真正触发过。
    const page = await listAudit({ limit: 300 });
    const bare = page.items.filter(
      (e) => e.durationMs === undefined && e.outcome === undefined && e.detail === undefined,
    );
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.some((e) => e.type === 'project.created')).toBe(true);
    expect(bare.some((e) => e.type === 'credential.stored')).toBe(true);
    // 非沙箱 subject ⇒ 没有时间线入口这条判据在替身里真的会被走到。
    expect(bare.every((e) => e.subjectType !== 'sandbox')).toBe(true);
  });

  /**
   * ★ `system.*` 是替身里第一批**连主体都没有**的行（后端：主体就是平台自己）。
   *
   * 「非沙箱行没有时间线入口」此前只被 `project.created` / `credential.stored` 那种
   * "有 subject、只是不是 sandbox" 的行验证过。`subjectType` 缺席是更强的形态：
   * 任何 `event.subjectType === 'sandbox'` 之外的简写（比如 `subjectId!` 或
   * `subjectType.startsWith(...)`）在这一批上才会真正炸。
   */
  it('⭐ system.* 一条都没有 subjectType / subjectId（主体就是平台自己 ⇒ 无时间线入口）', async () => {
    const page = await listAudit({ limit: 300 });
    const system = page.items.filter((e) => e.category === 'system');
    expect(system.length).toBeGreaterThan(0);
    for (const e of system) {
      expect(e.subjectType, `${e.type} 不该有 subjectType`).toBeUndefined();
      expect(e.subjectId, `${e.type} 不该有 subjectId`).toBeUndefined();
    }
    // 口令的**任何**投影都不许进 detail（长度 / 前缀 / 哈希都算）：审计是长期留存且可导出的。
    for (const e of system) {
      const keys = Object.keys(e.detail ?? {});
      expect(
        keys.every((k) => !/pass|code|secret|token|hash/i.test(k)),
        `${e.type} 的 detail 键 ${keys.join(',')} 里疑似有口令投影`,
      ).toBe(true);
    }
  });

  it('⭐ 非沙箱的 error 级样本真的存在（system.access.locked）', async () => {
    // 此前 error 只出在 `sandbox.provision.stage` 上 ⇒ "error 行长什么样"几乎只被
    // 一个形状验证过，而那个形状恰好**有** subject / durationMs / detail 全套。
    const page = await listAudit({ limit: 300 });
    const errors = page.items.filter((e) => e.severity === 'error');
    expect(errors.some((e) => e.type === 'system.access.locked')).toBe(true);
    expect(errors.some((e) => e.subjectType === undefined)).toBe(true);
  });

  /**
   * ★ 镜像事件的 `subjectId` 必须是**这份替身自己 `GET /api/images` 里真有的** manifestId
   *   （本文件抬头那条纪律，与 `'shell'` 同形），而 `summary` 里才是完整 ref。
   *
   * ⚠️ 把 ref 塞进 subjectId 的那一版，「按对象筛」在 dev 里照样自洽、真后端上永远筛不到。
   */
  it('⭐ image.* 的 subjectId ∈ GET /api/images 的 manifestId，且 summary 里是完整 ref', async () => {
    const manifestIds = new Set((await listImages()).map((m) => m.id));
    const refById = new Map((await listImages()).map((m) => [m.id, m.ref]));
    const page = await listAudit({ limit: 300 });
    const images = page.items.filter((e) => e.category === 'image');
    expect(images.length).toBeGreaterThan(0);
    for (const e of images) {
      expect(e.subjectType).toBe('image');
      expect([...manifestIds], `${e.type} 的 subjectId 不在镜像清单里`).toContain(e.subjectId);
      const ref = refById.get(e.subjectId ?? '');
      expect(ref).toBeDefined();
      // summary 里给的是人能读的 ref（registry/repo:tag），不是那个 id。
      expect(e.summary, `${e.type} 的 summary 里没有 ref`).toContain(ref);
      expect(e.subjectId).not.toBe(ref);
    }
  });

  /**
   * ⛔ `image.config_updated` **不带 detail**（04 §2.3★）：镜像 env 会被物化成
   * `export K=V` 拼进命令串，它的任何投影落进审计 = 把用户填的密钥永久留在一张可导出的表里。
   * 界面上这行因此没有展开箭头——那是对的，不是漏了。替身里给它编一个 detail，
   * 这条纪律就再也没有现场。
   */
  it('⭐ image.config_updated 一条 detail 都没有（env 绝不投影进审计）', async () => {
    const page = await listAudit({ limit: 300 });
    const updates = page.items.filter((e) => e.type === 'image.config_updated');
    expect(updates.length).toBeGreaterThan(0);
    expect(updates.every((e) => e.detail === undefined)).toBe(true);
  });

  /**
   * ⏳ `sandbox.health` 后端**至今没有生产者**（沙箱档唯一还空着的 type）。
   *
   * ⚠️ 这条守的是与"多喂一个类别"对称的另一半：替身**不许**凭空造一个后端不产出的 type。
   * 造了它，「健康检查也会记一笔」这件事在 dev / story 里成立、真实环境永远不成立。
   * 后端哪天真写了，这条会红——那时该做的是补形状、并把这条改成"必须有"。
   */
  it('⏳ sandbox.health 一条都不喂（后端还没有这个写入点）', async () => {
    const page = await listAudit({ limit: 300 });
    expect(page.items.map((e) => e.type)).not.toContain('sandbox.health');
  });

  it('⭐ severity 是**服务端**筛的：`warn,error` 只回 warn/error，且两者都回得出来', async () => {
    // ⚠️ 替身不实现 `IN (...)` 的话，「仅告警」在 dev / Storybook / e2e 里等于没筛，
    //    而所有断言都还能凑出来——正是"前端与它自己的替身完全自洽"那一形态。
    const alerts = await listAudit({ severity: 'warn-and-error', limit: 300 });
    expect(alerts.items.length).toBeGreaterThan(0);
    expect(alerts.items.every((e) => e.severity === 'warn' || e.severity === 'error')).toBe(true);
    expect(alerts.items.some((e) => e.severity === 'warn')).toBe(true);
    expect(alerts.items.some((e) => e.severity === 'error')).toBe(true);
    // 并且真的筛掉了东西（否则这条在"替身恒回全部"时也会绿）。
    const all = await listAudit({ limit: 300 });
    expect(alerts.items.length).toBeLessThan(all.items.length);
  });
});
