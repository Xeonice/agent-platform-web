import { describe, it, expect } from 'vitest';
import { installSubCopy } from '@/lib/sandbox/runtimeInstallProgress';

describe('runtime.install_progress → 进度卡子文案（15 §2.3 / P22 §1）', () => {
  it('无进度 → 无子文案（进度卡照常渲染四格）', () => {
    expect(installSubCopy(undefined)).toBeUndefined();
  });

  it('installing → 明确写出"可能十几分钟、不是卡死"（实测 753s，没有这句就像卡死）', () => {
    const text = installSubCopy({ runtime: 'claude-code', status: 'installing' });
    expect(text).toContain('claude-code');
    expect(text).toContain('正在安装');
    expect(text).toContain('不是卡死');
  });

  it('not_installed → 预告即将安装；installed → 带上探测到的版本', () => {
    expect(installSubCopy({ runtime: 'codex', status: 'not_installed' })).toContain('准备安装');
    expect(
      installSubCopy({ runtime: 'codex', status: 'installed', versionDetected: '1.2.3' }),
    ).toContain('1.2.3');
    expect(installSubCopy({ runtime: 'codex', status: 'installed' })).toBe('codex CLI 已就绪');
  });

  it('failed 刻意不出子文案：权威是紧随其后的 sandbox.status_changed → failed（10 §3.1）', () => {
    expect(installSubCopy({ runtime: 'codex', status: 'failed' })).toBeUndefined();
  });
});
