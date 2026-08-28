// 平台级审计流（F21-5 §3A / P21-5 §10.2）的**视图模型**与**筛选条件**类型。
//
// ⚠️ 这里**没有手写的 wire DTO**：`AuditEventDto` / `AuditListDto` 是生成物
// （`types/generated/openapi.d.ts` 的 `AuditListResponseDto`）的**别名**，不是抄本。
// 后端改契约 → `pnpm generate:api` → 这里编译期报红，且 `pnpm check:api-drift` 管得到。
//
// 为什么视图模型的类型住在 `types/` 而不是 `lib/`：`view` 层被 boundaries 禁止 import `lib`
// （eslint.config.js `from: 'view', allow: ['view','type','component']`），但可以 import `type`。
// 所以「时间怎么说」「耗时怎么人话化」「detail 怎么 stringify」全部在 `lib/audit/` 算完，
// view 只收一个 model —— 与 `ImageCardModel` / `RuntimeCredentialCardModel` 同一形态。
import type { components } from '@/types/generated/openapi';

/** `GET /api/system/audit` 的响应（恒按 `seq` 降序 + `hasMore`，10 §6.6.1）。 */
export type AuditListDto = components['schemas']['AuditListResponseDto'];
/** 单条审计事件（10 §7.3）。`type` 是**开放集合**，前端不得穷举 switch。 */
export type AuditEventDto = AuditListDto['items'][number];
/**
 * 五个类别（沙箱 / 项目 / 凭证 / 镜像 / 系统）。取自生成物，不在前端另列字面量。
 *
 * ⚠️ 「契约允许」与「后端今天在写」是两件事，且**会分开漂移**：2026-08-28 之前
 * `image` / `system` 一处都没写，那天后端补齐后五个才全部有生产者。现状表在
 * `lib/audit/auditStream.ts` 的 `AUDIT_CATEGORY_EMIT_STATUS`，由 msw 替身双向对账看着。
 * 筛选下拉恒给五个（契约允许、也不许因为"后端不写"就裁），替身则必须喂后端真在写的那些
 * ——只喂不存在的类别，真实界面的行密度会与 story / 测试完全对不上。
 */
export type AuditCategory = AuditEventDto['category'];
/** 三级严重度。**颜色不是唯一线索**——view 必须同时给图标与文字（F21-5 §6）。 */
export type AuditSeverity = AuditEventDto['severity'];

/**
 * 空列表**为什么**是空的——三个互不相同的事实，三句互不相同的话（F21-5 §6）。
 *
 * ⚠️ 这不是"文案的三种写法"，是**三个不同的结论**：
 *   · `no-records`               → 平台确实还没记下任何事件
 *   · `filtered-out`             → 有记录，但当前条件筛出来是空的
 *   · `category-not-yet-emitted` → 这一类事件**平台压根没开始记**（契约先给类别、
 *     后端后补写入点，中间那段窗口）。把它说成「当前筛选无匹配记录」，用户读到的是
 *     "这类操作从来没发生过"——而真相是"发生了，只是没人记"。两件事差得很远。
 *
 * ⚠️ **今天五个类别后端全在写，所以第三档在真实数据下暂时不可达**（2026-08-28）。
 * ⛔ 不许因此把它删掉：类别是开放增长的（`automation` 是 v1.1、`sandbox.health` 也还空着），
 * 下一个类别落地前照样有那段窗口。它今天靠 `auditEmptyKind(filters, table)` 的显式表继续被验证。
 *
 * 判定住在 `lib/audit/auditStream.ts`（`auditEmptyKind`）；view 只收结果。
 */
export type AuditEmptyKind = 'no-records' | 'filtered-out' | 'category-not-yet-emitted';

/**
 * 审计流筛选条件。
 *
 * ⚠️ **它会整个进 query key**（`systemKeys.audit(f)`，15 §2.1），所以必须是可稳定序列化的扁平对象。
 * 换筛选 = 换 key = 新缓存 = **游标**天然重置（F21-5 §3A ④）。
 * ⛔ 但只有**游标**天然重置：hook 自己的 `useState`（今天是 `gap`）不会跟着换 key 而清空，
 * 那一份必须显式绑到 key 上——否则会在新的一条流里渲染出一个属于旧流、这里根本不存在的洞。
 *
 * ⚠️ **`from`/`to` 是过滤条件，不是翻页手段**（§3A ⑤）：它和 `before` 是两套坐标，
 * `at` 与 `seq` 只是近似同序（并发插入下可微小乱序），把时间折算成 seq 会在边界上悄悄吞记录。
 */
export interface AuditFilters {
  /** `undefined` = 全部类别。 */
  category?: AuditCategory;
  /**
   * 产品只给「仅告警」**一个开关**，不是三选一（P21-5 §10.2）。
   *
   * ⚠️ 它**上 wire**：端点的 `severity` 是**逗号分隔的多值**（10 §6.6.1），
   * `toAuditWireQuery()` 把这一个开关翻译成 `severity=warn,error`，服务端 `IN (...)` 过滤。
   * ⛔ **不许退回客户端裁**——那样「空 + `hasMore:false`」会变成一句谎：它当时只代表
   * 「最近 200 条里没有告警」，而用户读到的是「平台从没告警过」。
   */
  severity?: 'warn-and-error';
  /** 沙箱详情时间线复用本 hook 时才有（P21-5 §10.2 [查看该沙箱完整时间线]）。 */
  subjectId?: string;
  /** ISO 时间下界；与游标正交（10 §6.6.1）。 */
  from?: string;
  /** ISO 时间上界；与游标正交。 */
  to?: string;
}

/** 一条审计行的视图模型（28 §5）。view 只吃它，不碰 `Date`、不碰 `JSON`。 */
export interface AuditRowModel {
  /** React key，且用于断层比较。 */
  seq: number;
  /**
   * 同日 `HH:mm:ss.SSS`，跨日带 `MM-DD`。
   *
   * ⚠️ **毫秒不能丢**：`audit_events.at` 是本仓第一处毫秒精度时间戳，异常风暴下同一秒里能有
   * 几十条事件——只给到秒，用户看到的是一排一模一样的时间戳，既判不出先后也对不上日志。
   * （28 §5 原文写的是 `'HH:mm:ss'`，那是在毫秒精度落地之前写的。）
   */
  timeText: string;
  severity: AuditSeverity;
  /** 后端已写成一行人话，直接上 UI（不是 JSON 串）。 */
  summary: string;
  /** `'system' → '系统'`；开放集，认不出的原样透出。 */
  actorText: string;
  /** `4231 → '4.2s'`；**无耗时的事件不产出该字段**（占位符属 view 决定，28 §5）。 */
  durationText?: string;
  outcome?: AuditEventDto['outcome'];
  /** 与 10 §6.8 同一闭集；**不拼进 `summary`**。 */
  errorCode?: string;
  /** 展开时渲染的已格式化 JSON；**detail 为空时不产出** ⇒ 该行不给展开箭头。 */
  detailText?: string;
  /** [查看该沙箱完整时间线]；只有沙箱类事件才有。 */
  subjectLink?: { subjectId: string; label: string };
}

/**
 * 断层：`afterSeq < seq < beforeSeq` 这一段**有未加载的事件，条数未知**。
 *
 * ⚠️ 它不是错误态，是**如实告知**（10 §6.6.1）：增量拉满 `limit` 说明两个 seq 之间漏了东西。
 * 不产出这个类型，UI 就只能假装列表连续——那正是异常风暴时最误导人的时刻。
 */
export interface AuditGap {
  /** 断层的**旧**侧边界：这个 seq（含）以下是已加载的历史。 */
  afterSeq: number;
  /** 断层的**新**侧边界：这个 seq（含）以上是刚 prepend 进来的增量。 */
  beforeSeq: number;
}
