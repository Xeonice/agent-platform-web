// 环境变量前端即时提示的纯函数（07 §8.3.1）。校验是逻辑 → 放 lib，view 只渲染 errors。
// 纪律：黑名单/正则的清单常量应从 contract/生成类型取；脚手架期先内置占位，后端清单落地后替换。

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEY_MAX = 64;
const VALUE_MAX = 4096;

/** 保留变量名（占位；权威清单见 P21-4 §10.6，后端下发后替换）。 */
export const RESERVED_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'OPENAI_API_KEY',
];
const RESERVED_PREFIXES: readonly string[] = ['CODEX_', 'GIT_'];

export interface EnvVarRow {
  key: string;
  value: string;
}
export type EnvVarErrorCode =
  'invalid-name' | 'reserved' | 'key-too-long' | 'value-too-long' | 'duplicate';

export interface EnvVarError {
  index: number;
  field: 'key' | 'value';
  code: EnvVarErrorCode;
}

function isReserved(key: string): boolean {
  if (RESERVED_ENV_KEYS.includes(key)) return true;
  return RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** 返回所有违规项；前端提示永不放宽后端（07 §8.3.1 纪律③）。空数组即通过前端预检。 */
export function validateEnvVars(rows: EnvVarRow[]): EnvVarError[] {
  const errors: EnvVarError[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    if (row.key.length > KEY_MAX) errors.push({ index, field: 'key', code: 'key-too-long' });
    if (row.value.length > VALUE_MAX)
      errors.push({ index, field: 'value', code: 'value-too-long' });
    if (row.key.length > 0 && !ENV_KEY_RE.test(row.key))
      errors.push({ index, field: 'key', code: 'invalid-name' });
    else if (isReserved(row.key)) errors.push({ index, field: 'key', code: 'reserved' });

    const prev = seen.get(row.key);
    if (row.key.length > 0 && prev !== undefined) {
      errors.push({ index, field: 'key', code: 'duplicate' });
      errors.push({ index: prev, field: 'key', code: 'duplicate' });
    } else if (row.key.length > 0) {
      seen.set(row.key, index);
    }
  });

  return errors;
}
