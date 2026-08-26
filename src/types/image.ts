// 镜像管理（F21-4 / P21-4）的**视图模型**与**纯函数最小入参**类型。
//
// ⚠️ 这里**没有手写的 `ImageDto`，也不许有**：wire 类型一律来自 `pnpm generate:api` 的生成物
// （`types/generated/openapi.d.ts`）。上一轮写这段话时 `api/openapi.json` 里一条 `/api/images`
// 都没有，所以只能等；**本轮后端 8 个端点已落地**，于是文件末尾多了一组 wire 别名——
// 它们是 `components['schemas'][…]` 的**别名**，不是手抄：类型的唯一来源仍然是生成物，
// 后端改契约 → generate:api → 这里编译期报红，且 `pnpm check:api-drift` 管得到它。
// 手抄一份顶着用 = 把 wire 类型抄第二遍（shared/14 明令禁止），这条禁令原样有效。
//
// 下面的 `*Input` 是**派生函数真正读到的那几个字段**，不是 DTO 副本
// （先例：`types/runtimeCredential.ts` 的 `AffectedTaskInput`）。结构化类型意味着
// 端点落地后，hook 层把真的 `ImageDto` 直接喂进来即可，这里一行都不用改。
//
// 为什么视图模型的类型住在 `types/` 而不是 `lib/`：`view` 层被 boundaries 禁止 import `lib`
// （eslint.config.js `from: 'view', allow: ['view','type','component']`），
// 但可以 import `type` —— 与凭证页 `RuntimeCredentialCardModel` 同一形态（F21-4 §3.1 规则 2）。

import type { components } from '@/types/generated/openapi';

/** 三级验证结论（P21-4 §5）。 */
export type ImageValidationStatus = 'valid' | 'warning' | 'invalid';

/** digest 呈现状态（F21-4 §5.1）：钉定 / 未解析（空串或哨兵值）。 */
export type ImageDigestState = 'pinned' | 'unresolved';

/** ref 形态：只有 tag 形态才谈得上「上游漂移」；`repo@sha256:…` 天然不漂移。 */
export type ImageRefKind = 'tag' | 'digest';

/** 镜像坐标的最小输入形状（对应 10 §7.3 `ImageDto.ref`）。 */
export interface ImageRefInput {
  registry: string;
  repository: string;
  /** tag 形态才有；`repo@sha256:…` 注册时缺席。 */
  tag?: string;
  /**
   * 注册时钉定的 digest。⚠️ 契约说非空（不变量 I-IMG-6），**但今天唯一写它的代码是硬编码哨兵值**
   * （`provision-sandbox.workflow.ts` 的 `'sha256:unresolved'`），所以这里按「可能缺席 / 可能是哨兵」处理。
   */
  digest?: string;
}

/** `imageCardModel()` 的最小入参。 */
export interface ImageCardInput {
  id: string;
  name: string;
  ref: ImageRefInput;
  validationStatus: ImageValidationStatus;
  supportedRuntimes: readonly string[];
  isActive: boolean;
  /** 预置镜像（AIO）：前端隐藏 [删除]，仅保留 [禁用]（P21-4 §9）。 */
  isBuiltin: boolean;
  /** 上一次解析/验证时刻（ISO）。**缺席时不渲染时间行**，而不是渲染「解析于 NaN 前」（F21-4 §7.1 ③）。 */
  lastValidatedAt?: string;
  /** ⚠️ 档的后果说明（P21-4 §5：当前真实存在的只有「未预装 claude-code」一档）。 */
  warnings?: readonly string[];
  /** ❌ 档的失败原因列表。 */
  errors?: readonly string[];
}

/**
 * 镜像卡片视图模型（`lib/image/imageCardModel.ts` 派生，`ImageCard.view` 只吃它）。
 *
 * ⚠️ **这里不存在、也不许新增任何「结论过期」字段**（`staleValidation` / `isStale` / `validationExpiresAt` …）：
 * 钉定 digest 之后结论描述的是一个**不可变对象、不会烂**（P21-4 §5 ★），会变的只是
 * 「这个 tag 现在还指向它吗」——那是 [检查更新] 回答的问题，不是卡片自己随时间变黄。
 * 留一个口子，「7 天变黄」那种设计就会从别处偷偷长回来。这条落成 `__tests__` 里的否定断言。
 */
export interface ImageCardModel {
  id: string;
  name: string;
  /** 用户认得的坐标：`docker.io/myrepo/ml-agent:v1.0` 或 `docker.io/myrepo/ml-agent@sha256:…`。 */
  refDisplay: string;
  refKind: ImageRefKind;
  digestState: ImageDigestState;
  /**
   * 截断展示：**前 12 + 尾 3**（F21-4 §7.1 ①）。
   * `digestState === 'unresolved'` 时为 `undefined`——**不产出假哈希、不产出空串、不把哨兵值漏出去**。
   */
  digestShort?: string;
  /** 全串（点击展开 + 一键复制）；未解析时同样 `undefined`。 */
  digestFull?: string;
  /** 「解析于 3 天前」。`lastValidatedAt` 缺席/不可解析时为 `undefined` ⇒ view 整行不渲染。 */
  resolvedAtLabel?: string;
  validationStatus: ImageValidationStatus;
  warnings: readonly string[];
  errors: readonly string[];
  supportedRuntimes: readonly string[];
  isActive: boolean;
  /** 预置镜像不给 [删除]（P21-4 §9）。 */
  canDelete: boolean;
  /** [检查更新] 可否点：仅 tag 形态 + digest 已钉定。 */
  canCheckUpdate: boolean;
  /** 置灰时的理由（**置灰并说明，不隐藏**——隐藏会让人以为这张卡少了个功能，F21-4 §5.1）。 */
  checkUpdateDisabledReason?: string;
}

/**
 * 卡片**背后**的一行历史版本（P21-4 §5 ★：更新 = INSERT 新行 + 旧行下线，不是就地改）。
 *
 * 它住在 `types/` 而不是 `lib/` 的理由与 `ImageCardModel` 完全相同：
 * `ImageVersionHistory.view` 要吃它，而 view 被 boundaries 禁止 import `lib/`（只能 view/type/component）。
 */
export interface ImageVersionRowModel {
  /** manifest 行 id —— [切换到此版本] 就是拿它去 `POST /api/images/:id/activate`。 */
  id: string;
  /** tag（或以 digest 注册时的那个 digest）。 */
  version: string;
  /** 截断后的 digest；未解析时**缺席**（不产出假哈希、不把哨兵串漏出去）。 */
  digestShort?: string;
  isActive: boolean;
  registeredAt: string;
  /** ⚠️ 这里保留 DTO 的**四**档（含 `pending`）：历史列表是溯源视图，把 `pending` 归到 ❌ 会 */
  /** 让"平台没判过"看起来像"平台判过、不合格"——卡面必须选一档，这里不必。 */
  validationStatus: 'pending' | 'valid' | 'warning' | 'invalid';
}

// ——— 运行参数 / 环境变量（P21-4 §10）———

/**
 * 与后端**同名**的四个 env 错误码（F21-4 §5）。它们住在统一错误 envelope 的 `details[].code` 里，
 * 顶层 `code` 恒为 `VALIDATION_FAILED`——两条不同的路，别合并（F21-4 §8.3）。
 */
export type EnvVarErrorCode =
  'ENV_NAME_INVALID' | 'ENV_NAME_RESERVED' | 'ENV_LIMIT_EXCEEDED' | 'ENV_DUPLICATE_KEY';

/** `validateEnvVars()` 的最小入参（只读 key/value）。 */
export interface EnvVarPair {
  key: string;
  value: string;
}

/** `EnvVarEditor.view` 的一行（受控；草稿由 container 持有，07 §3 规则 2）。 */
export interface EnvVarRowModel extends EnvVarPair {
  /** 稳定行 id（删行后 React key 不能用下标）。 */
  id: string;
  secret: boolean;
  /**
   * 库里已存有该 secret 的值。此时输入框**渲染为空** + placeholder「（保持不变，输入即覆盖）」，
   * ⚠️ **原值不进 props、不进 DOM**（P21-4 §10.2 安全红线）。
   */
  secretStored: boolean;
}

/** 一条 env 校验错误。 */
export interface EnvVarValidationError {
  /** 行下标；整表级错误（条数超限）时缺席。 */
  index?: number;
  field: 'key' | 'value' | 'rows';
  code: EnvVarErrorCode;
  /**
   * 与后端 `details[].path` **同形**（`env[2].key` / `env`），
   * 好让「前端预检」与「后端 400 逐行归位」用同一套定位口径（F21-4 §5）。
   */
  path: string;
}

/** `validateEnvVars()` 的结果。 */
export interface EnvVarValidationResult {
  errors: readonly EnvVarValidationError[];
  /** 还能不能加行（条数到顶 ⇒ [+ 添加变量] 置灰，F21-4 §5）。 */
  canAddRow: boolean;
  /**
   * 逐行 VALUE 的**字节**数（与 `errors` 下标对齐），供计数器渲染「N / 4096 字节」。
   * ⚠️ 单位是字节不是字符，UI 上也要写「字节」（F21-4 §5）。
   */
  valueByteCounts: readonly number[];
}

// ——— 验证结论的**纯数据**形状（不带回调，方便在 modal / 对比弹层里整块传递与写 story args）———

/**
 * 三级验证结论的呈现数据（`ValidationResult.view` 吃它）。
 *
 * ⚠️ 注册弹窗里这块东西的生命周期是裁决的一部分（P21-4 §6 / §5「⏳ 结论已作废」）：
 * URI 一改（trim 后不同），容器就把它**整个清掉**——不是条件隐藏。留着等"万一改回来"，
 * 就是留着一个随时可能与当前输入不符的绿勾。
 */
export interface ImageValidationResultData {
  status: ImageValidationStatus;
  /** ⚠️ 档的后果说明（不裸报技术词，P21-4 §9）。 */
  warnings?: readonly string[];
  /** ❌ 档的失败原因。 */
  errors?: readonly string[];
  /** ✅/⚠️ 时回显本次解析出的 digest 短串（P21-4 §6「并回显本次解析出的 digest」）。 */
  pinnedDigestShort?: string;
}

// ——— wire 类型（**生成物别名**，本轮后端 8 个端点落地后才有）———
//
// 形态与 `types/project.ts` / `types/gitCredential.ts` 一致：`components['schemas'][…]` 的别名。
// ⚠️ 别名之外**一个字段都不补**——补一个字段就是手抄，`check:api-drift` 管不到它。
// 上面那些 `*Input` 视图模型入参**不因此作废**：它们是"派生函数真正读到的那几个字段"，
// 结构化类型让下面这些真 DTO 能直接喂进去（见 `lib/image/imageManifestCards.ts`）。

/** `GET /api/images` 的一行 = 一条 **manifest**（不是"一张镜像"）。同名镜像的多个版本各占一行。 */
export type ImageManifestDto = components['schemas']['ImageManifestResponseDto'];
/** `POST /api/images/validate` 的注册前预检结论。⚠️ 契约里**不含 digest**（见 useImages 注释）。 */
export type ValidationOutcomeDto = components['schemas']['ValidationOutcomeResponseDto'];
/** `POST /api/images/:id/validate`：三级结论 + `currentDigest`/`upstreamDigest`/`digestChanged`。 */
export type RevalidateOutcomeDto = components['schemas']['RevalidateOutcomeResponseDto'];
/** `POST /api/images`：`{ manifest, validation }`（`created` 由 HTTP 200/201 承载，不在 body 里）。 */
export type RegisterImageResponseDto = components['schemas']['RegisterImageResponseDto'];
/** `POST /api/images/:id/check-update`：`upstream` 为 `null` 表示上游连这个 tag 都没了。 */
export type CheckImageUpdateDto = components['schemas']['CheckImageUpdateResponseDto'];
/** `PATCH /api/images/:id` 的 body（两个可变字段，各自单独发，绝不整体覆盖）。 */
export type PatchImageDto = components['schemas']['PatchImageDto'];
/** `PATCH` body 里的 `imageConfig`（`env[]` + 可选 `cmdOverride`）。 */
export type ImageConfigInput = NonNullable<PatchImageDto['imageConfig']>;
/** manifest 上回读的运行参数（secret 的 value 恒为 `''` —— 后端掩码，I-IMG-5）。 */
export type ImageConfigDto = NonNullable<ImageManifestDto['imageConfig']>;
/** 三级结论里的一条 finding（`{ path?, code, message }`），也是 `details[]` 的元素形状。 */
export type ValidationIssueDto = ValidationOutcomeDto['errors'][number];

/**
 * `POST /api/images` 的服务层返回：body + **HTTP 状态位**。
 *
 * ⚠️ `created` 只能由状态码得到（后端刻意没把它放进 body：「an undocumented extra field
 * is a second source for the same fact」）。200 = 这个 digest 库里已经有了（重复粘贴同一个 URI），
 * 201 = 新插了一行。前端两条路完全不同（前者是"就地提示 + 定位到该镜像"，后者是"注册成功"），
 * 所以这一位必须由 service 层从 `response.status` 提出来，不能让 hook 去猜。
 */
export interface RegisterImageResult {
  manifest: ImageManifestDto;
  validation: ValidationOutcomeDto;
  created: boolean;
}
