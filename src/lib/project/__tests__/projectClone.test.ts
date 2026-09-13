import { describe, it, expect } from 'vitest';
import {
  isProjectReady,
  cloneProgressPercent,
  formatBytes,
  cloneFailureGuidance,
  cloneStageLabel,
} from '@/lib/project/projectClone';

describe('projectClone 派生（10 §7）', () => {
  it('isProjectReady 仅 cloneStatus=ready', () => {
    expect(isProjectReady({ cloneStatus: 'ready' })).toBe(true);
    expect(isProjectReady({ cloneStatus: 'cloning' })).toBe(false);
    expect(isProjectReady({ cloneStatus: 'failed' })).toBe(false);
  });

  it('cloneProgressPercent 优先 percent，其次**对象数**比值，否则 null', () => {
    expect(cloneProgressPercent({ phase: 'cloning', percent: 42 })).toBe(42);
    expect(cloneProgressPercent({ phase: 'cloning', percent: 150 })).toBe(100); // clamp
    // 兜底分母是 objectsTotal 而非 totalBytes——后者是幽灵字段，git clone 不报总字节数。
    expect(cloneProgressPercent({ phase: 'cloning', objectsDone: 50, objectsTotal: 200 })).toBe(25);
    expect(cloneProgressPercent({ phase: 'cloning' })).toBeNull();
    expect(cloneProgressPercent({ phase: 'cloning', objectsDone: 1, objectsTotal: 0 })).toBeNull();
    // 只有字节数、没有对象数 ⇒ 算不出百分比（走 indeterminate），不能瞎猜一个分母。
    expect(cloneProgressPercent({ phase: 'cloning', receivedBytes: 999 })).toBeNull();
  });

  it('formatBytes 人类可读', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 3)).toBe('3.0 MB');
  });

  it('cloneFailureGuidance 分支：PERMISSION 需凭证不可重试、NETWORK/TIMEOUT/INTERRUPTED 可重试', () => {
    const perm = cloneFailureGuidance('CLONE_FAILED_PERMISSION');
    expect(perm.canRetry).toBe(false);
    expect(perm.needsCredentials).toBe(true);

    for (const code of ['CLONE_FAILED_NETWORK', 'TIMEOUT', 'INTERRUPTED']) {
      const g = cloneFailureGuidance(code);
      expect(g.canRetry).toBe(true);
      expect(g.needsCredentials).toBe(false);
    }

    // 未知码 → 通用重试
    const unknown = cloneFailureGuidance('WHATEVER');
    expect(unknown.canRetry).toBe(true);
  });

  /**
   * ★ **「重试克隆」≠「重新创建」。**
   *
   * 旧文案让用户「清理磁盘后**重新创建**」，而失败的那个项目还在、还占着 50 个名额之一 ——
   * 照做只会多出一个项目。这条用例钉的就是这句话不许再回去：把 `重新创建` 写回文案里
   * 这一条立刻红。
   */
  it('⭐ DISK_INSUFFICIENT：说的是「在这个项目上重试克隆」，⛔ 不是「重新创建」', () => {
    const g = cloneFailureGuidance('DISK_INSUFFICIENT');
    expect(g.message).toContain('磁盘');
    expect(g.message).toContain('重试克隆');
    expect(g.message).not.toContain('重新创建');
    // 清完盘之后 retry-clone 是有效的 ⇒ 按钮必须在（信封里的 `retryable:false` 说的是
    // 「原样再发一次会不会成功」，与「用户处理完之后能不能再来」不是同一个问题）。
    expect(g.canRetry).toBe(true);
    expect(g.needsCredentials).toBe(false);
  });

  /**
   * ★ **404 不许说成「没权限」。**
   *
   * 远端对「私有仓没配凭证」和「地址写错了」回的是同一个 404（故意的，回 403 等于承认
   * 私有仓存在），所以后端只能发 `CLONE_FAILED_NOT_FOUND`。这条用例钉住三件事：
   *   ① 不断言"没有权限"（那对打错地址的人是假的）；
   *   ② 两种可能都点名；
   *   ③ **「删掉重建」这条出路写进句子里** —— 界面上没有这个按钮，只读条又明写不能改远端，
   *      不写进句子，用户就完全无路可走。
   */
  it('⭐ CLONE_FAILED_NOT_FOUND：两种可能都说、⛔ 不断言没权限，且给出「删掉重建」这条出路', () => {
    const g = cloneFailureGuidance('CLONE_FAILED_NOT_FOUND');
    expect(g.message).not.toContain('没有访问该仓库的权限');
    expect(g.message).toContain('凭证');
    expect(g.message).toContain('地址写错');
    expect(g.message).toContain('删掉这个项目');
    // 私有仓那一支要 [配置 Git 凭证]；重试同一个地址、同一份（缺席的）凭证没有意义。
    expect(g.needsCredentials).toBe(true);
    expect(g.canRetry).toBe(false);
  });

  it('PERMISSION 与 NOT_FOUND 是两句不同的话（合并回去这条就红）', () => {
    expect(cloneFailureGuidance('CLONE_FAILED_PERMISSION').message).not.toBe(
      cloneFailureGuidance('CLONE_FAILED_NOT_FOUND').message,
    );
  });

  /**
   * ★ 阶段序号 `（第 4/6 步）`：唯一在解释「进度条为什么 0→100 走好几遍」的东西。
   * git 每个阶段各自从 0 数到 100（`git-cloner.port.ts:58-63` 已记为已知未修），
   * 没有序号时那看起来就是"卡住了又重来"。
   */
  it('⭐ cloneStageLabel 带阶段序号（解释进度条会重来几遍），分母跟着阶段表走', () => {
    expect(cloneStageLabel('enumerating')).toBe('枚举远端对象（第 1/6 步）');
    expect(cloneStageLabel('receiving')).toBe('接收对象（第 4/6 步）');
    expect(cloneStageLabel('checkout')).toBe('检出文件（第 6/6 步）');
    expect(cloneStageLabel(undefined)).toBeUndefined();
  });
});
