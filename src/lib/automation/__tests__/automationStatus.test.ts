// 规则生命周期状态机（P21-7 §4 / 03 §8.4 / F21-7 §7.1）。
import { describe, it, expect } from 'vitest';
import {
  afterReenable,
  applyOutcome,
  automationLifecycle,
  describeLifecycle,
} from '@/lib/automation/automationStatus';

describe('automationLifecycle', () => {
  it('启用 + 失败 0 → on', () => {
    expect(automationLifecycle({ enabled: true, degraded: false, consecutiveFailures: 0 })).toBe(
      'on',
    );
  });

  it('失败 1–2 次仍是 on（只提示不降频，P21-7 §5）', () => {
    expect(automationLifecycle({ enabled: true, degraded: false, consecutiveFailures: 2 })).toBe(
      'on',
    );
  });

  it('失败 3 次 → degraded', () => {
    expect(automationLifecycle({ enabled: true, degraded: false, consecutiveFailures: 3 })).toBe(
      'degraded',
    );
  });

  it('后端已置 degraded 标记 → 即便计数还没到 3 也认它（后端是权威）', () => {
    expect(automationLifecycle({ enabled: true, degraded: true, consecutiveFailures: 1 })).toBe(
      'degraded',
    );
  });

  it('降频后再失败 7 次（累计 10）+ enabled=false → autoDisabled', () => {
    expect(automationLifecycle({ enabled: false, degraded: true, consecutiveFailures: 10 })).toBe(
      'autoDisabled',
    );
  });

  it('⭐ 手动禁用 vs 自动禁用必须分得开', () => {
    // 同样是 enabled=false，失败计数把两者分开。判定顺序写反就会把 fail 态显示成 off 态，
    // 用户就看不到 [查看原因]/[重新启用]，只会觉得"我没关过它，它自己关了"。
    expect(automationLifecycle({ enabled: false, degraded: false, consecutiveFailures: 0 })).toBe(
      'off',
    );
    expect(automationLifecycle({ enabled: false, degraded: true, consecutiveFailures: 12 })).toBe(
      'autoDisabled',
    );
  });
});

describe('describeLifecycle', () => {
  it('四态各有语义状态与文案；只有 warn/fail 需要处置', () => {
    expect(describeLifecycle('on', 0)).toMatchObject({ status: 'ok', needsAttention: false });
    expect(describeLifecycle('degraded', 3)).toMatchObject({
      status: 'warn',
      needsAttention: true,
    });
    expect(describeLifecycle('autoDisabled', 10)).toMatchObject({
      status: 'fail',
      needsAttention: true,
    });
  });

  it('⭐ off（手动关掉）在八态里没有精确对应 → status 缺席，不硬塞 warn/fail', () => {
    // MUTATION：若把 off 误判成 warn/fail 之一，这条会先红——它是唯一钉住
    // "off 就该没有 status" 的用例，防止有人为了"看起来统一"偷偷塞一个 variant。
    const off = describeLifecycle('off', 0);
    expect(off.status).toBeUndefined();
    expect(off.needsAttention).toBe(false);
    expect(off.text).toContain('已关掉');
  });

  it('放慢的文案要说清"它还在跑，只是慢了"（⛔ 不许只写内部词「降频」）', () => {
    const text = describeLifecycle('degraded', 3).text;
    expect(text).toContain('放慢');
    expect(text).toContain('每天只试一次');
    expect(text).not.toContain('降频');
  });

  /**
   * ★ **两个数一起给。**
   *
   * 界面上只写「连续失败 10 次」，而产品文档说的是「放慢之后再连续失败 7 次就停用」——
   * 用户拿这两个数对不上会以为其中一个错了。它们是同一件事的两种数法：
   * 总共 10 次，其中前 3 次让它放慢、之后又失败 7 次。⇒ 换算直接写出来。
   */
  it('⭐ 自动停用的文案同时给「总共 N 次」和「放慢后又 M 次」，用户才对得上产品文档', () => {
    const text = describeLifecycle('autoDisabled', 10).text;
    expect(text).toContain('10 次');
    expect(text).toContain('7 次'); // 10 - 3（DEGRADE_AFTER_FAILURES）
    expect(text).toContain('自动停用');
  });
});

describe('⭐ applyOutcome · 连续失败计数口径（P21-7 §4）', () => {
  it('success 清零', () => {
    expect(applyOutcome(9, 'success')).toBe(0);
  });

  it('failed / timeout 各 +1（超时也是失败，03 §8.3）', () => {
    expect(applyOutcome(2, 'failed')).toBe(3);
    expect(applyOutcome(2, 'timeout')).toBe(3);
  });

  it('⭐ skipped / missed 既不 +1 也不清零（视同该次未发生）', () => {
    // 这条是本页最容易写错的：当成功清零 ⇒ 规则永远降不了频；
    // 当失败 +1 ⇒ 凭证过期一晚上就能把规则自动禁用掉。两个方向都错，都不报错。
    expect(applyOutcome(2, 'skipped')).toBe(2);
    expect(applyOutcome(2, 'missed')).toBe(2);
    expect(applyOutcome(0, 'skipped')).toBe(0);
  });

  it('未终态（pending/running/resource-exhausted）也不动计数', () => {
    expect(applyOutcome(4, 'pending')).toBe(4);
    expect(applyOutcome(4, 'running')).toBe(4);
    expect(applyOutcome(4, 'resource-exhausted')).toBe(4);
  });
});

describe('afterReenable', () => {
  it('[重新启用] → on 且失败计数清零（P21-7 §9.1 #25）', () => {
    const next = afterReenable();
    expect(next).toEqual({ enabled: true, degraded: false, consecutiveFailures: 0 });
    expect(automationLifecycle(next)).toBe('on');
  });
});
