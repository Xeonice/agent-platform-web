// Runtime 鉴权三分支状态机（07 §6.2/§6.4，可单测）：discriminated union + 纯 reducer。
// A device-code（Codex，begin→轮询）/ B setup-token（Claude Code，begin→粘贴 code→complete）/
// C api-key（两 runtime 通用，直存 secret）。倒计时/轮询调度在 hook 层（副作用），本文件零副作用、零网络。
import type { AuthChallenge, RuntimeAuthMethod } from '@/types/runtimeCredential';

/** 三分支判别键（= 鉴权方式归类；device-code=oauth-device，setup-token，api-key）。 */
export type AuthBranch = 'device-code' | 'setup-token' | 'api-key';

/** 方式 → 分支。 */
export function branchOfMethod(method: RuntimeAuthMethod): AuthBranch {
  if (method === 'oauth-device') return 'device-code';
  if (method === 'setup-token') return 'setup-token';
  return 'api-key';
}

/** 三分支统一状态（discriminated union on branch + phase）。 */
export type AuthFlowState =
  // —— A · device-code ——
  | { branch: 'device-code'; phase: 'idle' }
  | { branch: 'device-code'; phase: 'starting' }
  | { branch: 'device-code'; phase: 'polling'; challenge: AuthChallenge; pollError: boolean }
  | { branch: 'device-code'; phase: 'success'; maskedIdentifier?: string }
  | { branch: 'device-code'; phase: 'expired'; challenge: AuthChallenge }
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
  | { type: 'POLL_EXPIRED' }
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
      // 连续网络错误只标记 pollError（不消耗设备码倒计时，P22 §2），仍停在 polling。
      if (state.phase !== 'polling') return state;
      return { ...state, pollError: true };
    case 'POLL_EXPIRED':
      if (state.phase !== 'polling') return state;
      return { branch: 'device-code', phase: 'expired', challenge: state.challenge };
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

/** api-key 前缀（前端即时格式提示，权威判定在后端，07 §6.2）：Codex sk- / Claude Code sk-ant-。 */
export function apiKeyExpectedPrefix(runtimeId: string): string {
  return runtimeId === 'claude-code' ? 'sk-ant-' : 'sk-';
}

/** api-key 前缀是否匹配（仅格式提示；空串不提示）。 */
export function apiKeyPrefixValid(runtimeId: string, key: string): boolean {
  if (key === '') return true;
  return key.startsWith(apiKeyExpectedPrefix(runtimeId));
}
