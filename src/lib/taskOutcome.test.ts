// 无头 Task 终态文案（纯函数）。本文件钉死两条硬要求：
//  ① **exitCode 缺席 → 按非零退出处理**，且展示文本永远不是 'undefined'；
//  ② 错误**按码渲染人话**（P22 §1 禁止裸抛码）；未收录的码由**各调用点按自己的语境**兜底——
//     词表本身返回 undefined，因为"发起失败 / 终止失败 / 任务结束"是三件事。
//  ③ 词表里的码必须是**后端真会发的那些**（S6 review ⑦：老词表与后端零重叠，最常走的路 100% 失效）。
import { describe, it, expect } from 'vitest';
import {
  describeTaskChannelErrorCode,
  describeDownloadProgress,
  describeTaskDeadline,
  describeTaskErrorCode,
  describeTaskOutcome,
  formatArtifactSize,
} from '@/lib/taskOutcome';
import type { TaskErrorCode } from '@/types/task';

describe('describeTaskOutcome · exitCode 缺席', () => {
  it('缺席 ⇒ tone=failed（按非零退出处理），且退出码文本不含 undefined', () => {
    const copy = describeTaskOutcome({ exit: { status: 'killed' } });

    expect(copy.exitCodeMissing).toBe(true);
    expect(copy.tone).toBe('failed');
    expect(copy.exitCodeLabel).not.toContain('undefined');
    expect(copy.exitCodeLabel).toContain('未知');
    // 必须解释"为什么没有退出码"，否则用户会以为前端丢了字段。
    expect(copy.advice).toContain('信号');
  });

  it('即便后端报 succeeded，缺 exitCode 仍按非零退出处理（不假装成功）', () => {
    const copy = describeTaskOutcome({ exit: { status: 'succeeded' } });
    expect(copy.tone).toBe('failed');
    expect(copy.exitCodeMissing).toBe(true);
  });

  it('超时终态：缺席退出码 + 超时码 ⇒ 两段说明都在', () => {
    const copy = describeTaskOutcome({
      exit: { status: 'timed_out' },
      // ⚠️ 后端发的是 TASK_TIMED_OUT（`'TASK_' + status.toUpperCase()`）。
      // 老词表写的是 TASK_TIMEOUT（少了 _ED）⇒ 真实的超时终态 100% 落进兜底句。
      errorCode: 'TASK_TIMED_OUT',
    });
    expect(copy.title).toContain('超时');
    expect(copy.advice).toContain('超时上限');
    expect(copy.advice).toContain('信号');
    expect(copy.diagnosticCode).toBe('TASK_TIMED_OUT');
  });
});

describe('后端真会发的那组码都有人话（S6 review ⑦）', () => {
  // 取值来自 run-agent-task.workflow.ts：正常终态一路是 `'TASK_' + status.toUpperCase()`，
  // 外加 workflow 单独发的 SANDBOX_GONE。少一个都会让用户在最常走的那条路上看到兜底句。
  it.each([
    ['TASK_FAILED', '失败'],
    ['TASK_KILLED', '终止'],
    ['TASK_TIMED_OUT', '超时'],
    ['SANDBOX_GONE', '沙箱'],
    ['RESUME_FAILED', '重启'],
  ])('%s ⇒ 有针对性的人话（不是兜底句）', (code, keyword) => {
    const copy = describeTaskErrorCode(code);
    expect(copy).toBeDefined();
    expect(copy).toContain(keyword);
    expect(copy).not.toContain('暂未收录');
  });

  it('用户自己点的「终止」拿到的是"被终止"，不是"以一个平台暂未收录的原因结束"', () => {
    const copy = describeTaskOutcome({ exit: { status: 'killed' }, errorCode: 'TASK_KILLED' });
    expect(copy.advice).not.toContain('暂未收录');
    expect(copy.advice).toContain('终止');
  });
});

describe('describeTaskOutcome · 正常终态', () => {
  it('succeeded + exitCode 0 ⇒ 唯一的成功调性', () => {
    const copy = describeTaskOutcome({ exit: { status: 'succeeded', exitCode: 0 } });
    expect(copy.tone).toBe('success');
    expect(copy.exitCodeLabel).toBe('0');
    expect(copy.exitCodeMissing).toBe(false);
    expect(copy.diagnosticCode).toBeUndefined();
  });

  it('failed + 非零退出码 ⇒ 失败调性并把退出码说清楚', () => {
    const copy = describeTaskOutcome({ exit: { status: 'failed', exitCode: 137 } });
    expect(copy.tone).toBe('failed');
    expect(copy.exitCodeLabel).toBe('137');
    expect(copy.advice).toContain('137');
  });
});

describe('describeTaskErrorCode · 码 → 人话', () => {
  it('收录的码给人话', () => {
    expect(describeTaskErrorCode('UNSUPPORTED_CAPABILITY')).toContain('headlessTask');
  });

  it('未收录的码 ⇒ undefined：兜底交给调用点的语境，不由词表代劳', () => {
    // 老实现对任何非空码都返回句子，于是三处调用点写好的 `?? 兜底` 全成了死代码：
    // 通道级 NOT_FOUND 被渲染成"任务以一个…原因**结束**"（任务根本没结束），
    // 发起失败时后端那句具体的话（INVALID_STATE: sandbox X was provisioned for…）被丢弃。
    expect(describeTaskErrorCode('SOME_NEW_CODE')).toBeUndefined();
    expect(describeTaskErrorCode('INVALID_STATE')).toBeUndefined();
  });

  it('但"任务确实结束了"这个语境仍有兜底句 + 诊断码（P22 §1 不裸抛码）', () => {
    const copy = describeTaskOutcome({
      exit: { status: 'failed', exitCode: 1 },
      errorCode: 'SOME_NEW_CODE',
    });
    expect(copy.advice).toContain('暂未收录');
    expect(copy.advice).not.toContain('SOME_NEW_CODE');
    expect(copy.diagnosticCode).toBe('SOME_NEW_CODE');
  });

  it('通道级码走**通道自己的**词表：通道报错 ≠ 任务结束', () => {
    expect(describeTaskChannelErrorCode('NOT_FOUND')).toContain('事件通道');
    expect(describeTaskChannelErrorCode('REPLAY_FAILED')).toContain('回放');
    expect(describeTaskChannelErrorCode('NOT_FOUND')).not.toContain('结束');
    // 后端把未授权/协议不匹配改成 error 帧之后，接收侧已经接得住（见 taskSocket.ts 头注释）。
    expect(describeTaskChannelErrorCode('UNAUTHORIZED')).toContain('解锁');
    expect(describeTaskChannelErrorCode('SCHEMA_MISMATCH')).toContain('刷新');
    expect(describeTaskChannelErrorCode('SOME_NEW_CODE')).toBeUndefined();
  });

  /**
   * **穷举决策表** —— 后端每加一个错误码，这张 `Record<TaskErrorCode, …>` 就缺一个 key，
   * **tsc 当场红**，逼着做一次显式决策：给它写人话，还是放行后端 message。
   *
   * 生产侧的词表用的是 `satisfies Partial<Record<…>>`（多写/拼错一个当场红，但不强制覆盖全部），
   * 少覆盖的那个方向就由这张表兜住。两者合起来 = 完整 `Record` 的严格度，
   * 又不牺牲"某些码刻意让后端句子透出来"的设计。
   *
   *  · `'copy'`            —— 码本身就说清了发生什么、用户据此能行动 ⇒ 前端给人话；
   *  · `'backend-message'` —— 必须由后端 message 指名道姓才有意义 ⇒ 前端**不收录**，
   *                          让 useTaskErrorMessage 把后端那句话透出来。
   */
  const DECISIONS: Record<TaskErrorCode, 'copy' | 'backend-message'> = {
    TASK_FAILED: 'copy',
    TASK_KILLED: 'copy',
    TASK_TIMED_OUT: 'copy',
    SANDBOX_GONE: 'copy',
    RESUME_FAILED: 'copy',
    IMAGE_PULL_FAILED: 'copy',
    RESOURCE_EXHAUSTED: 'copy',
    TIMEOUT: 'copy',
    PROVIDER_UNAVAILABLE: 'copy',
    UNSUPPORTED_CAPABILITY: 'copy',
    INTERNAL: 'copy',
    // 这四个的后端 message 会指名道姓（"sandbox X was provisioned for runtime 'codex'…"），
    // 套模板等于把唯一有用的信息盖掉。
    NOT_FOUND: 'backend-message',
    ALREADY_EXISTS: 'backend-message',
    PERMISSION_DENIED: 'backend-message',
    INVALID_STATE: 'backend-message',
  };

  it('每个后端码都做过显式决策，且决策与词表一致（后端加码 ⇒ 上面的 Record 缺 key ⇒ tsc 红）', () => {
    for (const [code, decision] of Object.entries(DECISIONS)) {
      const copy = describeTaskErrorCode(code);
      if (decision === 'copy') {
        expect(copy, `${code} 决策是 copy，词表里却没有`).toBeDefined();
      } else {
        expect(copy, `${code} 决策是放行后端 message，词表却收录了它`).toBeUndefined();
      }
    }
  });

  it('词表里没有闭集之外的死条目（TASK_TIMEOUT / AUTH_REQUIRED 那一类）', () => {
    // 生产侧的 `satisfies Partial<Record<TaskErrorCode, string>>` 已经在编译期封死了这个方向；
    // 这里再从运行时确认一遍那三条被删掉的死条目确实不在了。
    for (const dead of ['TASK_TIMEOUT', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'INSTALL_FAILED']) {
      expect(describeTaskErrorCode(dead), `${dead} 不在后端闭集里，不该有终态文案`).toBeUndefined();
    }
  });

  it('无码 ⇒ undefined（调用方据此不渲染错误段）', () => {
    expect(describeTaskErrorCode(undefined)).toBeUndefined();
    expect(describeTaskErrorCode('')).toBeUndefined();
  });
});

describe('formatArtifactSize', () => {
  it('按二进制进位给可读体积', () => {
    expect(formatArtifactSize(0)).toBe('0 B');
    expect(formatArtifactSize(2048)).toBe('2.0 KB');
    expect(formatArtifactSize(131072)).toBe('128.0 KB');
    expect(formatArtifactSize(1024 * 1024 * 3)).toBe('3.0 MB');
  });

  it('异常值不炸（给占位符而不是 NaN）', () => {
    expect(formatArtifactSize(Number.NaN)).toBe('—');
    expect(formatArtifactSize(-1)).toBe('—');
  });
});

describe('describeTaskDeadline · 硬超时倒计时', () => {
  const startedAt = '2026-08-22T00:00:00.000Z';
  const at = (iso: string): number => Date.parse(iso);

  it('剩余量按"还剩多久"给（不是"已经跑了多久"）', () => {
    const view = describeTaskDeadline({
      startedAt,
      timeoutMinutes: 120,
      now: at('2026-08-22T00:30:00.000Z'),
    });
    expect(view?.label).toBe('还剩 1 小时 30 分');
    expect(view?.overdue).toBe(false);
  });

  it('不足一小时给"分 秒"，不足一分钟给"秒"', () => {
    expect(
      describeTaskDeadline({ startedAt, timeoutMinutes: 30, now: at('2026-08-22T00:28:30.000Z') })
        ?.label,
    ).toBe('还剩 1 分 30 秒');
    expect(
      describeTaskDeadline({ startedAt, timeoutMinutes: 30, now: at('2026-08-22T00:29:50.000Z') })
        ?.label,
    ).toBe('还剩 10 秒');
  });

  it('超预算 ⇒ overdue + 说明强杀在路上（**不显示负数**）', () => {
    const view = describeTaskDeadline({
      startedAt,
      timeoutMinutes: 30,
      now: at('2026-08-22T02:00:00.000Z'),
    });
    expect(view?.overdue).toBe(true);
    expect(view?.label).toContain('已超过硬超时预算');
    expect(view?.label).not.toContain('-');
  });

  it('startedAt 不可解析 ⇒ null（不渲染一个 NaN 倒计时）', () => {
    expect(describeTaskDeadline({ startedAt: '', timeoutMinutes: 30, now: 0 })).toBeNull();
  });
});

describe('describeDownloadProgress（产物流式落盘的进度文案）', () => {
  it('有 content-length ⇒ 已下载 / 总量 + 百分比', () => {
    expect(
      describeDownloadProgress({ receivedBytes: 512 * 1024, totalBytes: 2 * 1024 * 1024 }),
    ).toBe('已下载 512.0 KB / 2.0 MB（25%）');
  });

  it('⚠️ 没有 content-length ⇒ **只报已下载多少，绝不猜百分比**（猜出来的进度条是在骗人）', () => {
    const label = describeDownloadProgress({ receivedBytes: 3 * 1024 * 1024 });
    expect(label).toBe('已下载 3.0 MB');
    expect(label).not.toContain('%');
    expect(label).not.toContain('NaN');
    expect(label).not.toContain('Infinity');
  });

  it('totalBytes 为 0 / 负数（后端给了个没意义的值）同样退化成"只报已下载"', () => {
    expect(describeDownloadProgress({ receivedBytes: 1024, totalBytes: 0 })).toBe('已下载 1.0 KB');
    expect(describeDownloadProgress({ receivedBytes: 1024, totalBytes: -5 })).toBe('已下载 1.0 KB');
  });

  it('压缩传输时收到的字节可能超过 content-length ⇒ 百分比夹在 100（不显示 137%）', () => {
    expect(describeDownloadProgress({ receivedBytes: 4096, totalBytes: 1024 })).toContain(
      '（100%）',
    );
  });
});
