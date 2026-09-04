// 保留卷领域类型（10 §7.3 `RetainedVolumeDto` / 后端 schema 名 `RetainedVolumeResponseDto`）。
//
// **形状来自生成物**（`components['schemas'][...]`），与全站其它 REST 类型同源。
// ⚠️ 上一版这里是**手抄**的，因为当时后端还没导出这三个端点、`paths` 里没有它们；
// 后端重导之后已按那条注释换过来，手抄全部删除。
//
// ⚠️ **zod schema 保留，它和生成类型各管一头，不是重复**：
// · 生成类型 = **编译期**兜底（后端改契约 → `generate:api` → 调用点报红）；
// · zod      = **运行时**兜底（真实响应与契约不符时当场炸，而不是把 `undefined`
//              渲染成「下载 NaN B」——后者不报错、只是悄悄显示一个假数字）。
// ★ 两者由下方的 `satisfies z.ZodType<RetainedVolumeDto>` 锁死：schema 与生成类型
//   一旦漂移，**编译期**就红，不必等谁记得手动同步。
import type { components } from '@/types/generated/openapi';
import { z } from 'zod';

/**
 * 保留卷来源。
 * · `manual-destroy` —— 用户销毁 Task 时勾了「保留工作区卷」（P20 §6 决策 2）。
 * · `automation-artifact` —— 自动化规则产出的成果（F21-7，尚未排期）。
 */
export const RETAINED_VOLUME_SOURCES = ['manual-destroy', 'automation-artifact'] as const;

/**
 * ⭐ **`.datetime()` 不是洁癖，它是在消费一条刚变强的契约。**
 *
 * 后端契约里这些字段已从裸 `z.string()` 收成 `IsoInstantSchema`
 * （openapi 上是 `"format": "date-time"`）——平台只发 `toISOString()` 的 UTC 瞬时。
 * ⚠️ 生成类型救不了这一层：`format` 在 `openapi.d.ts` 里只落成一行注释，`createdAt`
 * 仍然是 `string`，`'not-a-date'` 编译期照样过。⇒ 契约的这一半只有写在这里才有人执行。
 */
export const RetainedVolumeDtoSchema = z.object({
  /** uuid v7 —— **就是 DELETE 与下载用的那个 id**（10 §7.3）。 */
  id: z.string(),
  projectId: z.string(),
  /** 来源 Task。⚠️ 弱引用：sandbox 记录归档后置 undefined，卷仍可管理（10 §7.3）。 */
  sandboxId: z.string().optional(),
  source: z.enum(RETAINED_VOLUME_SOURCES),
  retainedAt: z.string().datetime(),
  /** 到点由 VolumeReaper 清理（3/7/30 天）。倒计时口径见 P21-5 §6。 */
  retainUntil: z.string().datetime(),
  /** 宿主目录实占（reflink 之后可能远小于逻辑大小）。**清理决策看它。** */
  diskBytes: z.number(),
  /** 打包后的 tar 字节数 —— 与 `Content-Length` 同一个数。**下载预期看它。** */
  downloadBytes: z.number(),
}) satisfies z.ZodType<RetainedVolumeDto>;

/** ★ 契约唯一来源：生成物。zod 只负责运行时校验，不再定义形状。 */
export type RetainedVolumeDto = components['schemas']['RetainedVolumeResponseDto'];

export const RetainedVolumeListSchema = z.array(RetainedVolumeDtoSchema);

export type RetainedVolumeSource = RetainedVolumeDto['source'];

// ===== 视图模型（`lib/project/retainedVolumeModel` 产出，view 直接渲染）=====
// ⚠️ 放在 types/ 而不是 lib/ 是分层的硬要求：view 被 boundaries 禁止 import `lib/`
//    （eslint `boundaries/element-types`），只能 import view/type/component。
//    与 `types/system.ts` 的 `ResourcePoolCardModel` 同一处理。

export interface RetainedVolumeRow {
  id: string;
  /** 来源 Task；弱引用，sandbox 归档后为 undefined（10 §7.3）。 */
  sandboxId?: string;
  /** 弱引用断掉时的替代说法——空格子会被读成"加载失败"。 */
  originText: string;
  sourceText: string;
  retainedAtText: string;
  /**
   * **宿主实占**（`diskBytes`）。清理决策看这个数：删掉它能拿回多少盘。
   * ⚠️ 与 `downloadText` 实测差 70 倍（web 工作区 1.0 GB vs 14 MB），两个都必须显示。
   */
  diskText: string;
  /** **tar 包大小**（`downloadBytes`）= `Content-Length`。下载预期看这个数。 */
  downloadText: string;
  /** `'还需 6 天'` / `'不足 1 天'` / `'即将清理'`；`retainUntil` 不可解析时缺席。 */
  countdownText?: string;
  /** 不足 1 天或已到点：值得在界面上突出（下载窗口快关了）。 */
  urgent: boolean;
}

export interface RetainedVolumeTotals {
  count: number;
  diskText: string;
  downloadText: string;
}
