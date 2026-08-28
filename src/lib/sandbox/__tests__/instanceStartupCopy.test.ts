import { describe, it, expect } from 'vitest';
import { formatElapsed, instanceSubCopy } from '@/lib/sandbox/instanceStartupCopy';

describe('instanceSubCopy —— 起实例那一步的子文案（10 §7.4）', () => {
  it('imageStaged:false ⇒ 说出原因，并明写"不是卡死"', () => {
    const text = instanceSubCopy({ phase: 'starting', imageStaged: false });
    // 这一段没有输出、CPU 也不忙，它看起来就是卡死了——所以这四个字必须在。
    expect(text).toContain('不是卡死');
    expect(text).toContain('还没有这个镜像');
  });

  it('imageStaged:true 只陈述事实，**不承诺时间**', () => {
    const text = instanceSubCopy({ phase: 'starting', imageStaged: true });
    expect(text).toContain('镜像已在本机');
    // 后端那个 true 有一种排除不掉的假阳性（半截的 pull 也会被数成"有"，
    // 因为 BoxLite 的 `complete` 列没有透出到 SDK）。所以文案里不许出现任何时间承诺，
    // 否则一次假阳性就把用户又扔回"说好很快、结果等了三分钟"。
    expect(text).not.toMatch(/秒|分钟|很快|马上/);
  });

  it('imageStaged 缺席 ⇒ 只说在做什么，不编理由', () => {
    const text = instanceSubCopy({ phase: 'starting' });
    expect(text).toBe('正在拉起实例…');
    // 「provider 说不出」不能被渲染成「本机没有这个镜像」——那是把不知道说成了知道。
    expect(text).not.toContain('还没有这个镜像');
    expect(text).not.toContain('已在本机');
  });

  it('phase:ready ⇒ 换成下一步的文案，不再停在"正在拉起"', () => {
    // 冷启那 190 秒结束的**那一刻**是用户全程唯一一次看到进展。文案必须跟着走。
    expect(instanceSubCopy({ phase: 'ready', imageStaged: false })).toBe(
      '实例已就绪，正在准备 agent 运行环境…',
    );
  });

  it('没有投影 ⇒ 不加子文案（进度卡照常渲染四格）', () => {
    expect(instanceSubCopy(undefined)).toBeUndefined();
  });
});

describe('formatElapsed —— 前端自算的「已等待」', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [9_000, '0:09'],
    [59_000, '0:59'],
    [60_000, '1:00'],
    // 用户那次真实的等待。
    [190_529, '3:10'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
  ])('%dms → %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  it('秒数补零，不渲染成 `3:1`', () => {
    expect(formatElapsed(181_000)).toBe('3:01');
  });

  it('负数与 NaN 归 0 —— 时钟回拨不该渲染成 `-1:-3`', () => {
    expect(formatElapsed(-5_000)).toBe('0:00');
    expect(formatElapsed(Number.NaN)).toBe('0:00');
  });
});
