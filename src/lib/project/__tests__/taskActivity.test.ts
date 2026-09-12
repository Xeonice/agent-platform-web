// `describeTaskActivity`：任务树副行「活跃于 X 前」的唯一格式化实现（15 §5 附近新增）。
import { describe, it, expect } from 'vitest';
import { describeTaskActivity } from '@/lib/project/taskActivity';

const NOW = new Date('2026-08-31T12:00:00.000Z').getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

describe('describeTaskActivity', () => {
  /**
   * ⭐ 硬要求钉子：`lastActiveAt <= 0`（`useSandboxes` 今天的硬编码占位值）视为
   * 「没有真实时间戳」，⛔ 不许显示「活跃于 1970 年前」这类编造数据。
   *
   * 变异：把 `lastActiveAt <= 0` 改成 `lastActiveAt < 0`（漏了 0 这个哨兵值）
   * ⇒ 本例会拿到一句「活跃于 56 年前」而不是 `undefined`。
   */
  it('lastActiveAt <= 0（没有真实时间戳）⇒ undefined，不编造', () => {
    expect(describeTaskActivity(0, NOW)).toBeUndefined();
    expect(describeTaskActivity(-1, NOW)).toBeUndefined();
  });

  it('3 分钟前 ⇒ 「活跃于 3 分钟前」', () => {
    expect(describeTaskActivity(NOW - 3 * MINUTE, NOW)).toBe('活跃于 3 分钟前');
  });

  it('1 小时前 ⇒ 「活跃于 1 小时前」', () => {
    expect(describeTaskActivity(NOW - HOUR, NOW)).toBe('活跃于 1 小时前');
  });

  it('刚刚（<1 分钟）⇒ 「活跃于 刚刚」', () => {
    expect(describeTaskActivity(NOW - 1000, NOW)).toBe('活跃于 刚刚');
  });
});
