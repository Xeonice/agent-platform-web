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

  it('provider 注册表里是后端真实注册的两个 provider，且默认档是 aio', async () => {
    // 依据：api/packages/modules/sandbox/src/infrastructure/registry/provider-registry.ts
    // 的 `private defaultName = 'aio'`，与 sandbox.module.ts 注册的 aio / boxlite。
    const rows = await listProviders();
    expect(rows.map((p) => p.name)).toEqual(['aio', 'boxlite']);
    expect(rows.filter((p) => p.isDefault).map((p) => p.name)).toEqual(['aio']);
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
