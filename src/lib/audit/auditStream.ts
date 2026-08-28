// 审计流的**纯逻辑**：wire query 映射、两个方向的合并、断层推导（F21-5 §3A）。
// 全部零副作用、可单测；`useAuditStream` 只负责把它们接到 TanStack Query 上。
//
// ⚠️ 这里最要紧的一条：**游标一律取「原始页」的 seq。**
// 页里每一条都是服务端已经筛过的（`severity` 现在也在服务端筛，见 `toAuditWireQuery`），
// 所以「页」与「可见行」如今是同一批——但游标仍然只认响应里的 `items`，
// 不认渲染用的 `rows`：哪天再冒出一档只能在客户端裁的筛选，跟着可见行走的游标
// 会把两条可见行之间的所有事件**永久跳过**，而列表看起来连续、条数也对。
import type {
  AuditCategory,
  AuditEmptyKind,
  AuditEventDto,
  AuditFilters,
  AuditGap,
  AuditRowModel,
} from '@/types/audit';
import { auditRowModel } from '@/lib/audit/auditRowModel';

/** 默认「最近 200 条」（P21-5 §10.2 = 10 §6.6.1 的 `limit` 默认值）。上限 500，**超限后端 400 不夹紧**。 */
export const AUDIT_PAGE_LIMIT = 200;

/**
 * 「仅告警」= warn ∪ error 的 **wire 取值**（10 §6.6.1：逗号分隔多值，服务端 `IN (...)`）。
 *
 * ⚠️ 顺序与去重都别自作主张：后端按集合处理，这里只负责把产品的一个开关翻译成一个串。
 */
const ALERT_SEVERITY_PARAM = 'warn,error';

/** 一次请求的游标方向：**互斥**，两个都给由 service 层当场抛（10 §6.6.1）。 */
export interface AuditCursor {
  since?: number;
  before?: number;
}

/** 打到 wire 上的 query。 */
export interface AuditWireQuery {
  since?: number;
  before?: number;
  from?: string;
  to?: string;
  category?: AuditEventDto['category'];
  /** 逗号分隔多值（`'warn,error'`）；生成类型是 `string`，不是 enum——enum 描述不了「子集」。 */
  severity?: string;
  subjectId?: string;
  limit: number;
}

/**
 * `AuditFilters + 游标` → wire query。
 *
 * ⚠️ **`severity` 上 wire，且必须上**（10 §6.6.1 + §237）：端点收的是逗号分隔多值，
 * 服务端 `WHERE severity IN (...)` 之后再 `ORDER BY seq DESC LIMIT n+1`，扫的是**匹配行**
 * 的最新一页。在客户端裁是一条死路：那样拉回来的是**全部严重度**的最近 200 条，
 * 平台平稳跑一周之后这 200 条全是 info，昨天那次 provision 失败落在第 201 条 ⇒
 * 勾上「仅告警」得到的是「空 + `hasMore:false`」，用户读出来的结论是**「平台从没告警过」**。
 * 服务端过滤之后，「空 + `hasMore:false`」才真的等于「全表没有这一档」。
 */
export function toAuditWireQuery(
  filters: AuditFilters,
  cursor: AuditCursor = {},
  limit: number = AUDIT_PAGE_LIMIT,
): AuditWireQuery {
  return {
    ...(cursor.since === undefined ? {} : { since: cursor.since }),
    ...(cursor.before === undefined ? {} : { before: cursor.before }),
    ...(filters.from === undefined ? {} : { from: filters.from }),
    ...(filters.to === undefined ? {} : { to: filters.to }),
    ...(filters.category === undefined ? {} : { category: filters.category }),
    ...(filters.severity === 'warn-and-error' ? { severity: ALERT_SEVERITY_PARAM } : {}),
    ...(filters.subjectId === undefined ? {} : { subjectId: filters.subjectId }),
    limit,
  };
}

export function maxSeqOf(events: readonly AuditEventDto[]): number | undefined {
  return events.reduce<number | undefined>(
    (acc, e) => (acc === undefined || e.seq > acc ? e.seq : acc),
    undefined,
  );
}

export function minSeqOf(events: readonly AuditEventDto[]): number | undefined {
  return events.reduce<number | undefined>(
    (acc, e) => (acc === undefined || e.seq < acc ? e.seq : acc),
    undefined,
  );
}

/**
 * 合并两个方向的批次：**按 `seq` 去重 + 降序**。
 *
 * `incoming` 覆盖同 `seq` 的旧条目（同一行不会变，但覆盖比保留更少意外）。
 * 响应本身恒按 seq 降序（10 §6.6.1），这里再排一次是因为**两个方向合并后不再天然有序**：
 * prepend 的增量与 append 的历史交错时，只有全局排序才保证渲染顺序正确。
 */
export function mergeAuditEvents(
  existing: readonly AuditEventDto[],
  incoming: readonly AuditEventDto[],
): AuditEventDto[] {
  const bySeq = new Map<number, AuditEventDto>();
  for (const e of existing) bySeq.set(e.seq, e);
  for (const e of incoming) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => b.seq - a.seq);
}

/**
 * 增量方向拉满 `limit`（`hasMore: true`）⇒ `afterSeq` 与本批最老一条之间**漏了未知条数**。
 * `hasMore: false` ⇒ 一次拉完，没有断层（返回 `null`，不是空对象）。
 */
export function gapFromIncremental(
  afterSeq: number,
  batch: readonly AuditEventDto[],
  hasMore: boolean,
): AuditGap | null {
  if (!hasMore) return null;
  const beforeSeq = minSeqOf(batch);
  if (beforeSeq === undefined || beforeSeq <= afterSeq + 1) return null;
  return { afterSeq, beforeSeq };
}

/**
 * 已有断层未填完时又检测到新断层：**向下并入同一个洞**（`afterSeq` 取更老的那个）。
 *
 * 单个 `gap` 是 28 §10 钉死的形状。两个洞同时存在只会发生在"连着两轮 30s 都拉满 limit"
 * 的极端风暴里；此时**宁可把范围说大，也不能说小**——填充是从 `beforeSeq` 向下逐页走的
 * （`gapAfterFill`），走到 `afterSeq` 才算闭合，因此并入之后中间那批已加载的行会被
 * 去重跳过，两个洞按顺序都能填上。反过来只保留新洞，老洞就再也没人提了。
 */
export function mergeGap(current: AuditGap | null, detected: AuditGap | null): AuditGap | null {
  if (detected === null) return current;
  if (current === null) return detected;
  return {
    afterSeq: Math.min(current.afterSeq, detected.afterSeq),
    beforeSeq: Math.max(current.beforeSeq, detected.beforeSeq),
  };
}

/**
 * 点一次 [加载中间部分] 之后的剩余断层。**一次只填一段**（§3A ③：不自动循环追平）。
 *
 * 填充请求走 `before: gap.beforeSeq`（向老翻一页）。⚠️ 不是 `since: gap.afterSeq`——
 * 端点的 `since` 语义是「比 since 新的那些里**最新的 n 条**」（`audit.repository.ts` 的
 * `ORDER BY seq DESC LIMIT n`），那会把顶上已经有的同一批再取回来一遍，洞一条都不会少。
 */
export function gapAfterFill(
  gap: AuditGap,
  batch: readonly AuditEventDto[],
  hasMore: boolean,
): AuditGap | null {
  const oldest = minSeqOf(batch);
  // 空批 = 这段之间本来就没有别的事件（保留期裁剪过也会这样）⇒ 洞闭合。
  if (oldest === undefined) return null;
  // 这一页已经接回已加载的历史（或更老）⇒ 洞闭合；`hasMore` 说的是"还有更老的"，与洞无关。
  if (oldest <= gap.afterSeq + 1) return null;
  if (!hasMore) return null;
  return { afterSeq: gap.afterSeq, beforeSeq: oldest };
}

/**
 * 原始事件 → 可渲染行：**逐条算 model，不再裁**。
 *
 * ⚠️ 这里**没有** filters 参数，是有意的：所有筛选（含「仅告警」）都在服务端完成，
 * 再在这里裁一道就会把「服务端说没有」与「本地裁没了」两件事重新搅在一起
 * ——而后者正是「翻页入口消失 + 空态说谎」那条 bug 的根。
 */
export function auditRows(events: readonly AuditEventDto[], now: number): AuditRowModel[] {
  return events.map((e) => auditRowModel(e, now));
}

/** 当前是否有任何筛选生效——用于区分「平台真的没有记录」与「筛选筛掉了」（F21-5 §6）。 */
export function hasActiveAuditFilters(filters: AuditFilters): boolean {
  return (
    filters.category !== undefined ||
    filters.severity !== undefined ||
    filters.subjectId !== undefined ||
    filters.from !== undefined ||
    filters.to !== undefined
  );
}

/** 某个类别今天到底是「后端在写」还是「一条都不写」。 */
export type AuditCategoryEmitStatus = 'emitted' | 'not-yet-emitted';

/**
 * 现状表的形状。`Record<AuditCategory, …>` 是**穷尽**的：契约增/删/改名一个类别，
 * 下面那张表就编译期报红（缺键或多键），漂移不可能悄悄发生。
 */
export type AuditEmitStatusTable = Readonly<Record<AuditCategory, AuditCategoryEmitStatus>>;

/**
 * 每个契约类别**后端今天是否真的会写**（2026-08-28 复核：后端补齐了镜像/系统两档的写入点，
 * P21-5 §10.2 的现状表）。判据是 `api/apps/api/src/platform/audit/audit.projector.ts`
 * + `provision-sandbox.workflow.ts` + `runtime-install.orchestrator.ts`
 * + 镜像档（`image.registered/validated/activated/deactivated/config_updated/deleted`）
 * + 系统档（`system.access.unlocked/unlock_failed/locked/locked_attempt`）的实际取值。
 *
 * ⚠️ **这是一份跨仓手抄，代价必须写明**：真实来源在后端仓，openapi 表达不了「契约允许 ≠ 今天在写」
 * 这层信息，前端又必须知道它才能把「筛出来没有」与「压根没记」分开说。抄本会漂移，
 * 且漂移的方向**恰好是最坏的那个**——后端哪天补上一个新类别的写入点、这里没跟着改，
 * 页面上明明有数据，空态却还在说「尚未记录」。所以给它上了两道会响的锁：
 *
 *  ① **编译期**：`: AuditEmitStatusTable` 卡穷尽性。契约增/删/改名一个类别
 *     而这里没跟着分类 ⇒ `pnpm typecheck` 当场红（缺键报缺、多键报多余属性）。
 *     ⚠️ 它同时**就是** `auditEmptyKind` 那一支的实现，删不掉也绕不过去。
 *     ⛔ 这里**刻意不写 `as const satisfies`**（原来是那么写的）：`as const` 会把每个值
 *     窄化成字面量，于是"五个全 `emitted`"的今天，`status === 'not-yet-emitted'` 在
 *     类型上恒假 ⇒ `@typescript-eslint/no-unnecessary-condition` 会把对账守卫的另一个方向
 *     和空态那一支**当成死代码逼你删掉**——恰恰删掉的是下一次漂移时唯一会响的那道锁。
 *     用注解保留 `'emitted' | 'not-yet-emitted'` 这个联合，穷尽性一分没少。
 *  ② **运行期对账**：`src/mocks/handlers.test.ts` 拿这张表**双向**比对 msw 替身实际产出的
 *     类别集合——替身的形状是照着后端写入点对齐的（见 `handlers.ts` 抬头），
 *     是本仓离后端最近的一个参照物。两个方向都断言：
 *       · 表里标 `not-yet-emitted` 的，替身里一条都不许有；
 *       · 表里标 `emitted` 的，替身里必须真的有。
 *     ⇒ 后端开始写某一类之后，替身按纪律补上那一刻，方向②会红，逼着改表；
 *       反过来有人先改了表而替身没动，方向①会红。**单改一边过不去。**
 *       （2026-08-28 就是这么发生的：后端补齐 image/system ⇒ 替身补形状 ⇒ 方向②红 ⇒ 改表。）
 *
 * ⚠️ **今天五个类别全是 `emitted`，`'not-yet-emitted'` 这一支因此暂时没有真实实例。**
 * ⛔ 但**不许**因此把它删掉：类别是开放增长的（`automation` 是 v1.1 还没落地，
 * `sandbox.health` 也还空着），下一个类别落地之前照样有那段「契约给了、后端还没写」的窗口，
 * 而那正是这一支唯一存在的理由。这一支今天靠**显式传表**继续被验证
 * （`auditEmptyKind(filters, table)` 的第二参，见下），不靠"碰巧有个类别还没落地"。
 *
 * ⛔ 这张表**不许**用来裁下拉选项（五个照旧全给，P21-5 §10.2 + 用户已拍板），
 * 也不许用来跳过请求——它只回答"空的时候该说哪句话"。
 */
export const AUDIT_CATEGORY_EMIT_STATUS: AuditEmitStatusTable = {
  sandbox: 'emitted',
  project: 'emitted',
  credential: 'emitted',
  image: 'emitted',
  system: 'emitted',
};

/**
 * 空列表的**原因**（F21-5 §6：三态互不相同的文案）。
 *
 * ⚠️ 类别**压过**其它筛选：勾着「仅告警 + 尚未落地的类别」而空时，真正该说的仍是
 * 「这类事件平台还没开始记」——说成「筛选无匹配」会让用户去调严重度、时间范围，
 * 而调到天荒地老也不会有一条记录出来。
 *
 * ⚠️ `emitStatus` 是**显式的第二参**（默认就是上面那张真表，生产代码一律不传）。
 * 它不是可配置项，是那一支的**唯一活着的验证入口**：五个类别全部 `emitted` 之后，
 * 「尚未记录」在真实表下不可达，若只用真表测，那条分支会**静默地**没有任何用例覆盖
 * ——而静默失效比测试变红危险得多。传一张"假设某类还没落地"的表进来，
 * 走的仍是这里这段真实代码。
 */
export function auditEmptyKind(
  filters: AuditFilters,
  emitStatus: AuditEmitStatusTable = AUDIT_CATEGORY_EMIT_STATUS,
): AuditEmptyKind {
  if (filters.category !== undefined && emitStatus[filters.category] === 'not-yet-emitted') {
    return 'category-not-yet-emitted';
  }
  return hasActiveAuditFilters(filters) ? 'filtered-out' : 'no-records';
}

const CATEGORY_TEXT: Readonly<Record<string, string>> = {
  sandbox: '沙箱',
  project: '项目',
  credential: '凭证',
  image: '镜像',
  system: '系统',
};

/**
 * 空态里那句「当前筛选条件」。
 * ⚠️ 空态**必须说清筛的是什么**（P21-5 §10.2）：只写「暂无记录」而不说条件，
 * 用户会以为平台什么都没干过，而真相可能是他自己开着「仅告警 + 镜像」。
 */
export function describeAuditFilters(filters: AuditFilters): string {
  const parts: string[] = [];
  if (filters.category !== undefined) {
    parts.push(`类别：${CATEGORY_TEXT[filters.category] ?? filters.category}`);
  }
  if (filters.severity === 'warn-and-error') parts.push('仅告警');
  if (filters.subjectId !== undefined) parts.push(`对象：${filters.subjectId}`);
  if (filters.from !== undefined) parts.push(`起：${filters.from}`);
  if (filters.to !== undefined) parts.push(`止：${filters.to}`);
  return parts.length === 0 ? '当前无筛选条件（全部类别、全部严重度）' : parts.join(' · ');
}

/**
 * 断层提示插在哪一行**之前**：第一条 `seq < gap.beforeSeq` 的可见行。
 * 返回 `null` = 不插（无断层）；返回 `rows.length` = 插在列表末尾（洞在已加载区的更老侧）。
 *
 * ⚠️ 算在 lib 里而不是 view 里：`AuditStreamCard.view` 碰不到 lib，而"插在哪"是一条
 * 会被改错且改错后**看不出来**的规则——插错位置等于告诉用户"漏的是另一段"。
 */
export function gapInsertIndex(
  rows: readonly AuditRowModel[],
  gap: AuditGap | null,
): number | null {
  if (gap === null) return null;
  const index = rows.findIndex((row) => row.seq < gap.beforeSeq);
  return index === -1 ? rows.length : index;
}

/**
 * `<input type="datetime-local">` 的值（本地时区、无时区后缀）→ ISO。空串 ⇒ `undefined`（= 不筛）。
 * 非法输入同样返回 `undefined`——**宁可不筛，也不要发一个 `Invalid Date` 上 wire**
 * （后端 `z.string().datetime()` 会 400，而用户只是打字打了一半）。
 */
const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export function localInputToIso(value: string): string | undefined {
  // ⚠️ 形状先卡死再交给 `Date`：`new Date('2026-08-')` 在 V8 里**解析成 2026-08-01 UTC**
  // 而不是 Invalid Date —— 打字打到一半就会静默筛掉一整段历史，而界面上毫无异样。
  if (!LOCAL_DATETIME_RE.test(value)) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/** ISO → `<input type="datetime-local">` 的值（本地时区，分钟精度）。缺席 ⇒ 空串。 */
export function isoToLocalInput(iso: string | undefined): string {
  if (iso === undefined) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const pad2 = (n: number): string => String(n).padStart(2, '0');
  return `${String(at.getFullYear())}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}
