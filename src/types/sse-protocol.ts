// SYNC WITH api/packages/contracts/src/sse-protocol.ts —— 修改需双端确认
// SSE 帧类型的前端权威副本（zod schema 为运行时校验唯一源）。
//
// 为什么这份是手写的：shared/10 §6 已经写死了这条边界 —— `openapi-typescript`
// **只能生成 `/api/system/diagnose` 的 content-type 声明**，生成不出流里逐帧的形状
// （openapi 的 response schema 描述的是「一个响应体」，而 SSE 的响应体是一条无穷长的
// 帧序列）。所以它与 WS 帧一样是「两仓各持一份手抄」，与 `ws-protocol.ts` 同放、
// 走同一套 `SYNC WITH` 纪律，并由主仓 `scripts/docs-check.mjs` 的 **B5** 跨仓对账。
//
// 判别键是 `event`（与 /terminal、/tasks 的 `type` 刻意不同）：SSE 传输层自己有
// `event:` 行，帧体里再重复一次是给 `fetch` + `ReadableStream` 那条消费路径用的
// （要带 POST body，`EventSource` 不支持）。
import { z } from 'zod';

/**
 * 八项检查的 id，**数组顺序 = 展示顺序**（P21-5 §6：异步并行但顺序固定）。
 *
 * ⚠️ **前端不要拿它当渲染清单的来源。** 每一轮诊断的首帧（`start`）会把服务端那份原样
 * 下发，界面应当照那一帧渲染 —— 本常量的职责只有两个：给 zod 一个闭集，以及参与
 * canonical 对账。用它当清单，等于在后端已经告诉你之后又信了一份可能过期的本地抄本。
 */
export const DIAGNOSE_CHECK_IDS = [
  'container-runtime',
  'dev-kvm',
  'disk-space',
  'port-conflict',
  'outbound-network',
  'ws-loopback',
  'data-root-fs',
  'preset-image',
] as const;
export const DiagnoseCheckIdSchema = z.enum(DIAGNOSE_CHECK_IDS);
export type DiagnoseCheckId = z.infer<typeof DiagnoseCheckIdSchema>;

/**
 * 每一项的结论。
 *
 * ⚠️ **`info` 不是「弱化的 warn」，它是「没有任何东西需要修」。** 预制镜像五步链的
 * 第 5 步（未 staged）就只能是 `info`：镜像是好的，只是这台机器还没把 rootfs 铺开，
 * 第一个 Task 会慢几分钟（实测 13GB 镜像 190 秒）。渲染成 ⚠️ 会让用户去修一个不需要
 * 修的东西 —— 而他能想到的「修法」是删了重推，那会让情况更糟（P21-5 §9A 第 5 步）。
 *
 * ⚠️ **`timeout` 与 `fail` 分开**：`fail` 是「查出来是坏的」，`timeout` 是「5s 内没查
 * 出来」。后者在「系统好像坏了」的场景里恰恰最常见，而它**不构成**「这一项是坏的」
 * 的结论 —— 一项卡住不阻塞整轮（技术 02 §5.3）。
 */
export const DIAGNOSE_STATUSES = ['ok', 'info', 'warn', 'fail', 'timeout'] as const;
export const DiagnoseStatusSchema = z.enum(DIAGNOSE_STATUSES);
export type DiagnoseStatus = z.infer<typeof DiagnoseStatusSchema>;

/**
 * 预制镜像检查链的五步（P21-5 §9A）。**跟着失败帧一起下发，渲染时不许合成一条。**
 *
 * | step | 失败意味着 | 用户下一步 |
 * |---|---|---|
 * | `config` | `SANDBOX_DEFAULT_IMAGE` 没配，回落到必炸的兜底 | 改配置 |
 * | `registry` | 配了，但 registry 里解析不到 | 推镜像 / 改地址 |
 * | `lineage` | 解析到了，但那是上游镜像不是平台自建的那张 | 换成自建那张（注册也会被拒） |
 * | `registration` | 是对的那张，但没注册进平台 / 不是 valid | 重启平台等播种 |
 * | `staged` | —— **这一步不是失败** —— | 只是等一会 |
 *
 * ⛔ 把五种失败渲染成同一句「镜像不可用」等于把诊断退化成一个红灯：那五个字对以上
 * 五种情况一字不差，而用户能做的事一个都不一样。
 */
export const PRESET_IMAGE_STEPS = [
  'config',
  'registry',
  'lineage',
  'registration',
  'staged',
] as const;
export const PresetImageStepSchema = z.enum(PRESET_IMAGE_STEPS);
export type PresetImageStep = z.infer<typeof PresetImageStepSchema>;

/**
 * 预制镜像链前四步的机器码（第 5 步没有码，因为它不是失败）。
 *
 * ⚠️ 其余七项**刻意不发码**：那七项的结论本来就带着这一次实测出来的具体数字（哪个
 * 端口、被谁占、还剩多少 GB），按码查一句固定文案反而更差。所以前端渲染那七项时
 * 直接用 `summary` / `hint`，不要为它们准备码表。
 */
export const PRESET_IMAGE_CODES = [
  'PRESET_IMAGE_NOT_CONFIGURED',
  'PRESET_IMAGE_NOT_IN_REGISTRY',
  'PRESET_IMAGE_NOT_PLATFORM_BUILT',
  'PRESET_IMAGE_NOT_SEEDED',
] as const;
export type PresetImageCode = (typeof PRESET_IMAGE_CODES)[number];

// ——— 首帧：在任何一项跑完之前发出，让页面立刻画出八个 ⏳ 占位 ———
export const DiagnoseStartFrameSchema = z.object({
  event: z.literal('start'),
  checks: z.array(z.object({ id: DiagnoseCheckIdSchema, label: z.string() })),
  /** 单项超时预算（ms），服务端保证。⚠️ 前端**不要自行计时**（F21-5 §7.1 ②）。 */
  timeoutMs: z.number().int().positive(),
});
export type DiagnoseStartFrame = z.infer<typeof DiagnoseStartFrameSchema>;

// ——— 逐项结论：八项并行，到达顺序 ≠ 展示顺序，按 id 归位 ———
export const DiagnoseCheckFrameSchema = z.object({
  event: z.literal('check'),
  id: DiagnoseCheckIdSchema,
  label: z.string(),
  status: DiagnoseStatusSchema,
  /** 一行人话，**直接上 UI**；自带这一次实测的具体数字（P21-5 §9B）。 */
  summary: z.string(),
  /** 修复建议：可复制的命令或配置项（P21-5 §6「点击复制命令到剪贴板」）。 */
  hint: z.string().optional(),
  step: PresetImageStepSchema.optional(),
  /**
   * ⚠️ 是 `string` 而不是 `enum(PRESET_IMAGE_CODES)`：闭集在**后端**，前端收窄成闭集
   * 会让后端新增一个码时前端整帧校验失败 —— 一个「后端多说了一句」引发「前端一个字都
   * 收不到」的放大。要按码分支时用 `PRESET_IMAGE_CODES.includes()` 判，不认识的照常
   * 渲染 `summary`。
   */
  errorCode: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
  durationMs: z.number().int().nonnegative(),
});
export type DiagnoseCheckFrame = z.infer<typeof DiagnoseCheckFrameSchema>;

// ——— 汇总帧：收到它 = 整轮结束，关闭连接（F21-5 §7.1 ④：无悬挂 EventSource）———
export const DiagnoseDoneFrameSchema = z.object({
  event: z.literal('done'),
  okCount: z.number().int().nonnegative(),
  infoCount: z.number().int().nonnegative(),
  warnCount: z.number().int().nonnegative(),
  /** ⚠️ 含 `timeout` 项：对整轮结论而言「答不上来」与「答坏了」都不是「好的」。 */
  failCount: z.number().int().nonnegative(),
  /** 整轮墙钟耗时。**并行**，所以 ≈ 最慢那项（≈5s），不是各项之和（技术 02 §5.3）。 */
  totalMs: z.number().int().nonnegative(),
});
export type DiagnoseDoneFrame = z.infer<typeof DiagnoseDoneFrameSchema>;

export const DiagnoseServerFrameSchema = z.discriminatedUnion('event', [
  DiagnoseStartFrameSchema,
  DiagnoseCheckFrameSchema,
  DiagnoseDoneFrameSchema,
]);
export type DiagnoseServerFrame = z.infer<typeof DiagnoseServerFrameSchema>;

/**
 * 帧形状的**跨仓对账字面量** —— 与 `api/packages/contracts/src/sse-protocol.ts` 里的同名
 * 常量必须逐字节相同，由主仓 `scripts/docs-check.mjs` 的 **B5** 门禁比对。
 *
 * 为什么需要它：与 WS 面同一条理由，且更迫切 —— WS 至少有 B4，而 SSE 帧在此之前
 * 「一份手抄、零守卫」。本仓刚在 `TRIGGERED_BY` 上发现同样的形态（三份手抄、零守卫），
 * 所以这条门禁与代码同一轮落地，而不是等它先出一次事。
 *
 * 它连**检查项 id 与顺序**、**status 取值**、**五步名**、**四个码**一起钉住：这四样都是
 * 「前端会照着写渲染分支」的东西 —— 少一项 id 画不出占位，多一个 status 会掉进 default
 * 分支，五步名对不上则「不许合成一条」那条纪律没了落点。
 *
 * 格式：`通道:帧名{字段,可选字段?},…|枚举名:值,…`。
 */
export const SSE_PROTOCOL_CANONICAL =
  'diagnose.server:start{checks[{id,label}],timeoutMs},' +
  'check{id,label,status,summary,hint?,step?,errorCode?,detail?,durationMs},' +
  'done{okCount,infoCount,warnCount,failCount,totalMs}|' +
  'diagnose.status:ok,info,warn,fail,timeout|' +
  'diagnose.checks:container-runtime,dev-kvm,disk-space,port-conflict,' +
  'outbound-network,ws-loopback,data-root-fs,preset-image|' +
  'diagnose.preset-image.steps:config,registry,lineage,registration,staged|' +
  'diagnose.preset-image.codes:PRESET_IMAGE_NOT_CONFIGURED,PRESET_IMAGE_NOT_IN_REGISTRY,' +
  'PRESET_IMAGE_NOT_PLATFORM_BUILT,PRESET_IMAGE_NOT_SEEDED';

/**
 * 诊断流的 schema 版本，服务端随响应头 `X-Schema-Hash` 下发。
 *
 * ⚠️ **在 SSE 上它是「告知」而不是「门」**：诊断的使用场景是「系统好像坏了」，此时因为
 * 版本不匹配而中断一次只读诊断，等于在最需要它的时候把它关掉。读到不认识的 hash 时
 * 应当照常渲染已认识的帧并提示升级 —— 与 `/tasks` 握手上那个**会拒绝**的 hash 相反。
 */
export const SSE_DIAGNOSE_SCHEMA_HASH = 'sb-diagnose-v1';
