// F21-6 §3.3 已保留卷的视图模型：两个大小、倒计时取整、排序、弱引用降级。
import { describe, it, expect } from 'vitest';
import {
  formatVolumeBytes,
  retainedVolumeRow,
  retainedVolumeRows,
  retainedVolumeTotals,
} from '@/lib/project/retainedVolumeModel';
import type { RetainedVolumeDto } from '@/types/retainedVolume';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const MB = 1024 * 1024;
const GB = 1024 * MB;

function dto(overrides: Partial<RetainedVolumeDto> = {}): RetainedVolumeDto {
  return {
    id: 'rv-1',
    projectId: 'proj-A',
    sandboxId: 'sbx-7f3a',
    source: 'manual-destroy',
    retainedAt: '2026-08-25T10:12:00.000Z',
    retainUntil: '2026-09-24T10:12:00.000Z',
    diskBytes: GB,
    downloadBytes: 14 * MB,
    ...overrides,
  };
}

describe('formatVolumeBytes', () => {
  it('<10 给一位小数、≥10 不给（1.0 GB / 14 MB —— 就是文档里那对实测值）', () => {
    expect(formatVolumeBytes(GB)).toBe('1.0 GB');
    expect(formatVolumeBytes(14 * MB)).toBe('14 MB');
  });

  it('字节量级不带小数', () => {
    expect(formatVolumeBytes(512)).toBe('512 B');
    expect(formatVolumeBytes(0)).toBe('0 B');
  });

  it('非法值给 `—` 而不是 NaN（"下载 NaN B" 属于不报错的错）', () => {
    expect(formatVolumeBytes(Number.NaN)).toBe('—');
    expect(formatVolumeBytes(-1)).toBe('—');
  });
});

describe('两个大小都在，且各自取自各自的字段（10 §6：只给一个必然误导）', () => {
  it('diskBytes → diskText、downloadBytes → downloadText，实测差 70 倍时两个数都对得上', () => {
    const row = retainedVolumeRow(dto(), NOW);
    expect(row.diskText).toBe('1.0 GB');
    expect(row.downloadText).toBe('14 MB');
  });

  it('⭐ 两个字段不可互换：交换 DTO 里的两个数，两个文案必须跟着交换', () => {
    // 这条防的是"两个 text 都读了同一个字段"——那样界面上会出现两个一样的数，
    // 而"两个大小都显示了"这句话在结构上依然成立（断言存在 ≠ 断言有效）。
    const row = retainedVolumeRow(dto({ diskBytes: 14 * MB, downloadBytes: GB }), NOW);
    expect(row.diskText).toBe('14 MB');
    expect(row.downloadText).toBe('1.0 GB');
  });

  it('合计同样是两个数，分别求和', () => {
    const totals = retainedVolumeTotals([
      dto({ id: 'a', diskBytes: GB, downloadBytes: 14 * MB }),
      dto({ id: 'b', diskBytes: GB, downloadBytes: 6 * MB }),
    ]);
    expect(totals.count).toBe(2);
    expect(totals.diskText).toBe('2.0 GB');
    expect(totals.downloadText).toBe('20 MB');
  });

  it('空列表的合计是 0，不是 NaN / 未定义', () => {
    expect(retainedVolumeTotals([])).toEqual({ count: 0, diskText: '0 B', downloadText: '0 B' });
  });
});

describe('保留期倒计时（P21-5 §6：整数天向下取整）', () => {
  const at = (iso: string): string | undefined =>
    retainedVolumeRow(dto({ retainUntil: iso }), NOW).countdownText;

  it('≥1 天 → 「还需 N 天」，且是**向下**取整（6 天又 23 小时仍是 6 天）', () => {
    expect(at('2026-09-06T12:00:00.000Z')).toBe('还需 6 天');
    expect(at('2026-09-07T11:00:00.000Z')).toBe('还需 6 天');
  });

  it('刚好整 1 天 → 「还需 1 天」（边界不落到"不足 1 天"）', () => {
    expect(at('2026-09-01T12:00:00.000Z')).toBe('还需 1 天');
  });

  it('不足 1 天 → 「不足 1 天」，且标 urgent（下载窗口快关了）', () => {
    expect(at('2026-09-01T11:59:00.000Z')).toBe('不足 1 天');
    expect(retainedVolumeRow(dto({ retainUntil: '2026-09-01T11:59:00.000Z' }), NOW).urgent).toBe(
      true,
    );
  });

  it('已到点 → 「即将清理」，不是负数天（清理是后台任务，到点与真删之间有窗口）', () => {
    expect(at('2026-08-30T12:00:00.000Z')).toBe('即将清理');
    expect(at('2026-08-31T12:00:00.000Z')).toBe('即将清理');
  });

  it('还早的那条**不**标 urgent（全都高亮等于没有高亮）', () => {
    expect(retainedVolumeRow(dto(), NOW).urgent).toBe(false);
  });

  it('`retainUntil` 解析不出来 → 整个倒计时缺席（不渲染 NaN）', () => {
    const row = retainedVolumeRow(dto({ retainUntil: 'not-a-date' }), NOW);
    expect(row.countdownText).toBeUndefined();
    expect(row.urgent).toBe(false);
  });
});

describe('排序：按 retainUntil 升序 —— 界面顺序 = 真实消失顺序（FIFO）', () => {
  it('最先被清掉的排最上面，与输入顺序无关', () => {
    const rows = retainedVolumeRows(
      [
        dto({ id: 'late', retainUntil: '2026-09-20T00:00:00.000Z' }),
        dto({ id: 'soon', retainUntil: '2026-09-01T00:00:00.000Z' }),
        dto({ id: 'mid', retainUntil: '2026-09-10T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'mid', 'late']);
  });

  it('无法解析日期的排到最后（它们没有倒计时可言，混在中间会打乱队形）', () => {
    const rows = retainedVolumeRows(
      [
        dto({ id: 'broken', retainUntil: 'nope' }),
        dto({ id: 'soon', retainUntil: '2026-09-01T00:00:00.000Z' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(['soon', 'broken']);
  });

  it('不改动入参数组（纯函数，调用方的 query 缓存不能被就地排序）', () => {
    const input = [
      dto({ id: 'late', retainUntil: '2026-09-20T00:00:00.000Z' }),
      dto({ id: 'soon', retainUntil: '2026-09-01T00:00:00.000Z' }),
    ];
    retainedVolumeRows(input, NOW);
    expect(input.map((d) => d.id)).toEqual(['late', 'soon']);
  });
});

describe('来源与弱引用', () => {
  it('sandboxId 在 → 说出来源任务', () => {
    expect(retainedVolumeRow(dto(), NOW).originText).toBe('来源任务 sbx-7f3a');
  });

  it('⭐ sandboxId 缺席（sandbox 归档后置空）→ 「来源任务已归档」，不是空字符串', () => {
    // 空格子会被读成"加载失败"，而这条记录完全正常、仍可下载与删除（10 §7.3 弱引用）。
    const row = retainedVolumeRow(dto({ sandboxId: undefined }), NOW);
    expect(row.originText).toBe('来源任务已归档');
    expect(row.sandboxId).toBeUndefined();
  });

  it('两种 source 各有自己的说法（枚举全覆盖）', () => {
    expect(retainedVolumeRow(dto({ source: 'manual-destroy' }), NOW).sourceText).toBe(
      '销毁任务时保留',
    );
    expect(retainedVolumeRow(dto({ source: 'automation-artifact' }), NOW).sourceText).toBe(
      '自动化产物',
    );
  });
});
