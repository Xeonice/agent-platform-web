// Runtime 鉴权三分支状态机（07 §6.2/§6.4，可单测）：discriminated union + 纯 reducer。
// A device-code（Codex，begin→轮询）/ B setup-token（Claude Code，begin→粘贴 code→complete）/
// C api-key（两 runtime 通用，直存 secret）。倒计时/轮询调度在 hook 层（副作用），本文件零副作用、零网络。
import type { AuthChallenge, RuntimeAuthMethod } from '@/types/runtimeCredential';

/** 三分支判别键（= 鉴权方式归类；device-code=oauth-device，setup-token，api-key）。 */
export type AuthBranch = 'device-code' | 'setup-token' | 'api-key';

/**
 * 方式 → 分支。
 *
 * ⚠️ **2026-09-08：`RuntimeAuthMethod` 已经是四值集。** 后端打通 `access-token-paste`
 * 之后（04 §8 ★8a），`authMethods` 下发的就是完整闭集，本函数此前那句「入参仅接受三值集、
 * 四值集不要喂进来」的前提**不再成立** —— 而 `access-token-paste` 会落进 `default`，
 * 被 `console.error` + 静默归到 api-key 分支，正是那条注释自己说要防的「配错鉴权方式」。
 *
 * ⇒ 现在它有一条**显式**归并：`access-token-paste` 与 `api-key` 共用「粘贴一个字符串并直存」
 * 这条交互（后端也把两者收在同一个 `submitSecret` 端点，`RUNTIME_SECRET_METHODS`）。
 * ⛔ **但它们落库后的 `mode` 不同**（`api-key` → `api-key`；`access-token-paste` → `account`，
 * 13 §2.5.1），所以**提交时必须带上真实 method**，不能因为共用分支就发 `'api-key'`。
 *
 * `default` 仍然保留：闭集将来再加值时，要的是一条响亮的报错而不是静默兜底。
 */
export function branchOfMethod(method: RuntimeAuthMethod): AuthBranch {
  switch (method) {
    case 'oauth-device':
      return 'device-code';
    case 'setup-token':
      return 'setup-token';
    // `access-token-paste` 与 `api-key` 共用这一支（粘贴 → 直存同一条交互）；
    // 区别只在提交时带的 method 与落库后的 mode，见上方注释。
    case 'api-key':
    case 'access-token-paste':
      return 'api-key';
    default:
      // 闭集加了新值而这里没跟 —— 要的是响亮报错，不是静默归到某一支。
      // `String()` 在这里是必要的：四个值都被上面穷尽后，此处 `method` 的类型是 `never`。
      console.error(
        `branchOfMethod: 未知鉴权方式「${String(method)}」——RUNTIME_AUTH_METHODS 加了新值而前端没跟，` +
          `请补一条分支而不是让它落到这里。`,
      );
      return 'api-key';
  }
}

/** 三分支统一状态（discriminated union on branch + phase）。 */
export type AuthFlowState =
  // —— A · device-code ——
  | { branch: 'device-code'; phase: 'idle' }
  | { branch: 'device-code'; phase: 'starting' }
  | { branch: 'device-code'; phase: 'polling'; challenge: AuthChallenge; pollError: boolean }
  | { branch: 'device-code'; phase: 'success'; maskedIdentifier?: string }
  | {
      branch: 'device-code';
      phase: 'expired';
      challenge: AuthChallenge;
      /**
       * **为什么停下来的** —— 两种情况，说法不同（P0）：
       *  · `'expired'`  设备码真的到点了（服务端说 expired，或倒计时归零）。
       *  · `'gave-up'`  前端 10 分钟硬性兜底（`MAX_POLL_DURATION_MS`）触发 —— 这是**我们**不等了，
       *    码**可能完全没过期**。把它也说成「设备码已过期」，会让用户去重新获取一个其实还能用的码，
       *    也掩盖了真正的毛病（后端漏发 expiresAt / 授权回程根本没通）。
       */
      reason: 'expired' | 'gave-up';
    }
  | { branch: 'device-code'; phase: 'error'; message: string }
  // —— B · setup-token ——
  | { branch: 'setup-token'; phase: 'idle' }
  | { branch: 'setup-token'; phase: 'starting' }
  | {
      branch: 'setup-token';
      phase: 'awaiting-paste';
      challenge: AuthChallenge;
      submitting: boolean;
      error?: string;
    }
  | { branch: 'setup-token'; phase: 'success'; maskedIdentifier?: string }
  | { branch: 'setup-token'; phase: 'error'; message: string }
  // —— C · api-key ——
  | { branch: 'api-key'; phase: 'idle' }
  | { branch: 'api-key'; phase: 'submitting' }
  | { branch: 'api-key'; phase: 'success'; maskedIdentifier?: string }
  | { branch: 'api-key'; phase: 'rejected'; message: string; reasons: string[] };

export type AuthFlowAction =
  | { type: 'BEGIN_START' }
  | { type: 'BEGIN_SUCCESS'; challenge: AuthChallenge }
  | { type: 'BEGIN_ERROR'; message: string }
  | { type: 'POLL_PENDING' }
  | { type: 'POLL_NETWORK_ERROR' }
  | { type: 'POLL_FAILED'; message: string }
  | { type: 'POLL_EXPIRED' }
  /** 前端硬性上限到点：**我们不等了**，不等于码过期了。 */
  | { type: 'POLL_GAVE_UP' }
  | { type: 'PASTE_SUBMIT_START' }
  | { type: 'PASTE_SUBMIT_ERROR'; message: string }
  | { type: 'APIKEY_SUBMIT_START' }
  | { type: 'APIKEY_REJECTED'; message: string; reasons: string[] }
  | { type: 'SUCCESS'; maskedIdentifier?: string }
  | { type: 'RESET' };

/** 分支初始态（idle）。 */
export function initialAuthFlowState(branch: AuthBranch): AuthFlowState {
  return { branch, phase: 'idle' };
}

/** 纯 reducer：只做状态迁移，不触网、不计时。非法（分支/phase 不匹配的）action 原样返回。 */
export function authFlowReducer(state: AuthFlowState, action: AuthFlowAction): AuthFlowState {
  if (action.type === 'RESET') return initialAuthFlowState(state.branch);
  if (action.type === 'SUCCESS') {
    const masked = action.maskedIdentifier;
    return masked !== undefined
      ? { branch: state.branch, phase: 'success', maskedIdentifier: masked }
      : { branch: state.branch, phase: 'success' };
  }

  switch (state.branch) {
    case 'device-code':
      return deviceReducer(state, action);
    case 'setup-token':
      return setupTokenReducer(state, action);
    case 'api-key':
      return apiKeyReducer(state, action);
  }
}

function deviceReducer(
  state: Extract<AuthFlowState, { branch: 'device-code' }>,
  action: AuthFlowAction,
): AuthFlowState {
  switch (action.type) {
    case 'BEGIN_START':
      // 允许从 idle / expired / error 重新发起（[重新获取] 重走 begin）。
      return { branch: 'device-code', phase: 'starting' };
    case 'BEGIN_SUCCESS':
      return {
        branch: 'device-code',
        phase: 'polling',
        challenge: action.challenge,
        pollError: false,
      };
    case 'BEGIN_ERROR':
      return { branch: 'device-code', phase: 'error', message: action.message };
    case 'POLL_PENDING':
      if (state.phase !== 'polling') return state;
      return { ...state, pollError: false };
    case 'POLL_NETWORK_ERROR':
      // 连续网络错误只标记 pollError（不消耗设备码倒计时，P22 §2），仍停在 polling（瞬时可重试）。
      if (state.phase !== 'polling') return state;
      return { ...state, pollError: true };
    case 'POLL_FAILED':
      // 后端 status==='error' 是**终态**（device 登录被拒 / helper 崩），非网络抖动：停止轮询、转失败态，
      // 由面板给「再次登录」入口（P1-a）。区别于 POLL_NETWORK_ERROR（瞬时、留在 polling）。
      if (state.phase !== 'polling') return state;
      return { branch: 'device-code', phase: 'error', message: action.message };
    case 'POLL_EXPIRED':
      if (state.phase !== 'polling') return state;
      return {
        branch: 'device-code',
        phase: 'expired',
        challenge: state.challenge,
        reason: 'expired',
      };
    case 'POLL_GAVE_UP':
      if (state.phase !== 'polling') return state;
      return {
        branch: 'device-code',
        phase: 'expired',
        challenge: state.challenge,
        reason: 'gave-up',
      };
    default:
      return state;
  }
}

function setupTokenReducer(
  state: Extract<AuthFlowState, { branch: 'setup-token' }>,
  action: AuthFlowAction,
): AuthFlowState {
  switch (action.type) {
    case 'BEGIN_START':
      return { branch: 'setup-token', phase: 'starting' };
    case 'BEGIN_SUCCESS':
      return {
        branch: 'setup-token',
        phase: 'awaiting-paste',
        challenge: action.challenge,
        submitting: false,
      };
    case 'BEGIN_ERROR':
      return { branch: 'setup-token', phase: 'error', message: action.message };
    case 'PASTE_SUBMIT_START':
      if (state.phase !== 'awaiting-paste') return state;
      return { ...state, submitting: true, error: undefined };
    case 'PASTE_SUBMIT_ERROR':
      if (state.phase !== 'awaiting-paste') return state;
      return { ...state, submitting: false, error: action.message };
    default:
      return state;
  }
}

function apiKeyReducer(
  state: Extract<AuthFlowState, { branch: 'api-key' }>,
  action: AuthFlowAction,
): AuthFlowState {
  switch (action.type) {
    case 'APIKEY_SUBMIT_START':
      return { branch: 'api-key', phase: 'submitting' };
    case 'APIKEY_REJECTED':
      // 就地红字 + 可能原因列表，不弹层（07 §6.2）。
      return {
        branch: 'api-key',
        phase: 'rejected',
        message: action.message,
        reasons: action.reasons,
      };
    default:
      return state;
  }
}

// ————————————————————————————————————————————————————————————————
// api-key 前缀提示（前端即时格式提示，权威判定始终在后端，07 §6.2）
// ————————————————————————————————————————————————————————————————
//
// ⚠️ **前缀是 runtime 的属性，不是前端能推断的知识。** 这里曾经写着
// `runtimeId === 'claude-code' ? 'sk-ant-' : 'sk-'` —— 全仓唯一一处拿 runtimeId 跟字面量比。
// runtime 是**开放注册表**（04 §3），第三方注册的 runtime 全都掉进 `sk-` 那一支：
// 用户粘一个完全合法的 key，输入框红边 + 「Key 应以 sk- 开头」，而 [保存并继续] 是**禁用**的
// ——不是"提示错了"，是**根本提交不了**。
//
// ⇒ 现在由**调用方把前缀传进来**（后端 `RuntimeDto.apiKeyPrefix`，04 §3 ★3z 的 adapter
//   自描述元数据）。下面那张内置表是**过渡回落**，不是新的权威。

/**
 * 期望前缀：**完全由 runtime 自己声明**（`RuntimeDto.apiKeyPrefix`，04 §3 ★3z）。
 *
 * ⚠️ **没声明 ⇒ 不提示前缀**，而不是猜一个。这是本函数唯一的两种情形，
 * 也是 2026-09-08 那张过渡回落表被删掉之后剩下的全部逻辑 ——
 * 那张表把 `claude-code → sk-ant-`、其余 `→ sk-` 写死在前端，
 * 于是任何第三方 runtime 的合法 key 都会被判红边、且 [保存并继续] **禁用**。
 *
 * ⛔ **不要再引入任何按 runtimeId 分支的默认值。** 前缀是 vendor 事实，
 * 只有 adapter 知道；前端猜错的代价是「合法凭证提交不了」，比不提示严重得多。
 */
export function apiKeyExpectedPrefix(apiKeyPrefix: string | undefined): string {
  return apiKeyPrefix ?? '';
}

/**
 * 前缀是否匹配（仅格式提示；空串不提示）。
 * ⚠️ 吃的是**已解析出的前缀**而不是 runtimeId：解析口径只有 `apiKeyExpectedPrefix` 一处，
 * 否则"提示里说要 X 开头"与"按 Y 判红边"会各解析一次、迟早说两句不一样的话。
 */
export function apiKeyPrefixValid(expectedPrefix: string, key: string): boolean {
  if (key === '') return true;
  return key.startsWith(expectedPrefix);
}
