// `lib/audit/auditStream.ts` 单测（F21-5 §3A 的纯逻辑那一半）。
//
// 这里守着的四条，改坏之后**页面看起来都完全正常**：
//   · `severity` 悄悄退回客户端裁（「空 + hasMore:false」会从"全表没有"变成"最近 200 条里没有"）
//   · 合并后不再降序 / 出现重复 seq（两个方向交错时才暴露）
//   · `hasMore` 与 `gap` 的映射反了（断层被吃掉 = 列表假装连续）
//   · 断层提示插错行（等于告诉用户"漏的是另一段"）
import { describe, it, expect } from 'vitest';
import {
  AUDIT_CATEGORY_EMIT_STATUS,
  AUDIT_PAGE_LIMIT,
  auditEmptyKind,
  auditRows,
  describeAuditFilters,
  gapAfterFill,
  gapFromIncremental,
  gapInsertIndex,
  hasActiveAuditFilters,
  isoToLocalInput,
  localInputToIso,
  maxSeqOf,
  mergeAuditEvents,
  mergeGap,
  minSeqOf,
  toAuditWireQuery,
} from '@/lib/audit/auditStream';
import type { AuditEmitStatusTable } from '@/lib/audit/auditStream';
import type { AuditCategory } from '@/types/audit';
import type { AuditEventDto, AuditSeverity } from '@/types/audit';

function ev(seq: number, severity: AuditSeverity = 'info'): AuditEventDto {
  return {
    seq,
    at: new Date(2026, 7, 26, 10, 0, 0, seq).toISOString(),
    category: 'system',
    type: 'system.something',
    severity,
    actor: 'system',
    summary: `事件 ${String(seq)}`,
  };
}

describe('toAuditWireQuery —— severity 必须上 wire', () => {
  it('「仅告警」= `severity=warn,error`（服务端 IN 过滤的那个并集）', () => {
    expect(toAuditWireQuery({ severity: 'warn-and-error' }).severity).toBe('warn,error');
  });

  it('⛔ 不许退化成单值：`warn` 会把 error 整个丢掉，`error` 会丢掉 warn', () => {
    // 这条断言的存在感全在这里：把映射写成 `'warn'` 或 `'error'`，
    // 上一条的 `'severity' in wire` 型断言照样绿，界面上也只是"少了一半告警"。
    const severity = toAuditWireQuery({ severity: 'warn-and-error' }).severity;
    expect(severity?.split(',').sort()).toEqual(['error', 'warn']);
  });

  it('没开「仅告警」⇒ **不写 severity 键**（写空串会被序列化成 `?severity=`）', () => {
    expect('severity' in toAuditWireQuery({})).toBe(false);
  });

  it('类别 / 时间范围 / subjectId 照常上 wire，limit 默认 200', () => {
    expect(
      toAuditWireQuery({
        category: 'image',
        subjectId: 'img-1',
        from: '2026-08-26T00:00:00.000Z',
        to: '2026-08-27T00:00:00.000Z',
      }),
    ).toEqual({
      category: 'image',
      subjectId: 'img-1',
      from: '2026-08-26T00:00:00.000Z',
      to: '2026-08-27T00:00:00.000Z',
      limit: AUDIT_PAGE_LIMIT,
    });
  });

  it('游标两个方向各自透出，且缺席时**不写键**（写 undefined 会被序列化成 `?since=`）', () => {
    expect(toAuditWireQuery({}, { before: 500 })).toEqual({ before: 500, limit: AUDIT_PAGE_LIMIT });
    expect(toAuditWireQuery({}, { since: 500 })).toEqual({ since: 500, limit: AUDIT_PAGE_LIMIT });
    expect('before' in toAuditWireQuery({}, { since: 1 })).toBe(false);
  });
});

describe('mergeAuditEvents —— 按 seq 去重 + 降序', () => {
  it('prepend 的增量与 append 的历史交错时顺序仍正确、无重复 seq', () => {
    const merged = mergeAuditEvents([ev(9), ev(7), ev(3)], [ev(10), ev(8), ev(7)]);
    expect(merged.map((e) => e.seq)).toEqual([10, 9, 8, 7, 3]);
  });

  it('空批不改变原序列', () => {
    expect(mergeAuditEvents([ev(2), ev(1)], []).map((e) => e.seq)).toEqual([2, 1]);
  });
});

describe('maxSeqOf / minSeqOf', () => {
  it('空数组 → undefined（不是 0，也不是 Infinity）', () => {
    expect(maxSeqOf([])).toBeUndefined();
    expect(minSeqOf([])).toBeUndefined();
  });

  it('取的是全集的极值，不是首尾', () => {
    expect(maxSeqOf([ev(3), ev(9), ev(5)])).toBe(9);
    expect(minSeqOf([ev(3), ev(9), ev(5)])).toBe(3);
  });
});

describe('gapFromIncremental —— hasMore 在 since 方向 = 有断层', () => {
  it('hasMore: true ⇒ 产出 {afterSeq, beforeSeq}', () => {
    expect(gapFromIncremental(100, [ev(400), ev(350), ev(301)], true)).toEqual({
      afterSeq: 100,
      beforeSeq: 301,
    });
  });

  it('hasMore: false ⇒ null（不是 {afterSeq, beforeSeq: 同值} 这种"空断层"）', () => {
    expect(gapFromIncremental(100, [ev(103), ev(102), ev(101)], false)).toBeNull();
  });

  it('hasMore: false 且 seq 之间**有跳号** ⇒ 仍然是 null', () => {
    // ⚠️ 这条是上一条的"有效性保险"：上一条的批次与 afterSeq 首尾相接，
    // 于是就算把 `if (!hasMore)` 整个删掉，后面那句连续性判定也会替它返回 null
    // ——断言还在、变异却打不到被断言的路径。这里故意留出 101–349 的跳号
    // （保留期裁剪 / 类别过滤都会造成跳号），把 hasMore 这一支单独暴露出来。
    expect(gapFromIncremental(100, [ev(400), ev(350)], false)).toBeNull();
  });

  it('批次与已见位置首尾相接 ⇒ 没有洞', () => {
    expect(gapFromIncremental(100, [ev(103), ev(101)], true)).toBeNull();
  });
});

describe('mergeGap —— 两个洞并成一个（宁可把范围说大，不能说小）', () => {
  it('无新洞 ⇒ 保留旧洞', () => {
    const current = { afterSeq: 10, beforeSeq: 50 };
    expect(mergeGap(current, null)).toBe(current);
  });

  it('旧洞未填完又来一个 ⇒ afterSeq 取更老、beforeSeq 取更新', () => {
    expect(mergeGap({ afterSeq: 10, beforeSeq: 50 }, { afterSeq: 80, beforeSeq: 300 })).toEqual({
      afterSeq: 10,
      beforeSeq: 300,
    });
  });
});

describe('gapAfterFill —— 一次只填一段', () => {
  const gap = { afterSeq: 100, beforeSeq: 400 };

  it('这一页接回了已加载的历史 ⇒ 洞闭合', () => {
    expect(gapAfterFill(gap, [ev(399), ev(250), ev(101)], true)).toBeNull();
  });

  it('还没接上 ⇒ 洞收窄，**不自动接着拉**（返回值是新洞，不是 null）', () => {
    expect(gapAfterFill(gap, [ev(399), ev(300)], true)).toEqual({ afterSeq: 100, beforeSeq: 300 });
  });

  it('空批 ⇒ 洞闭合（这段之间本来就没别的事件）', () => {
    expect(gapAfterFill(gap, [], false)).toBeNull();
  });

  it('hasMore: false（更老的没有了）⇒ 洞闭合，哪怕这一页离 afterSeq 还很远', () => {
    // 同上：不写这条的话，`if (!hasMore) return null` 被删掉也没有任何用例会红。
    expect(gapAfterFill(gap, [ev(399), ev(300)], false)).toBeNull();
  });
});

describe('gapInsertIndex —— 断层提示插在两段之间', () => {
  const rows = auditRows([ev(400), ev(399), ev(90), ev(89)], Date.now());

  it('插在第一条 seq < beforeSeq 的行之前', () => {
    expect(gapInsertIndex(rows, { afterSeq: 90, beforeSeq: 399 })).toBe(2);
  });

  it('无断层 ⇒ null（不是 0 —— 0 会把提示插到列表最顶上）', () => {
    expect(gapInsertIndex(rows, null)).toBeNull();
  });

  it('洞在已加载区更老侧 ⇒ 插在末尾', () => {
    expect(gapInsertIndex(rows, { afterSeq: 10, beforeSeq: 88 })).toBe(rows.length);
  });
});

describe('auditRows —— 只转模型，**不再裁**', () => {
  it('服务端回什么就渲染什么：info 也照渲染，一条不少、顺序不变', () => {
    // ⚠️ 这是一条**否定断言**：谁把客户端裁剪加回来（"顺手再保险一道"），
    // 这里立刻从 4 条变成 2 条。而在界面上，加回来只表现为"某些行不见了"，
    // 真正致命的后果（空态说谎 + 翻页入口消失）要平稳跑一周才看得见。
    const rows = auditRows(
      [ev(5, 'info'), ev(4, 'error'), ev(3, 'info'), ev(2, 'warn')],
      Date.now(),
    );
    expect(rows.map((r) => r.seq)).toEqual([5, 4, 3, 2]);
  });
});

describe('筛选说明与时间换算', () => {
  it('无筛选 ⇒ hasActiveAuditFilters 为 false，且说明文案说清「无筛选」', () => {
    expect(hasActiveAuditFilters({})).toBe(false);
    expect(describeAuditFilters({})).toContain('无筛选');
  });

  it('有筛选 ⇒ 说明里逐条列出（空态不能只写「暂无记录」）', () => {
    const text = describeAuditFilters({ category: 'sandbox', severity: 'warn-and-error' });
    expect(hasActiveAuditFilters({ category: 'sandbox' })).toBe(true);
    expect(text).toContain('沙箱');
    expect(text).toContain('仅告警');
  });

  it('datetime-local ↔ ISO 往返（本地时区）', () => {
    const iso = localInputToIso('2026-08-26T13:45');
    expect(iso).toBe(new Date(2026, 7, 26, 13, 45, 0, 0).toISOString());
    expect(isoToLocalInput(iso)).toBe('2026-08-26T13:45');
  });

  it('空串 / 非法输入 ⇒ undefined（宁可不筛，也不要把 Invalid Date 发上 wire）', () => {
    expect(localInputToIso('')).toBeUndefined();
    expect(localInputToIso('2026-08-')).toBeUndefined();
    expect(isoToLocalInput(undefined)).toBe('');
  });
});

/**
 * ★ 空态三分（F21-5 §6 + P21-5 §10.2 现状表）。
 *
 * 契约给五个类别，而"后端今天写不写"是另一回事、且会分开漂移。压成"有筛选 / 没筛选"两态时，
 * 选中一个还没有生产者的类别的用户永远读到「当前筛选无匹配记录」——他会去调严重度、调时间
 * 范围，而调到天荒地老也不会有一条记录出来，因为**平台压根没开始记这类事件**。
 *
 * ⚠️ **2026-08-28 起，五个类别后端全部在写**（`AUDIT_CATEGORY_EMIT_STATUS` 全 `emitted`），
 * 于是 `category-not-yet-emitted` 这一支在**真表**下不可达。这里的处理是：
 *   · 分支逻辑本身用**显式传表**测（`auditEmptyKind(filters, table)` 的第二参），
 *     走的是同一段生产代码，与"今天恰好哪个类别没落地"解耦；
 *   · 另有一条把**当前现状**钉住：真表下任何类别筛空都只会得到 `filtered-out`。
 * ⛔ 绝不用"遍历真表找第一个 not-yet 的类别"那种写法——找不到时它会**静默跳过**，
 * 而静默跳过的用例比变红的用例危险得多（看着还在，其实什么都没测）。
 */
describe('空态三分：真·无记录 / 筛选无结果 / 该类尚未记录', () => {
  /**
   * 一张**假设性**的现状表：假设 `image` 还没有生产者，其余照真表。
   *
   * ⚠️ 它不是"把断言硬编码成 image"：换成任何一个被标 `not-yet-emitted` 的类别，
   * 结论都一样；这里只是需要一个具体的键来构造那个态。用 spread 而不是重写五个键，
   * 是为了让契约新增类别时它自动跟上（真表那侧有 `satisfies` 卡穷尽性）。
   */
  const IF_IMAGE_NOT_YET: AuditEmitStatusTable = {
    ...AUDIT_CATEGORY_EMIT_STATUS,
    image: 'not-yet-emitted',
  };

  it('无筛选 ⇒ no-records（不是 filtered-out）', () => {
    expect(auditEmptyKind({})).toBe('no-records');
  });

  it('后端在写的类别筛空 ⇒ filtered-out（不许说成「尚未记录」——那会冤枉一次真实的筛选）', () => {
    expect(auditEmptyKind({ category: 'sandbox' })).toBe('filtered-out');
    expect(auditEmptyKind({ severity: 'warn-and-error' })).toBe('filtered-out');
    expect(auditEmptyKind({ subjectId: 'sb-1' })).toBe('filtered-out');
  });

  it('⭐ 被标 not-yet-emitted 的类别 ⇒ category-not-yet-emitted（不是 filtered-out）', () => {
    expect(auditEmptyKind({ category: 'image' }, IF_IMAGE_NOT_YET)).toBe(
      'category-not-yet-emitted',
    );
    // 同一张表里**别的**类别照旧是 filtered-out —— 否则这条在"恒返回尚未记录"时也会绿。
    expect(auditEmptyKind({ category: 'sandbox' }, IF_IMAGE_NOT_YET)).toBe('filtered-out');
  });

  /**
   * ⭐ 现状锁：今天真表里五个类别**全部** `emitted`，所以真实数据下这一支没有任何实例。
   *
   * ⚠️ 这条不是"多余的重复"，是**把"当前无实例"这件事写成一条会响的断言**：
   *   · 有人把某个类别改回 `not-yet-emitted`（后端撤回写入点）时，它会红，逼着一起想清楚
   *     空态该说什么、替身该不该撤形状；
   *   · 而不是让"这一支没人测"悄悄地成为现状。
   * 与 `mocks/handlers.test.ts` 的双向对账守卫是同一件事的两侧：那边钉"表 ↔ 替身"，
   * 这边钉"表 ↔ 用户实际读到的那句话"。
   */
  it('⭐ 今天真表里五个类别全 emitted ⇒ 真实数据下任何类别筛空都是 filtered-out', () => {
    // 类型守卫而不是 `as`：键就是从真表来的，不另立一份类别清单（那只是把手抄搬个家）。
    const isCategory = (value: string): value is AuditCategory =>
      Object.hasOwn(AUDIT_CATEGORY_EMIT_STATUS, value);
    const categories = Object.keys(AUDIT_CATEGORY_EMIT_STATUS).filter(isCategory);
    expect(categories).toHaveLength(5);
    expect(Object.values(AUDIT_CATEGORY_EMIT_STATUS).every((s) => s === 'emitted')).toBe(true);
    for (const category of categories) {
      expect(auditEmptyKind({ category }), `${category} 今天有生产者，空了只能是筛出来的`).toBe(
        'filtered-out',
      );
    }
  });

  it('⭐ 类别**压过**其它筛选：尚未落地的类别 + 仅告警 + 时间范围仍是「尚未记录」', () => {
    // ⚠️ 若按"先看 hasActiveAuditFilters"的顺序写，这里会退回 filtered-out，
    //    而那正是让用户去徒劳地调严重度与时间范围的那一版。
    expect(
      auditEmptyKind(
        {
          category: 'image',
          severity: 'warn-and-error',
          from: '2026-08-01T00:00:00.000Z',
        },
        IF_IMAGE_NOT_YET,
      ),
    ).toBe('category-not-yet-emitted');
  });

  it('三个取值互不相同（压成两态时这条会红）', () => {
    const kinds = [
      auditEmptyKind({}, IF_IMAGE_NOT_YET),
      auditEmptyKind({ category: 'sandbox' }, IF_IMAGE_NOT_YET),
      auditEmptyKind({ category: 'image' }, IF_IMAGE_NOT_YET),
    ];
    expect(new Set(kinds).size).toBe(3);
  });

  it('「尚未记录」这一档同样有筛选说明可给（空态不许只有一句光秃秃的话）', () => {
    expect(describeAuditFilters({ category: 'image' })).toContain('镜像');
    expect(hasActiveAuditFilters({ category: 'image' })).toBe(true);
  });

  it('⛔ 生产调用不传表 ⇒ 用的就是真表（默认参数不许被改成"永远宽松"的那张）', () => {
    // hook 里写的是 `auditEmptyKind(filters)`。默认参数若被换成一张全 not-yet 的表，
    // 上面所有传表的用例照样绿，只有这条会红。
    expect(auditEmptyKind({ category: 'image' })).toBe(
      auditEmptyKind({ category: 'image' }, AUDIT_CATEGORY_EMIT_STATUS),
    );
    expect(auditEmptyKind({ category: 'image' })).toBe('filtered-out');
  });
});
