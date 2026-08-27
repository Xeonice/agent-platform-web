import { describe, it, expect } from 'vitest';
import {
  validateEnvVars,
  envValueByteLength,
  ENV_KEY_MAX,
  ENV_VALUE_MAX_BYTES,
  ENV_ROWS_MAX,
} from '@/lib/image/validateEnvVar';
import type { EnvVarPair, EnvVarErrorCode } from '@/types/image';

/** 只关心「第 index 行的 code 集合」时的取值器。 */
function codesAt(rows: readonly EnvVarPair[], index: number): EnvVarErrorCode[] {
  return validateEnvVars(rows)
    .errors.filter((e) => e.index === index)
    .map((e) => e.code);
}

function rowsOf(count: number): EnvVarPair[] {
  return Array.from({ length: count }, (_, i) => ({ key: `VAR_${String(i)}`, value: 'v' }));
}

describe('validateEnvVars · 变量名（F21-4 §7.1 ①②③④⑤⑥）', () => {
  it('① LOG_LEVEL 通过', () => {
    expect(validateEnvVars([{ key: 'LOG_LEVEL', value: 'info' }]).errors).toEqual([]);
  });

  it('② log_level **通过**——小写不报错，仅是惯例上推荐大写', () => {
    expect(validateEnvVars([{ key: 'log_level', value: 'info' }]).errors).toEqual([]);
  });

  it('③ 1ABC（数字开头）→ ENV_NAME_INVALID', () => {
    expect(codesAt([{ key: '1ABC', value: 'x' }], 0)).toEqual(['ENV_NAME_INVALID']);
  });

  it('④ A-B（含连字符）→ ENV_NAME_INVALID', () => {
    expect(codesAt([{ key: 'A-B', value: 'x' }], 0)).toEqual(['ENV_NAME_INVALID']);
  });

  it('⑤ OPENAI_API_KEY → ENV_NAME_RESERVED（黑名单，防绕过 Vault 塞明文 key）', () => {
    expect(codesAt([{ key: 'OPENAI_API_KEY', value: 'sk-x' }], 0)).toEqual(['ENV_NAME_RESERVED']);
    // P21-4 §10.6 全量清单里的系统保留名同档。
    expect(codesAt([{ key: 'PATH', value: '/bin' }], 0)).toEqual(['ENV_NAME_RESERVED']);
    expect(codesAt([{ key: 'KUBECONFIG', value: '/x' }], 0)).toEqual(['ENV_NAME_RESERVED']);
  });

  it('⑥ GIT_ANY / CODEX_ANY → ENV_NAME_RESERVED（前缀**整体**拦截，不是逐个枚举）', () => {
    expect(codesAt([{ key: 'GIT_ANY', value: 'x' }], 0)).toEqual(['ENV_NAME_RESERVED']);
    expect(codesAt([{ key: 'CODEX_ANY', value: 'x' }], 0)).toEqual(['ENV_NAME_RESERVED']);
    // 前缀之外的普通变量不受牵连。
    expect(validateEnvVars([{ key: 'GITHUB_REPO', value: 'x' }]).errors).toEqual([]);
  });

  it('刚点 [+ 添加变量] 的空行不报名字错（噪音），也不参与重复判定', () => {
    expect(
      validateEnvVars([
        { key: '', value: '' },
        { key: '', value: '' },
      ]).errors,
    ).toEqual([]);
  });
});

describe('validateEnvVars · 长度与条数（F21-4 §7.1 ⑦⑧⑨⑫）', () => {
  it('⑦ KEY 65 字符 → ENV_LIMIT_EXCEEDED；64 字符通过', () => {
    expect(ENV_KEY_MAX).toBe(64);
    expect(codesAt([{ key: 'K'.repeat(65), value: 'x' }], 0)).toEqual(['ENV_LIMIT_EXCEEDED']);
    expect(validateEnvVars([{ key: 'K'.repeat(64), value: 'x' }]).errors).toEqual([]);
  });

  it('⑧ VALUE 4097（ASCII）→ ENV_LIMIT_EXCEEDED；4096 通过', () => {
    expect(ENV_VALUE_MAX_BYTES).toBe(4096);
    expect(codesAt([{ key: 'V', value: 'a'.repeat(4097) }], 0)).toEqual(['ENV_LIMIT_EXCEEDED']);
    expect(validateEnvVars([{ key: 'V', value: 'a'.repeat(4096) }]).errors).toEqual([]);
  });

  it('⑨ 51 条 → ENV_LIMIT_EXCEEDED（整表级）；50 条通过，且 canAddRow 随之翻转', () => {
    expect(ENV_ROWS_MAX).toBe(50);
    const at50 = validateEnvVars(rowsOf(50));
    expect(at50.errors).toEqual([]);
    // 到顶 ⇒ [+ 添加变量] 置灰。
    expect(at50.canAddRow).toBe(false);
    expect(validateEnvVars(rowsOf(49)).canAddRow).toBe(true);

    const at51 = validateEnvVars(rowsOf(51));
    const tableErrors = at51.errors.filter((e) => e.field === 'rows');
    expect(tableErrors).toEqual([{ field: 'rows', code: 'ENV_LIMIT_EXCEEDED', path: 'env' }]);
  });

  it('⑫ VALUE 上限按**字节**：1366 个中文（4098 字节）→ ENV_LIMIT_EXCEEDED', () => {
    const cn = '中'.repeat(1366);
    // 这一行就是本条的全部要害：字符数合规、字节数超限。
    expect(cn).toHaveLength(1366);
    expect(envValueByteLength(cn)).toBe(4098);
    expect(codesAt([{ key: 'CN', value: cn }], 0)).toEqual(['ENV_LIMIT_EXCEEDED']);
    // 1365 个中文 = 4095 字节，压线通过。用 value.length 实现的话这两条会一起绿，掩盖 bug。
    expect(validateEnvVars([{ key: 'CN', value: '中'.repeat(1365) }]).errors).toEqual([]);
  });

  it('⑫ 计数器的分子也必须是字节数（UI 上写「N / 4096 字节」）', () => {
    const result = validateEnvVars([
      { key: 'A', value: 'abc' },
      { key: 'B', value: '中文' },
    ]);
    expect(result.valueByteCounts).toEqual([3, 6]);
  });
});

describe('validateEnvVars · 重复 KEY（F21-4 §7.1 ⑩⑪）', () => {
  it('⑩ 同名 KEY → **两行都**标 ENV_DUPLICATE_KEY（两行同时红边）', () => {
    const result = validateEnvVars([
      { key: 'DUP', value: '1' },
      { key: 'DUP', value: '2' },
    ]);
    const dup = result.errors.filter((e) => e.code === 'ENV_DUPLICATE_KEY');
    expect(dup.map((e) => e.index).sort()).toEqual([0, 1]);
    // path 与后端 details[].path 同形，便于 400 回来时用同一套定位。
    expect(dup.map((e) => e.path).sort()).toEqual(['env[0].key', 'env[1].key']);
  });

  it('⑩ 同名三行 → 三行都红，且首行只被标一次（不重复堆叠）', () => {
    const dup = validateEnvVars([
      { key: 'DUP', value: '1' },
      { key: 'DUP', value: '2' },
      { key: 'DUP', value: '3' },
    ]).errors.filter((e) => e.code === 'ENV_DUPLICATE_KEY');
    expect(dup.map((e) => e.index).sort()).toEqual([0, 1, 2]);
  });

  it('⑪ LOG_LEVEL 与 log_level 同表 → **不算重复**（重复判定大小写敏感）', () => {
    const result = validateEnvVars([
      { key: 'LOG_LEVEL', value: 'info' },
      { key: 'log_level', value: 'debug' },
    ]);
    expect(result.errors).toEqual([]);
  });
});
