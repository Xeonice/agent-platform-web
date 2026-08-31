// `remainingWholeDays`：保留卷倒计时的**唯一**取整实现（P21-5 §6）。
// 它被两处消费——系统状态卡（`lib/system/resourceModel`）与项目菜单的已保留卷
// （`lib/project/retainedVolumeModel`）。两边说的句子不同、规则必须相同，所以规则在这里测。
import { describe, it, expect } from 'vitest';
import { remainingWholeDays } from '@/lib/_shared/formatTime';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const at = (offsetMs: number): ReturnType<typeof remainingWholeDays> =>
  remainingWholeDays(new Date(NOW.getTime() + offsetMs).toISOString(), NOW);

describe('remainingWholeDays', () => {
  it('向下取整：6 天 23 小时仍然是 6 天（不是 7）', () => {
    expect(at(6 * DAY + 23 * HOUR)).toEqual({ expired: false, days: 6 });
  });

  it('整数天边界归到那一天本身', () => {
    expect(at(DAY)).toEqual({ expired: false, days: 1 });
    expect(at(30 * DAY)).toEqual({ expired: false, days: 30 });
  });

  it('⭐ `expired` 与 `days === 0` 是两件事：还剩 1 小时不是"已过期"', () => {
    // 合成一个会让已过期的卷显示「不足 1 天」，用户以为还来得及下载。
    expect(at(HOUR)).toEqual({ expired: false, days: 0 });
    expect(at(-HOUR)).toEqual({ expired: true, days: 0 });
  });

  it('正好到点算已过期（清理是后台任务，到点与真删之间有窗口）', () => {
    expect(at(0)).toEqual({ expired: true, days: 0 });
  });

  it('已过期不给负数天（「还需 -1 天」会让人以为界面坏了）', () => {
    expect(at(-10 * DAY)).toEqual({ expired: true, days: 0 });
  });

  it('无法解析 → undefined（调用方据此整条不渲染，而不是渲染 NaN）', () => {
    expect(remainingWholeDays('not-a-date', NOW)).toBeUndefined();
    expect(remainingWholeDays('', NOW)).toBeUndefined();
  });
});
