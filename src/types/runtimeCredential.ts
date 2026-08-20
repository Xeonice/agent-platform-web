// Runtime 鉴权/凭证领域类型（F21-2 拦截面板 + F21-3 凭证页 runtime 分区）。
// REST 形状一律来自后端生成物（generate:api → openapi.d.ts），杜绝手写漂移（与 gitCredential.ts 同构）。
// 明文（api-key / 授权 code）永不出现在任何响应 DTO。命名纪律：对外一律 camelCase（18 §8 P1-5）。
import type { components } from '@/types/generated/openapi';

/** GET /api/runtimes 聚合项：卡片元数据 + 凭证状态 + **逐模式已配置明细**（主数据源，F21-3 §4）。 */
export type RuntimeDto = components['schemas']['RuntimeResponseDto'];

/** 逐模式已配置凭证摘要（RuntimeResponseDto.credentials[] 的一项；未配置的模式不在数组里）。 */
export type RuntimeCredentialSummary = RuntimeDto['credentials'][number];

/** 鉴权【方式】（getAuthMethods 下发；= 04 §3 RuntimeAuthMethod）。 */
export type RuntimeAuthMethod = RuntimeDto['authMethods'][number];

/** 生效【模式】：二选一全局生效（active_auth_method，05 §4）；区别于鉴权【方式】。 */
export type RuntimeAuthMode = components['schemas']['SetAuthModeDto']['method'];

/** runtime 卡片凭证状态聚合（F21-3 §4）。 */
export type CredentialStatus = RuntimeDto['credentialStatus'];

/** 逐模式凭证有效期状态（credentials[].status）。 */
export type CredentialSummaryStatus = RuntimeCredentialSummary['status'];

/** 鉴权挑战（POST /api/runtimes/:rt/auth/begin → AuthChallenge；不落表，05 §3 / 10 §7.2）。 */
export type AuthChallenge = components['schemas']['AuthChallengeResponseDto'];

/** 轮询响应（GET /api/runtimes/:rt/auth/status）：status + 成功后的掩码帐号（永不回明文）。 */
export type AuthStatusResponse = components['schemas']['AuthStatusResultResponseDto'];
/** 轮询返回状态。 */
export type AuthStatus = AuthStatusResponse['status'];

/** POST /api/runtimes/:rt/auth/begin 请求体（帐号授权两方式；api-key 走 credentials/secret 短路）。 */
export type BeginAuthRequest = components['schemas']['BeginAuthDto'];

/** POST /api/runtimes/:rt/auth/complete 请求体（setup-token 粘贴授权码）。 */
export type CompleteAuthRequest = components['schemas']['CompleteAuthDto'];

/** POST /api/runtimes/:rt/credentials/secret 请求体（api-key 直存；字段名 method，P1-1）。 */
export type SubmitSecretRequest = components['schemas']['SubmitSecretDto'];

/** PUT /api/runtimes/:rt/auth-mode 请求体（**字段名 method 不是 mode**，P1-1；目标未配置 → 409）。 */
export type SetAuthModeRequest = components['schemas']['SetAuthModeDto'];

/** 完成鉴权 / 直存 secret 的响应（仅回掩码，不回明文）。 */
export type RuntimeCredentialResult = components['schemas']['MaskedCredentialResultResponseDto'];

/** 切模式响应（runtimeId + 生效模式）。 */
export type RuntimeSettings = components['schemas']['RuntimeSettingsResponseDto'];

// ——— 视图模型（container 经 lib 派生 → view；view 禁依赖 lib，故模型类型落在 types/）———

/** 有效期状态（lib/credentialExpiry 产出）：≥7d ok / <7d warning / ≤0 expired / 无有效期 noExpiry。 */
export type ExpiryState = 'ok' | 'warning' | 'expired' | 'noExpiry';

/** 凭证卡片内的一个模式行（帐号授权 / API Key 二选一，◉/○ 单选）。 */
export interface AuthModeRow {
  /** 生效模式类别（切模式 PUT auth-mode 用）。 */
  mode: RuntimeAuthMode;
  /** 该模式对应的具体鉴权方式（帐号授权行为 oauth-device|setup-token；API Key 行为 api-key）。 */
  method: RuntimeAuthMethod;
  /** 展示名（帐号授权 / API Key）。 */
  label: string;
  /** 是否已配置（决定切换时是否需先补配，F21-3 §5「切到未配置模式」）。 */
  configured: boolean;
  /** 是否当前生效（◉ + [生效中] 徽标）。 */
  active: boolean;
  /** 掩码标识（a***@gm / sk-...ab12；仅已配置行）。 */
  maskedIdentifier?: string;
  /** 该行凭证 id（吊销目标 credentials[].credentialId；仅已配置行携带）。 */
  credentialId?: string;
  /** 「剩 N 天」文案（仅帐号授权且有有效期；API Key 无过期不渲染倒计时，F21-3 §9）。 */
  expiryLabel?: string;
  /** 有效期状态（驱动 ⚠️/❌ 标记）。 */
  expiryState: ExpiryState;
}

/** runtime 凭证卡片视图模型（lib/runtimeCredential 派生）。 */
export interface RuntimeCredentialCardModel {
  runtimeId: string;
  displayName: string;
  vendor: string;
  /** 卡片整体凭证状态（聚合端点回值）。 */
  status: CredentialStatus;
  /** 帐号授权 / API Key 两行（按可用方式渲染）。 */
  rows: AuthModeRow[];
  /** 是否任一模式已配置（否 → 简化「无凭证」态卡片）。 */
  hasAnyCredential: boolean;
}

/** 参与吊销影响判定的最小 Task 形状（来自 sandboxKeys.list，Task 视角）。 */
export interface AffectedTaskInput {
  id: string;
  name: string;
  runtime: string;
  status: string;
}

/** 受影响 Task 列表项。 */
export interface AffectedTaskItem {
  id: string;
  name: string;
}

/** 受影响运行中 Task 派生结果（前 10 + restCount + total）。 */
export interface AffectedTasksResult {
  items: AffectedTaskItem[];
  restCount: number;
  total: number;
}
