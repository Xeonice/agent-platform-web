// RuntimeDto → 凭证卡片视图模型派生（F21-3 §3/§5，可单测）。UI 决策集中于此，view 只吃结果（07 §6）。
// 零副作用、零网络。
//
// 逐模式明细来自后端补全的 RuntimeResponseDto.credentials[]（每个**已配置**模式一条：credentialId / mode /
// maskedIdentifier / status / expiresAt? / lastUsedAt?）。据此逐行映射产品要求的两行并列卡片；未配置的模式不在
// 数组里 → 渲染「○ 未配置 + [配置]」。吊销 credentialId 直接取该行 credentials[].credentialId。
import type {
  RuntimeDto,
  RuntimeCredentialSummary,
  CredentialSummaryStatus,
  RuntimeAuthMethod,
  RuntimeAuthMode,
  ExpiryState,
  AuthModeRow,
  RuntimeCredentialCardModel,
} from '@/types/runtimeCredential';
import { formatDaysLeft } from '@/lib/credentialExpiry';

const ACCOUNT_METHODS: RuntimeAuthMethod[] = ['oauth-device', 'setup-token'];

/** 帐号授权类方式（oauth-device / setup-token）→ 'account'；api-key → 'api-key'。 */
export function methodToMode(method: RuntimeAuthMethod): RuntimeAuthMode {
  return method === 'api-key' ? 'api-key' : 'account';
}

/** 从 authMethods 里取帐号授权方式（oauth-device 优先），无则 null。 */
export function accountMethodOf(runtime: RuntimeDto): RuntimeAuthMethod | null {
  return runtime.authMethods.find((m) => ACCOUNT_METHODS.includes(m)) ?? null;
}

/** credentials[].status → 视图有效期状态（ok→ok / expiring→warning / expired→expired）。 */
function summaryStatusToExpiry(status: CredentialSummaryStatus): ExpiryState {
  if (status === 'expiring') return 'warning';
  if (status === 'expired') return 'expired';
  return 'ok';
}

function mapModeRow(
  runtime: RuntimeDto,
  mode: RuntimeAuthMode,
  method: RuntimeAuthMethod,
  now: number,
): AuthModeRow {
  const active = runtime.activeAuthMethod === mode;
  // 已配置明细来自 credentials[]（未配置的模式不在数组里）。
  const summary: RuntimeCredentialSummary | undefined = runtime.credentials.find(
    (c) => c.mode === mode,
  );
  if (summary === undefined) {
    return {
      mode,
      method,
      label: mode === 'account' ? '帐号授权' : 'API Key',
      configured: false,
      active,
      expiryState: 'noExpiry',
    };
  }
  // API Key 无过期时间 → 不渲染倒计时（F21-3 §9）；帐号授权才展示「剩 N 天」。
  const showExpiry = mode === 'account' && summary.expiresAt !== undefined;
  return {
    mode,
    method,
    label: mode === 'account' ? '帐号授权' : 'API Key',
    configured: true,
    active,
    maskedIdentifier: summary.maskedIdentifier,
    credentialId: summary.credentialId,
    ...(showExpiry ? { expiryLabel: formatDaysLeft(summary.expiresAt, now) } : {}),
    expiryState: summaryStatusToExpiry(summary.status),
  };
}

/** 派生 runtime 凭证卡片视图模型：按可用方式渲染 帐号授权 / API Key 两行。 */
export function runtimeCardModel(
  runtime: RuntimeDto,
  now: number = Date.now(),
): RuntimeCredentialCardModel {
  const rows: AuthModeRow[] = [];
  const accountMethod = accountMethodOf(runtime);
  if (accountMethod !== null) {
    rows.push(mapModeRow(runtime, 'account', accountMethod, now));
  }
  if (runtime.authMethods.includes('api-key')) {
    rows.push(mapModeRow(runtime, 'api-key', 'api-key', now));
  }
  return {
    runtimeId: runtime.id,
    displayName: runtime.displayName,
    vendor: runtime.vendor,
    status: runtime.credentialStatus,
    rows,
    hasAnyCredential: rows.some((r) => r.configured),
  };
}

/** ◉/○ 切模式的判定（F21-3 §5，可单测）：目标已配置 → 走确认弹层切换；未配置 → 就地补配（不报错）。 */
export type SwitchModeDecision =
  | { kind: 'confirm'; mode: RuntimeAuthMode }
  | { kind: 'needs-setup'; mode: RuntimeAuthMode; method: RuntimeAuthMethod };

export function switchModeDecision(
  card: RuntimeCredentialCardModel,
  targetMode: RuntimeAuthMode,
): SwitchModeDecision | null {
  const row = card.rows.find((r) => r.mode === targetMode);
  if (row === undefined || row.active) return null; // 已生效或无该模式 → 无操作
  // 切到未配置模式：返回 needsSetup（就地展开配置面板，**不直接报错**，后端 409 也不透传，F21-3 §5）。
  return row.configured
    ? { kind: 'confirm', mode: targetMode }
    : { kind: 'needs-setup', mode: targetMode, method: row.method };
}

/**
 * [吊销] 确认文案（**P0-4，与后端 05 §4 同源**）：吊销延迟语义必须明示——env 形态注入进程后外部无法 unset，
 * 联动是强制重启/销毁这些 Task 而非「删文件」，不能给用户「吊销即刻失效、无残留」的错觉。
 */
export const RUNTIME_REVOKE_WARNING =
  '吊销会重启正在使用该凭证的运行实例；已泄漏到沙箱外的 token 无法追回。';

/** 切模式确认文案（切到已配置模式，VS-1）。 */
export function switchModeConfirmText(mode: RuntimeAuthMode): string {
  return mode === 'api-key'
    ? '切换后新任务将使用 API Key（按量计费），已运行任务不受影响。'
    : '切换后新任务将使用帐号授权（订阅额度），已运行任务不受影响。';
}

/** [吊销] 二次确认配置（F21-3 §5/§6，可单测）：吊销生效中模式额外警示「该模式将不可用」。 */
export interface RevokeConfirmConfig {
  runtimeId: string;
  mode: RuntimeAuthMode;
  method: RuntimeAuthMethod;
  /** 吊销的是否为当前生效模式（true → 额外提示「该模式将不可用」，F21-3 §5）。 */
  warnActiveMode: boolean;
  /** 另一模式是否已配置（生效模式吊销后可询问是否切过去，F21-3 §5）。 */
  otherModeConfigured: boolean;
}

export function revokeConfirmConfig(
  card: RuntimeCredentialCardModel,
  mode: RuntimeAuthMode,
): RevokeConfirmConfig | null {
  const row = card.rows.find((r) => r.mode === mode);
  if (row === undefined) return null;
  const other = card.rows.find((r) => r.mode !== mode);
  return {
    runtimeId: card.runtimeId,
    mode,
    method: row.method,
    warnActiveMode: row.active,
    otherModeConfigured: other?.configured ?? false,
  };
}
