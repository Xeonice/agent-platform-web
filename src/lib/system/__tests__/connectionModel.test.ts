// F21-5 §7.1 `lib/formatLatency` + 连接卡的三态。
import { describe, it, expect } from 'vitest';
import { connectionStatusModel, formatLatency } from '@/lib/system/connectionModel';

describe('formatLatency', () => {
  it('15 → "15ms"、1500 → "1.5s"、null → "—"', () => {
    expect(formatLatency(15)).toBe('15ms');
    expect(formatLatency(1500)).toBe('1.5s');
    expect(formatLatency(null)).toBe('—');
  });
  it('NaN / Infinity 也走 "—"（一个 "NaNms" 上了界面就再没人信这张卡）', () => {
    expect(formatLatency(Number.NaN)).toBe('—');
    expect(formatLatency(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('connectionStatusModel —— unknown ≠ down', () => {
  const base = {
    rest: { ok: true },
    terminals: { total: 0, connected: 0 },
    eventsLatencyMs: null,
  };

  it('⭐ 没有测量的 /events 是 `unknown`（⚪），**不是** `down`（🔴）', () => {
    // ⚠️ 这条守的是"假警报比不检查更贵"：这条通道只挂在工作台，进设置页时它已经随
    //    工作台卸载。渲染成「已断开」会在每次进设置页时亮一次红，而什么都没坏。
    const row = connectionStatusModel(base).rows.find((r) => r.id === 'events');
    expect(row?.state).toBe('unknown');
    expect(row?.state).not.toBe('down');
  });

  it('`unknown` 那一行必须说清**为什么**测不了（只写「未测量」等于说"这界面没做完"）', () => {
    const row = connectionStatusModel(base).rows.find((r) => r.id === 'events');
    expect(row?.hint).toBeDefined();
    expect(row?.hint).toContain('工作台');
  });

  it('一旦有了延迟采样，同一行就变成 ok + 数字（这个分支不是死代码，是等着接上的接缝）', () => {
    const row = connectionStatusModel({ ...base, eventsLatencyMs: 15 }).rows.find(
      (r) => r.id === 'events',
    );
    expect(row?.state).toBe('ok');
    expect(row?.valueText).toContain('15ms');
    expect(row?.hint).toBeUndefined();
  });

  it('REST 失败 ⇒ `down` + 错误码（这一条是真的测到了，与 /events 那条性质不同）', () => {
    const row = connectionStatusModel({
      ...base,
      rest: { ok: false, errorCode: 'INTERNAL' },
    }).rows.find((r) => r.id === 'rest');
    expect(row?.state).toBe('down');
    expect(row?.hint).toContain('INTERNAL');
  });

  it('终端 0 个是**事实**不是未知（registry 里确实没有条目）', () => {
    const row = connectionStatusModel(base).rows.find((r) => r.id === 'terminals');
    expect(row?.state).toBe('ok');
    expect(row?.valueText).toBe('0 个终端会话');
  });

  it('有终端时把总数与已连接数分开说（2 个会话里 1 个断着，是两个不同的事实）', () => {
    const row = connectionStatusModel({
      ...base,
      terminals: { total: 2, connected: 1 },
    }).rows.find((r) => r.id === 'terminals');
    expect(row?.valueText).toBe('2 个终端会话（1 个已连接）');
  });

  it('三行都在，顺序固定（REST → /events → 终端）', () => {
    expect(connectionStatusModel(base).rows.map((r) => r.id)).toEqual([
      'rest',
      'events',
      'terminals',
    ]);
  });
});
