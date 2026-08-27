// 后端 400 的统一错误 envelope → 环境变量**逐行**红字（F21-4 §5/§7.1/§8.3，10 §6.8）。
// 零副作用、零网络、可单测。
//
// ⚠️ **这条路只读 `details[].code`，从不看顶层 `code`。**
// 四个 `ENV_*` 住在 `details[].code` 里，顶层恒为 `VALIDATION_FAILED`（后端
// `image-error.http.ts` 的 `EnvValidationError` 分支写死了）。拿 `ENV_DUPLICATE_KEY` 去查
// 顶层文案表**永远不命中**，而这种不命中**不会让任何测试变红**——它只是安静地少显示一行字。
// 所以两条路在代码里也必须是两个函数：顶层码走 `sandboxErrorCopy.describeSandboxError`，
// 逐行红字走这里。
//
// ⚠️ **认不出来的一律不吞**（F21-4 §7.1 ②③④）：未知 code、指向已删除行的 path、
// 以及 `details` 干脆缺席的情况，都要有出口。吞掉的表现是"后端拒了、界面一片安静"。
//
// 分层：lib 只能依赖 lib/type（07 §4.1），所以信封形状直接取生成物，**不经 services**
// （与 `lib/sandbox/sandboxErrorCopy.ts` 同一手法）。
import type { components } from '@/types/generated/openapi';
import type { EnvVarErrorCode, EnvVarValidationError } from '@/types/image';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/**
 * `details[]` 的一项。
 *
 * ⚠️ 生成物把它给成 `{ [key: string]: unknown }`（后端 openapi 里这一项是自由对象），
 * 所以**必须运行时收窄**，不能断言（14 §4 禁 `as`）。收窄用 `in`/`typeof`，与
 * `services/api/apiError.ts` 的 `isErrorEnvelope` 同一写法。
 */
export interface EnvErrorDetail {
  path?: string;
  code?: string;
  message: string;
}

function readDetail(entry: unknown): EnvErrorDetail | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const message = 'message' in entry && typeof entry.message === 'string' ? entry.message : '';
  const code = 'code' in entry && typeof entry.code === 'string' ? entry.code : undefined;
  const path = 'path' in entry && typeof entry.path === 'string' ? entry.path : undefined;
  if (message === '' && code === undefined && path === undefined) return null;
  return {
    message,
    ...(code === undefined ? {} : { code }),
    ...(path === undefined ? {} : { path }),
  };
}

/** `EnvVarEditor.view` 的 `ERROR_COPY` 认得的四个码——**只有**它们能进逐行红字。 */
const ROW_ERROR_CODES: readonly string[] = [
  'ENV_NAME_INVALID',
  'ENV_NAME_RESERVED',
  'ENV_LIMIT_EXCEEDED',
  'ENV_DUPLICATE_KEY',
];

function isRowErrorCode(code: string | undefined): code is EnvVarErrorCode {
  return code !== undefined && ROW_ERROR_CODES.includes(code);
}

/** `env[2].key` → `{ index: 2, field: 'key' }`；`env` → 整表级；其它 → 认不出。 */
const ROW_PATH_RE = /^env\[(\d+)\]\.(key|value)$/;

export interface MappedEnvErrors {
  /** 能归位到具体行的错误（view 按 `index`/`field` 标红）。 */
  rowErrors: EnvVarValidationError[];
  /**
   * **归不了位的那些**：未知 code、path 指向已经不存在的行、path 形状不认识、
   * 以及连对象形状都不对的项。调用方把它们连同 envelope 的 message 一起做整体提示——**不许丢**。
   */
  unmapped: EnvErrorDetail[];
  /**
   * 整体提示（用 envelope 自己的 message）。`details` 缺席/为空，或有归不了位的项时给出。
   * 后端拒了却一行都归不了位时，这句话是用户唯一能看到的东西。
   */
  generalMessage?: string;
}

/**
 * @param envelope 后端 400 的统一错误信封。
 * @param rowCount 当前草稿的行数——`path` 指向 ≥ 这个数的下标说明那一行已经被删了，
 *                 归位会归到一行不存在的位置上（或者更糟：归到别人身上）。
 */
export function mapEnvErrorResponse(
  envelope: Pick<ErrorEnvelope, 'message' | 'details'>,
  rowCount: number,
): MappedEnvErrors {
  const details = envelope.details ?? [];
  const withGeneral = envelope.message === '' ? {} : { generalMessage: envelope.message };

  if (details.length === 0) {
    // ④ `details` 缺失/为空 ⇒ 退化为整体提示，**不静默吞掉**。
    return { rowErrors: [], unmapped: [], ...withGeneral };
  }

  const rowErrors: EnvVarValidationError[] = [];
  const unmapped: EnvErrorDetail[] = [];

  for (const entry of details) {
    const issue = readDetail(entry);
    if (issue === null) continue;
    // ⓪ 只认 `details[].code`。顶层 code 在这里连读都不读一下。
    if (!isRowErrorCode(issue.code)) {
      unmapped.push(issue);
      continue;
    }
    const code: EnvVarErrorCode = issue.code;
    const path = issue.path ?? '';
    if (path === 'env') {
      // 整表级（条数超限）：没有行号，`field: 'rows'`，与前端预检同形。
      rowErrors.push({ field: 'rows', code, path });
      continue;
    }
    const match = ROW_PATH_RE.exec(path);
    const rawIndex = match?.[1];
    const rawField = match?.[2];
    if (rawIndex === undefined || rawField === undefined) {
      unmapped.push(issue);
      continue;
    }
    const index = Number(rawIndex);
    // ③ 指向已删除的行：**忽略但不崩**，而且要在整体提示里露头（进 unmapped）。
    if (index >= rowCount) {
      unmapped.push(issue);
      continue;
    }
    rowErrors.push({ index, field: rawField === 'key' ? 'key' : 'value', code, path });
  }

  return { rowErrors, unmapped, ...(unmapped.length > 0 ? withGeneral : {}) };
}
