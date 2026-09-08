// 保留变量名黑名单 · 前后端对账（技术 05 §4.1 为唯一权威，P21-4 §10.4/§10.6）。
//
// ═══ 这个文件存在的理由 ═══════════════════════════════════════════════════
// `lib/image/validateEnvVar.ts` 的黑名单是后端 `shared-kernel/src/domain/reserved-env.ts`
// 的**镜像**。抄漏一项的后果不是"前端宽松一点"：用户在镜像 env 编辑器里输入那个名字，
// 前端一路绿灯、点提交被后端 `ENV_NAME_RESERVED` 拒掉 —— 正是 `validateEnvVar.ts` 开头
// 那段注释宣称要防的那件事。实际发生过一次：`CLAUDE_CONFIG_DIR`（重定向类，05 §4.1 P1-2）
// 只在后端有，前端放行。
//
// ⛔ **所以本文件刻意不写「断言列表里有 CLAUDE_CONFIG_DIR」那种用例**：那种用例只钉死
//    已经发生过的那一次，后端下次再加一个新名字，它照样全绿。要抓的是**漂移本身**，
//    不是漂移的某一个历史实例。
//
// ═══ 两层，各自能抓什么、抓不到什么（诚实清单）═══════════════════════════
//
// 【第一层 · 逐条对账】读**后端源文件本身**，把两张表整个比一遍。
//   ✅ 抓得到：后端新增/删除/改名任何一项而前端没跟 —— 无论是哪一项、加了几项。
//   ✅ 抓得到：前端凭空多出一个后端根本不拦的名字（前端更严格在安全上无害，
//      但它是个 UX bug：用户被前端拦下，而后端其实接受这个变量）。
//   ⛔ **抓不到：`../api` 不在盘上的时候（= web 仓自己的 CI）。**
//      `web/.github/workflows/ci.yml` 的每个 job 都只 `actions/checkout` 这一个仓，
//      没有 api submodule；跨仓 import 更不可行（两仓两套 tsconfig、两套依赖）。
//      ⇒ 这一层在 web CI 上是 **skip**，不是 pass。它真正跑起来的场合是：
//        ① 开发者在主仓（两个 submodule 都在）本机跑 `pnpm test`；
//        ② 主仓 `.github/workflows/docs-check.yml` 那类**同时持有两个 submodule** 的
//           跨仓门禁 —— 那里已经有 B3（openapi 逐字节）/ B4（WS 协议）两条同性质对账，
//           这张表是天然的 B5 候选。
//      ⇒ 结论写在明处：**web 仓单独的 CI 无法阻断后端侧的新增**。谁把这条门禁当成
//        "已覆盖"，谁就会在下一次后端加名字时重演 `CLAUDE_CONFIG_DIR`。
//
// 【第二层 · 镜像快照】把后端那张表的**副本**钉在本文件里，每次都跑（含 web CI）。
//   ✅ 抓得到：**前端侧**的回退 —— 有人从 `RESERVED_ENV_KEYS` 里删掉/改坏一项。
//   ⛔ 抓不到：后端新增。快照是从后端抄来的，后端动了它不会自己动。
//   ⇒ 它是第一层在 CI 上缺席时的**下限**，不是替代品。
//      快照与后端不一致时，第一层（有 api 时）会红并要求同时更新快照与前端表。
//
// 【两层都抓不到的第三类】后端的黑名单已经不再只是这张静态表：`registerReservedEnvNames`
//   会在启动时把**已注册 RuntimeAdapter 自己声明的**保留名（04 §3 ★3z `reservedEnvNames`）
//   并进去。runtime 是开放注册表 ⇒ 第三方 adapter 带来的名字，前端这份静态镜像
//   **在原理上就不可能齐**：它们只在后端进程启动后才存在。
//   ⇒ 前端要覆盖那一类，只能等一个「把生效黑名单下发给前端」的契约（没有就只能靠后端拒绝
//     时的 `ENV_NAME_RESERVED` 兜底）。⛔ 别在前端猜第三方 adapter 会保留什么名字。
// ═════════════════════════════════════════════════════════════════════════
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  RESERVED_ENV_KEYS,
  RESERVED_ENV_PREFIXES,
  validateEnvVars,
} from '@/lib/image/validateEnvVar';

/** web 仓根目录（本文件在 `src/lib/image/__tests__/` 下，向上四层）。 */
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * 后端那张表的位置。默认按主仓布局取同级 `api/`；`API_REPO_ROOT` 允许 CI（或别的
 * checkout 布局）显式指路 —— 让第一层**能被打开**，而不是只能听天由命。
 */
const API_ROOT = process.env['API_REPO_ROOT'] ?? resolve(WEB_ROOT, '..', 'api');
const BACKEND_RESERVED_ENV_FILE = join(
  API_ROOT,
  'packages',
  'shared-kernel',
  'src',
  'domain',
  'reserved-env.ts',
);
const BACKEND_AVAILABLE = existsSync(BACKEND_RESERVED_ENV_FILE);

if (!BACKEND_AVAILABLE) {
  // 大声 skip（与主仓 docs-check 对 B 类检查的做法同源）：静默跳过的门禁 = 没有门禁。
  console.warn(
    `[reservedEnvReconcile] 读不到后端保留名表（${BACKEND_RESERVED_ENV_FILE}）⇒ ` +
      '【逐条对账】整组 skip。这不是"通过"：web 仓单独的 CI 只 checkout 自己一个仓，' +
      '因此**抓不到后端侧的新增**。要打开它：在同级放置 api 仓，或设 API_REPO_ROOT。',
  );
}

/**
 * 后端 `RESERVED_ENV_EXACT` 的镜像快照（第二层）。
 * 来源：`api/packages/shared-kernel/src/domain/reserved-env.ts`，顺序照抄。
 * ⚠️ 改它的**唯一**正当理由是"后端那张表真的变了"，且必须与 `RESERVED_ENV_KEYS` 同时改。
 */
const BACKEND_EXACT_SNAPSHOT: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'SSH_PRIVATE_KEY',
  'KUBECONFIG',
  'HOME',
  'USER',
  'PATH',
  'PWD',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
];

/** 后端 `RESERVED_ENV_PREFIXES` 的镜像快照。 */
const BACKEND_PREFIX_SNAPSHOT: readonly string[] = ['CODEX_', 'GIT_'];

/**
 * 前端是否拦下这个名字 —— 走**公开行为**（`validateEnvVars`）而不是读那两个数组：
 * 用户遇到的是校验结果，不是数组内容；判定口径（大小写敏感、前缀整体拦截）也一并被覆盖。
 */
function frontendRejects(key: string): boolean {
  return validateEnvVars([{ key, value: 'x' }]).errors.some((e) => e.code === 'ENV_NAME_RESERVED');
}

/** 后端是否拦下这个名字（精确名 + 前缀，与 `isReservedEnvName` 同一口径）。 */
function backendRejects(key: string, exact: readonly string[], prefixes: readonly string[]) {
  return exact.includes(key) || prefixes.some((p) => key.startsWith(p));
}

/**
 * 从后端源文件里抠出一个 `export const X: readonly string[] = [...]` 的字符串字面量。
 *
 * ⚠️ 解析不出来 ⇒ **抛异常**，不是返回空数组。后端把这个 const 改名/换写法时，
 * 静默返回 `[]` 会让「后端每一项前端都拦住了」这句话空洞地成立（空集恒被包含）——
 * 那正是这份用例要防的"假绿"。
 */
function parseBackendList(source: string, exportName: string): string[] {
  const decl = new RegExp(String.raw`export const ${exportName}\b[^=]*=\s*\[([^\]]*)\]`, 'u').exec(
    source,
  );
  if (decl === null) {
    throw new Error(
      `后端 reserved-env.ts 里找不到 \`export const ${exportName} = [...]\`。` +
        '要么它被改名/改写法了（本用例的解析要跟着改），要么这张表被挪走了 —— ' +
        '两种情况都必须有人看一眼，⛔ 不许静默当成空表。',
    );
  }
  // 行注释里出现引号会污染取值，先剥掉。
  const body = (decl[1] ?? '').replace(/\/\/[^\n]*/gu, '');
  const names = [...body.matchAll(/'([^']*)'/gu)].map((m) => m[1] ?? '');
  if (names.length === 0) {
    throw new Error(`后端 ${exportName} 解析出 0 项 —— 解析失效或表被清空，两种都不该静默通过。`);
  }
  return names;
}

// ——————————————————————————————————————————————————————————————————————
// 第一层 · 逐条对账（只有 ../api 在盘上时才跑；web 仓自己的 CI 里 skip）
// ——————————————————————————————————————————————————————————————————————
describe.skipIf(!BACKEND_AVAILABLE)('保留名黑名单 ↔ 后端逐条对账（05 §4.1 唯一权威）', () => {
  const source = BACKEND_AVAILABLE ? readFileSync(BACKEND_RESERVED_ENV_FILE, 'utf8') : '';
  const backendExact = BACKEND_AVAILABLE ? parseBackendList(source, 'RESERVED_ENV_EXACT') : [];
  const backendPrefixes = BACKEND_AVAILABLE
    ? parseBackendList(source, 'RESERVED_ENV_PREFIXES')
    : [];

  it('后端拦的每一个名字，前端都拦（⛔ 少一个 = 前端说 OK、后端拒绝）', () => {
    const escaped = backendExact.filter((key) => !frontendRejects(key));
    expect(escaped).toEqual([]);
  });

  it('后端的每一条前缀，前端都有（前缀漏一条 = 漏掉一整族名字）', () => {
    expect([...RESERVED_ENV_PREFIXES].sort()).toEqual(
      expect.arrayContaining([...backendPrefixes].sort()),
    );
  });

  it('前端不多拦后端放行的名字（更严格在安全上无害，但会拦下一个合法变量）', () => {
    const overreach = RESERVED_ENV_KEYS.filter(
      (key) => !backendRejects(key, backendExact, backendPrefixes),
    );
    expect(overreach).toEqual([]);
  });

  it('镜像快照仍与后端源文件一致（快照过期 ⇒ 第二层的 CI 兜底会跟着失真）', () => {
    expect([...BACKEND_EXACT_SNAPSHOT].sort()).toEqual([...backendExact].sort());
    expect([...BACKEND_PREFIX_SNAPSHOT].sort()).toEqual([...backendPrefixes].sort());
  });
});

// ——————————————————————————————————————————————————————————————————————
// 第二层 · 镜像快照（每次都跑，含 web CI）：只抓前端侧回退，抓不到后端新增
// ——————————————————————————————————————————————————————————————————————
describe('保留名黑名单 ↔ 后端镜像快照（web CI 下限；⛔ 不覆盖后端新增）', () => {
  it('快照里的每一个名字，前端都拦', () => {
    const escaped = BACKEND_EXACT_SNAPSHOT.filter((key) => !frontendRejects(key));
    expect(escaped).toEqual([]);
  });

  it('快照里的每一条前缀，前端都有', () => {
    for (const prefix of BACKEND_PREFIX_SNAPSHOT) {
      expect(RESERVED_ENV_PREFIXES).toContain(prefix);
      // 前缀是**整体**拦截：拿一个该前缀下的任意名字过一遍真校验。
      expect(frontendRejects(`${prefix}SOMETHING_NEW`)).toBe(true);
    }
  });

  it('重定向类三项一个都不能少（05 §4.1 P1-2：不含密文，却能把 CLI 指向别的凭证目录）', () => {
    // 后端 `CREDENTIAL_REDIRECT_ENV_NAMES` 的同一组；`CODEX_HOME` 由 `CODEX_` 前缀覆盖。
    for (const key of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'HOME']) {
      expect(frontendRejects(key)).toBe(true);
    }
  });
});
