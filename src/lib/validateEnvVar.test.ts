import { describe, it, expect } from 'vitest';
import { validateEnvVars } from '@/lib/validateEnvVar';

describe('validateEnvVars (07 §8.3.1)', () => {
  it('合法变量通过前端预检', () => {
    expect(validateEnvVars([{ key: 'LOG_LEVEL', value: 'debug' }])).toEqual([]);
  });

  it('非法变量名（数字开头）报 invalid-name', () => {
    const errors = validateEnvVars([{ key: '1BAD', value: 'x' }]);
    expect(errors).toContainEqual({ index: 0, field: 'key', code: 'invalid-name' });
  });

  it('保留变量名报 reserved', () => {
    const errors = validateEnvVars([{ key: 'ANTHROPIC_API_KEY', value: 'x' }]);
    expect(errors).toContainEqual({ index: 0, field: 'key', code: 'reserved' });
  });

  it('保留前缀（GIT_*/CODEX_*）报 reserved', () => {
    const errors = validateEnvVars([{ key: 'GIT_TOKEN', value: 'x' }]);
    expect(errors).toContainEqual({ index: 0, field: 'key', code: 'reserved' });
  });

  it('重复 KEY 两行同时标记', () => {
    const errors = validateEnvVars([
      { key: 'DUP', value: '1' },
      { key: 'DUP', value: '2' },
    ]);
    const dupes = errors.filter((e) => e.code === 'duplicate');
    expect(dupes).toHaveLength(2);
  });

  it('超长 KEY / VALUE 报 too-long', () => {
    const errors = validateEnvVars([{ key: 'K'.repeat(65), value: 'V'.repeat(4097) }]);
    expect(errors).toContainEqual({ index: 0, field: 'key', code: 'key-too-long' });
    expect(errors).toContainEqual({ index: 0, field: 'value', code: 'value-too-long' });
  });
});
