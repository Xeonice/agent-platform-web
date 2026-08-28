// `lib/audit/auditRowModel.ts` 单测（F21-5 §7.1）。
//
// ⚠️ 时间用**本地时区构造**（`new Date(y, m, d, …)` 而不是 `'…Z'` 字面量）：
// 断言的是本地时钟串，写死 UTC 字面量的话这些用例只在 UTC 机器上绿。
import { describe, it, expect } from 'vitest';
import {
  auditRowModel,
  formatActor,
  formatAuditTime,
  formatDetail,
  formatDurationMs,
  SANDBOX_TIMELINE_LABEL,
} from '@/lib/audit/auditRowModel';
import type { AuditEventDto } from '@/types/audit';

const NOW = new Date(2026, 7, 26, 20, 0, 0, 0).getTime();

function event(overrides: Partial<AuditEventDto> = {}): AuditEventDto {
  return {
    seq: 1,
    at: new Date(2026, 7, 26, 13, 45, 30, 123).toISOString(),
    category: 'sandbox',
    type: 'sandbox.provision.stage',
    severity: 'info',
    actor: 'system',
    summary: '沙箱 sb-1 进入 workspace 阶段',
    ...overrides,
  };
}

describe('formatDurationMs —— 缺失值不产出字段（而不是产出占位符）', () => {
  it('4231 → 4.2s', () => {
    expect(formatDurationMs(4231)).toBe('4.2s');
  });

  it('undefined → undefined（占位符属 view 决定，model 不产出 —— 28 §5 / F21-5 §8）', () => {
    expect(formatDurationMs(undefined)).toBeUndefined();
    expect(formatDurationMs(undefined)).not.toBe('—');
  });

  it('0 → "0ms"，不是 undefined —— `if (!ms)` 会把一次真实的 0ms 抹成「没有耗时」', () => {
    expect(formatDurationMs(0)).toBe('0ms');
  });

  it('秒以下用 ms，分钟以上拆 m/s', () => {
    expect(formatDurationMs(850)).toBe('850ms');
    expect(formatDurationMs(999)).toBe('999ms');
    expect(formatDurationMs(1000)).toBe('1.0s');
    expect(formatDurationMs(65_000)).toBe('1m 5s');
  });
});

describe('formatDetail —— detail 为空不产出 detailText（据此决定不给展开箭头）', () => {
  it('undefined → undefined', () => {
    expect(formatDetail(undefined)).toBeUndefined();
  });

  it('{} → undefined（空对象展开来是一片空白，比不给点更糟）', () => {
    expect(formatDetail({})).toBeUndefined();
  });

  it('有内容 → 缩进过的 JSON', () => {
    expect(formatDetail({ imageRef: 'docker.io/a:1' })).toBe('{\n  "imageRef": "docker.io/a:1"\n}');
  });
});

describe('formatAuditTime —— 毫秒精度必须留着', () => {
  it('同日 → HH:mm:ss.SSS', () => {
    const at = new Date(2026, 7, 26, 13, 45, 30, 123).toISOString();
    expect(formatAuditTime(at, NOW)).toBe('13:45:30.123');
  });

  it('毫秒不同的两条事件产出**不同**的 timeText（异常风暴下同一秒里有几十条）', () => {
    const a = formatAuditTime(new Date(2026, 7, 26, 13, 45, 30, 1).toISOString(), NOW);
    const b = formatAuditTime(new Date(2026, 7, 26, 13, 45, 30, 987).toISOString(), NOW);
    expect(a).toBe('13:45:30.001');
    expect(b).toBe('13:45:30.987');
    expect(a).not.toBe(b);
  });

  it('跨日 → 带 MM-DD 前缀', () => {
    const at = new Date(2026, 7, 25, 23, 59, 59, 999).toISOString();
    expect(formatAuditTime(at, NOW)).toBe('08-25 23:59:59.999');
  });

  it('非法时间 → 空串（不渲染 NaN）', () => {
    expect(formatAuditTime('not-a-date', NOW)).toBe('');
  });
});

describe('formatActor —— 开放集，认不出的原样透出', () => {
  it('后端实写的**六个** actor 都翻得出中文（`AUDIT_ACTORS = TRIGGERED_BY ∪ {system}`）', () => {
    // ⚠️ 逐个钉住而不是只测一个：此前名单里缺 `scheduler`（**最高频**的那个，
    //    provision workflow / runtime-install 5 个写入点都写它）、缺 `health-check`
    //    与 `provider-event`（状态流转透传），多出 `mcp` / `automation`（后端一处都不写）。
    //    翻不出的后果是每一行 actor 列直接显示英文键——界面不报错，只是"看着有点怪"。
    expect(formatActor('scheduler')).toBe('调度器');
    expect(formatActor('reaper')).toBe('回收器');
    expect(formatActor('user')).toBe('用户');
    expect(formatActor('health-check')).toBe('健康检查');
    expect(formatActor('provider-event')).toBe('Provider 事件');
    expect(formatActor('system')).toBe('系统');
  });

  it('⭐ 第三方 actor 原样返回（不穷举、不回落成「未知」、更不报错）', () => {
    // ⚠️ 这条守着 `?? actor` 兜底：后端 `AuditActorSchema` 是 `z.string().min(1)`，
    //    列上没有 CHECK —— 读那侧不能因为一个数据库允许的取值就崩掉或渲染空白。
    //    改成穷举 switch / `Record<AuditActor, string>` 之后，上一条照样全绿。
    expect(formatActor('some-third-party-agent')).toBe('some-third-party-agent');
    expect(formatActor('mcp')).toBe('mcp');
  });
});

describe('auditRowModel', () => {
  it('errorCode 独立成字段，**不拼进 summary**（与 10 §6.8 同一闭集）', () => {
    const model = auditRowModel(
      event({ severity: 'error', errorCode: 'PROVIDER_UNAVAILABLE', summary: '创建沙箱失败' }),
      NOW,
    );
    expect(model.errorCode).toBe('PROVIDER_UNAVAILABLE');
    expect(model.summary).toBe('创建沙箱失败');
    expect(model.summary).not.toContain('PROVIDER_UNAVAILABLE');
  });

  it('无耗时 / 无 detail 的事件：两个字段都**不存在**（不是 undefined 值，也不是占位符）', () => {
    const model = auditRowModel(event(), NOW);
    expect('durationText' in model).toBe(false);
    expect('detailText' in model).toBe(false);
  });

  it('沙箱事件给 [查看该沙箱完整时间线] 入口；非沙箱事件不给', () => {
    const sandbox = auditRowModel(event({ subjectType: 'sandbox', subjectId: 'sb-1' }), NOW);
    expect(sandbox.subjectLink).toEqual({ subjectId: 'sb-1', label: SANDBOX_TIMELINE_LABEL });

    const project = auditRowModel(
      event({ category: 'project', subjectType: 'project', subjectId: 'p-1' }),
      NOW,
    );
    expect('subjectLink' in project).toBe(false);
  });

  it('完整一行：时间 / 严重度 / summary / actor / 耗时 / outcome 全部到位', () => {
    const model = auditRowModel(
      event({
        seq: 42,
        severity: 'warn',
        durationMs: 4231,
        outcome: 'failed',
        actor: 'reaper',
        detail: { reason: 'idle-timeout' },
      }),
      NOW,
    );
    expect(model).toMatchObject({
      seq: 42,
      timeText: '13:45:30.123',
      severity: 'warn',
      actorText: '回收器',
      durationText: '4.2s',
      outcome: 'failed',
      detailText: '{\n  "reason": "idle-timeout"\n}',
    });
  });
});
