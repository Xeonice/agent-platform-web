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
import { formatDaysLeft } from '@/lib/credential/credentialExpiry';

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
      label: mode === 'account' ? '帐号登录' : 'API Key',
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
    label: mode === 'account' ? '帐号登录' : 'API Key',
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
    apiKeyPrefix: runtime.apiKeyPrefix,
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
 * [删除] 确认文案（**P0-4，与后端 05 §4 同源**）：删除的延迟语义必须明示——env 形态注入进程后外部无法
 * unset，联动是强制重启/销毁这些任务而非「删文件」，不能给用户「删掉就即刻失效、无残留」的错觉。
 *
 * ⚠️ 措辞按 P21-3 术语表落到用户语境：「吊销」→「删除」、「运行实例」→「正在跑的任务」。
 */
export const RUNTIME_REVOKE_WARNING =
  '删除会重启正在用这份凭证跑的任务；已经被带出沙箱的 token，平台这边删不掉。';

/**
 * P0-4 的**下一步**（配 `RUNTIME_REVOKE_WARNING` 一起出现）。
 *
 * ⚠️ 上面那句原本是孤零零一条吓人的断言：说了「追不回来」，却没给用户任何**能做的事**。
 * 真正能作废一串已经流出去的 token 的地方只有签发它的厂商后台 —— 那句话必须带着这一条一起出现，
 * 否则它只是制造焦虑。可以排成次要行，但不能没有。
 */
export const RUNTIME_REVOKE_FOLLOW_UP =
  '担心已经外流的话，去签发这串凭证的厂商后台把它作废，那边才是唯一能真正吊销它的地方。';

/** 切「当前使用」的确认文案（切到已配置模式，VS-1）。 */
export function switchModeConfirmText(mode: RuntimeAuthMode): string {
  return mode === 'api-key'
    ? '之后新开的任务会用 API Key（按量计费），已经在跑的任务不受影响。'
    : '之后新开的任务会用帐号登录（走订阅额度），已经在跑的任务不受影响。';
}

/** 模式展示名（用户语境：不说「模式」，就说这两样东西本身）。 */
export function authModeLabel(mode: RuntimeAuthMode): string {
  return mode === 'api-key' ? 'API Key' : '帐号登录';
}

/** 切换弹层标题（术语表：「切换生效模式」→「切换到 X」）。 */
export function switchModeTitle(mode: RuntimeAuthMode): string {
  return `切换到${authModeLabel(mode)}`;
}

/**
 * 删除完之后、另一种登录方式已经配好时的追问（产品 §9）。
 *
 * ⚠️ 少了这一步的后果是**静默留下一个没有可用凭证的 Agent**：用户删掉了当前在用的那份，
 * 另一份明明就在那儿，界面却一个字都不说，下次发任务才撞上「未配置」。
 */
export function switchAfterRevokeText(mode: RuntimeAuthMode): string {
  return `这个 Agent 现在没有可用的凭证了。它的${authModeLabel(mode)}还留着 —— 要现在切过去用吗？`;
}

/**
 * Runtime 分区的存放承诺（产品 21-3 §3）。
 *
 * ⚠️ 这句话此前**只在 Git 分区底下有**，Agent 帐号区对「我的模型帐号存在哪」一个字都没说 ——
 * 而用户真正紧张的恰恰是模型帐号。两个分区共用页底那一条，这里再补一句就近的。
 */
export const RUNTIME_CREDENTIAL_STORAGE_NOTE =
  '凭证加密存在这台机器上，平台不会上传，也读不回明文。';

/** [吊销] 二次确认配置（F21-3 §5/§6，可单测）：吊销生效中模式额外警示「该模式将不可用」。 */
export interface RevokeConfirmConfig {
  runtimeId: string;
  mode: RuntimeAuthMode;
  method: RuntimeAuthMethod;
  /** 吊销的是否为当前生效模式（true → 额外提示「该模式将不可用」，F21-3 §5）。 */
  warnActiveMode: boolean;
  /** 另一模式是否已配置（当前使用的那份被删掉后可询问是否切过去，F21-3 §5 / 产品 §9）。 */
  otherModeConfigured: boolean;
  /**
   * 另一模式**是哪一个**（未配置或不存在该行 → null）。
   *
   * ⚠️ 只有 `otherModeConfigured` 这个布尔位时，「问不问」答得出来、「切到哪」答不出来 ——
   * 于是产品 §9 那一步根本没法接线（这正是它此前算出来却没人消费的原因之一）。
   */
  otherMode: RuntimeAuthMode | null;
}

export function revokeConfirmConfig(
  card: RuntimeCredentialCardModel,
  mode: RuntimeAuthMode,
): RevokeConfirmConfig | null {
  const row = card.rows.find((r) => r.mode === mode);
  if (row === undefined) return null;
  const other = card.rows.find((r) => r.mode !== mode);
  const otherConfigured = other?.configured ?? false;
  return {
    runtimeId: card.runtimeId,
    mode,
    method: row.method,
    warnActiveMode: row.active,
    otherModeConfigured: otherConfigured,
    otherMode: otherConfigured && other !== undefined ? other.mode : null,
  };
}
