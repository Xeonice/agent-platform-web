// 镜像运行参数 · 环境变量前端预检（P21-4 §10.4/§10.6，F21-4 §5/§7.1）。零副作用、零网络、可单测。
//
// 它落在 `lib/image/` 而不是 `lib/_shared/`：07 §2.0 的判据只有一条——**删掉镜像管理，它还该留下吗**。
// 不该，所以进 `image/`（F21-4 §3）。
//
// 为什么必须是纯函数：`EnvVarEditor.view` 被 boundaries 禁止 import `lib/`，
// 校验只能在 hook 层跑完，view 接 `errors` prop 渲染（F21-4 §3.1 规则 1）。
//
// 四个错误码**与后端同名**（F21-4 §5）：前端提示与后端拒绝永远是同一句话，
// 单测也因此可以断言错误码而不是断言文案。
// ⚠️ 它们住在统一错误 envelope 的 `details[].code` 里；顶层 `code` 恒为 `VALIDATION_FAILED`，
// 拿这四个码去查顶层文案表**永远不命中**（F21-4 §8.3）。
//
// ⚠️ 本文件**不实现** P21-4 §10.6 里那条「禁止 shell 元字符」：四码契约（F21-4 §5 表）没有给它码，
// 前端凭空造第五个码 = 造一句后端不会说的话。那条留在后端。

import type { EnvVarPair, EnvVarValidationError, EnvVarValidationResult } from '@/types/image';

/** 变量名正则（P21-4 §10.4/§10.6 同源）。小写合法——只是惯例上推荐大写。 */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** KEY ≤64 字符。正则限死了 ASCII，所以字节数恒等于字符数，这里不用再走 TextEncoder。 */
export const ENV_KEY_MAX = 64;

/**
 * VALUE ≤4096 **字节**（UTF-8），不是 4096 字符（P21-4 §10.4/§10.6，10 §6.8）。
 * ⚠️ 写成 `value.length` 的话，一个全中文的值在 1366 字左右就会被后端拒掉，
 * 而前端计数器还显示「1366 / 4096」——正是本页反复要避免的「前端说 OK、后端换个说法拒绝」。
 */
export const ENV_VALUE_MAX_BYTES = 4096;

/** 每镜像 ≤50 条。 */
export const ENV_ROWS_MAX = 50;

/**
 * 保留变量名（P21-4 §10.6 全量 + §10.4 前缀规则；技术 05 §4.1 为唯一权威）。
 * 防的是「绕过 Vault 用明文塞 key」，以及踩坏容器自身的 `PATH`/`HOME` 之类。
 *
 * ⚠️ **这是后端 `shared-kernel/src/domain/reserved-env.ts` 的镜像，不是一份独立主张。**
 * 抄漏一项的后果不是"前端宽松一点"，而是本文件开头那句话的反面：前端说 OK、后端拒绝。
 * 对账用例见 `__tests__/reservedEnvReconcile.test.ts`（它也写明了自己抓不到什么）。
 *
 * 多出来的四项（`GIT_PRIVATE_KEY` / 三个 `CODEX_*`）不是漂移：后端靠 `GIT_` / `CODEX_`
 * **前缀**整体覆盖它们，两边的拦截结论一致，这里只是把最常被输入的几个写成明名。
 */
export const RESERVED_ENV_KEYS: readonly string[] = [
  // —— 凭证变量名本身 ——
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_CLIENT_ID',
  'CODEX_CLIENT_SECRET',
  'GIT_PRIVATE_KEY',
  'SSH_PRIVATE_KEY',
  // —— 重定向类（05 §4.1 P1-2）：本身不含密文，却能把 CLI 指向另一个凭证目录 ——
  // ⚠️ `CLAUDE_CONFIG_DIR` 曾经**只在后端有**：用户在 env 编辑器里输入它，前端一路绿灯、
  //    提交时被后端 `ENV_NAME_RESERVED` 拒掉。它和 `CODEX_HOME`（被 `CODEX_` 前缀覆盖）、
  //    `HOME` 是同一类——旁路凭证注入，不是"看起来吓人"的普通变量。
  'CLAUDE_CONFIG_DIR',
  'HOME',
  // —— 容器/基础设施自身 ——
  'KUBECONFIG',
  'USER',
  'PATH',
  'PWD',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
];

/** 前缀**整体**拦截（P21-4 §10.4）：`GIT_ANY` / `CODEX_ANY` 一律保留。 */
export const RESERVED_ENV_PREFIXES: readonly string[] = ['CODEX_', 'GIT_'];

/** VALUE 的**字节**数（计数器上的分子；UI 单位也要写「字节」）。 */
export function envValueByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * 保留名判定**大小写敏感**——与重复判定同一口径：既然小写是合法的独立变量名，
 * `path` 就不是 `PATH`（POSIX 环境变量本来就区分大小写，注入进容器的也是两个不同的变量）。
 */
function isReserved(key: string): boolean {
  if (RESERVED_ENV_KEYS.includes(key)) return true;
  return RESERVED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 与后端 `details[].path` 同形。 */
function rowPath(index: number, field: 'key' | 'value'): string {
  return `env[${String(index)}].${field}`;
}

/**
 * 逐行预检 + 整表条数检查。空数组即通过。
 *
 * ⚠️ **KEY 为空串的行不报名字类错误**：那是用户刚点 [+ 添加变量] 还没填的行，
 * 一进来就红是噪音。空 KEY 也不参与重复判定。能不能提交由 container 另行把关。
 */
export function validateEnvVars(rows: readonly EnvVarPair[]): EnvVarValidationResult {
  const errors: EnvVarValidationError[] = [];
  const valueByteCounts: number[] = [];
  /** KEY → 首次出现的行下标；**大小写敏感**，`LOG_LEVEL` 与 `log_level` 是两个变量，不算重复。 */
  const firstSeenAt = new Map<string, number>();
  /** 已经为「首次出现的那一行」补过标记，避免同名三行时首行被标多次。 */
  const markedFirst = new Set<string>();

  rows.forEach((row, index) => {
    const bytes = envValueByteLength(row.value);
    valueByteCounts.push(bytes);

    if (bytes > ENV_VALUE_MAX_BYTES) {
      errors.push({
        index,
        field: 'value',
        code: 'ENV_LIMIT_EXCEEDED',
        path: rowPath(index, 'value'),
      });
    }

    if (row.key === '') return;

    if (row.key.length > ENV_KEY_MAX) {
      errors.push({ index, field: 'key', code: 'ENV_LIMIT_EXCEEDED', path: rowPath(index, 'key') });
    }

    if (!ENV_KEY_RE.test(row.key)) {
      errors.push({ index, field: 'key', code: 'ENV_NAME_INVALID', path: rowPath(index, 'key') });
    } else if (isReserved(row.key)) {
      errors.push({ index, field: 'key', code: 'ENV_NAME_RESERVED', path: rowPath(index, 'key') });
    }

    const first = firstSeenAt.get(row.key);
    if (first === undefined) {
      firstSeenAt.set(row.key, index);
      return;
    }
    // 重复：**两行同时标红**（P21-4 §10 / F21-4 §5「两行同时红边」）。
    errors.push({
      index,
      field: 'key',
      code: 'ENV_DUPLICATE_KEY',
      path: rowPath(index, 'key'),
    });
    if (!markedFirst.has(row.key)) {
      markedFirst.add(row.key);
      errors.push({
        index: first,
        field: 'key',
        code: 'ENV_DUPLICATE_KEY',
        path: rowPath(first, 'key'),
      });
    }
  });

  if (rows.length > ENV_ROWS_MAX) {
    // 整表级：没有具体行号，`path` 退化为 `env`（后端同形）。
    errors.push({ field: 'rows', code: 'ENV_LIMIT_EXCEEDED', path: 'env' });
  }

  return {
    errors,
    canAddRow: rows.length < ENV_ROWS_MAX,
    valueByteCounts,
  };
}
