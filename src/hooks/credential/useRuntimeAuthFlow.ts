// Runtime 鉴权三分支状态机 hook（07 §6.4）：驱动 lib/authFlow 纯 reducer + 轮询/倒计时副作用（归 hook 层）。
// 凭证明文（粘贴 code / api-key）不在本 hook 持有——由 AuthGateContainer 局部 useState 传入，提交即清空（15 §3.5）。
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  authFlowReducer,
  branchOfMethod,
  initialAuthFlowState,
  apiKeyExpectedPrefix,
  apiKeyPrefixValid,
  type AuthFlowState,
} from '@/lib/credential/authFlow';
import {
  beginAuth,
  pollAuthStatus,
  completeAuth,
  saveSecret,
} from '@/services/api/runtime.service';
import { ApiErrorException } from '@/services/api/apiError';
import type { RuntimeAuthMethod } from '@/types/runtimeCredential';

/** device-code 轮询间隔（3–5s 区间取值；防过度轮询，12 §4.2 用例组 B）。 */
const POLL_INTERVAL_MS = 3_000;

/**
 * device-code 轮询硬性上限（10min）：与 challenge.expiresAt 无关的兜底。
 * expiresAt 在 openapi AuthChallengeResponseDto 里**非 required**，后端漏发时倒计时/过期 effect 都短路，
 * 终止不能只依赖这一个可选字段——超过本上限强制转 expired，杜绝无限轮询假死（P1-a）。
 */
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;

/** 配置成功结果（掩码帐号）：complete/secret 必回掩码，device-code 轮询成功可能省略 → 掩码可选。 */
export interface AuthSuccess {
  maskedIdentifier?: string;
}

export interface UseRuntimeAuthFlowArgs {
  runtimeId: string;
  method: RuntimeAuthMethod;
  /** 配置成功回调（掩码帐号）：container 负责 invalidate runtime 查询 + toast + 面板收起/进确认步。 */
  onSuccess?: (result: AuthSuccess) => void;
}

export interface RuntimeAuthFlow {
  state: AuthFlowState;
  /** device-code 剩余秒数（仅 polling/expired 有意义）。 */
  secondsLeft: number;
  /** api-key 期望前缀（前端格式提示）。 */
  expectedPrefix: string;
  /** api-key 前缀是否合法（格式提示，权威判定在后端）。 */
  isApiKeyPrefixValid: (key: string) => boolean;
  /** 帐号授权：发起挑战（device-code / setup-token）。 */
  begin: () => void;
  /** device-code 过期后 [重新获取]：重走 begin。 */
  refetchChallenge: () => void;
  /** setup-token：提交回贴的授权码。 */
  submitPaste: (pastedText: string) => void;
  /** api-key：直存 secret。 */
  submitApiKey: (secret: string) => void;
  reset: () => void;
}

function reasonsFromError(error: unknown): string[] {
  if (error instanceof ApiErrorException) {
    const details = error.envelope.details;
    if (details !== undefined && details.length > 0) {
      // details 项为无类型 record（生成物 { [key: string]: unknown }[]），只取字符串 message。
      const messages = details
        .map((d) => d['message'])
        .filter((m): m is string => typeof m === 'string' && m !== '');
      if (messages.length > 0) return messages;
    }
  }
  return ['凭证格式错误、无权限或额度不足，请检查后重试。'];
}

function messageFromError(error: unknown, fallback: string): string {
  return error instanceof ApiErrorException && error.envelope.message !== ''
    ? error.envelope.message
    : fallback;
}

export function useRuntimeAuthFlow({
  runtimeId,
  method,
  onSuccess,
}: UseRuntimeAuthFlowArgs): RuntimeAuthFlow {
  const branch = branchOfMethod(method);
  const [state, dispatch] = useReducer(authFlowReducer, branch, initialAuthFlowState);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // latest-ref：回调引用抖动不重启轮询/计时。
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const succeed = useCallback((result: AuthSuccess): void => {
    dispatch(
      result.maskedIdentifier !== undefined
        ? { type: 'SUCCESS', maskedIdentifier: result.maskedIdentifier }
        : { type: 'SUCCESS' },
    );
    onSuccessRef.current?.(result);
  }, []);

  // —— begin（device-code / setup-token）——
  const begin = useCallback((): void => {
    if (branch === 'api-key') return;
    dispatch({ type: 'BEGIN_START' });
    void beginAuth(runtimeId, branch === 'device-code' ? 'oauth-device' : 'setup-token')
      .then((challenge) => {
        dispatch({ type: 'BEGIN_SUCCESS', challenge });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'BEGIN_ERROR',
          message: messageFromError(error, '发起授权失败，请重试。'),
        });
      });
  }, [branch, runtimeId]);

  const refetchChallenge = begin;

  // —— setup-token: 提交粘贴的授权码 ——
  const submitPaste = useCallback(
    (pastedText: string): void => {
      if (state.branch !== 'setup-token' || state.phase !== 'awaiting-paste') return;
      const challengeRef = state.challenge.challengeRef;
      dispatch({ type: 'PASTE_SUBMIT_START' });
      void completeAuth(runtimeId, challengeRef, pastedText)
        .then((result) => {
          succeed(result);
        })
        .catch((error: unknown) => {
          dispatch({
            type: 'PASTE_SUBMIT_ERROR',
            message: messageFromError(error, '授权码无效或已过期，请重新获取后粘贴。'),
          });
        });
    },
    [state, runtimeId, succeed],
  );

  // —— api-key: 直存 secret ——
  const submitApiKey = useCallback(
    (secret: string): void => {
      if (branch !== 'api-key') return;
      dispatch({ type: 'APIKEY_SUBMIT_START' });
      void saveSecret(runtimeId, secret)
        .then((result) => {
          succeed(result);
        })
        .catch((error: unknown) => {
          dispatch({
            type: 'APIKEY_REJECTED',
            message: messageFromError(error, '凭证被拒绝，请检查后重试。'),
            reasons: reasonsFromError(error),
          });
        });
    },
    [branch, runtimeId, succeed],
  );

  const reset = useCallback((): void => {
    dispatch({ type: 'RESET' });
  }, []);

  // —— device-code 轮询：phase==='polling' 期间每 POLL_INTERVAL_MS 拉一次 status ——
  const isPolling = state.branch === 'device-code' && state.phase === 'polling';
  const challengeRef =
    state.branch === 'device-code' && state.phase === 'polling'
      ? state.challenge.challengeRef
      : null;

  useEffect(() => {
    if (!isPolling || challengeRef === null) return;
    let cancelled = false;
    const poll = (): void => {
      void pollAuthStatus(runtimeId, challengeRef)
        .then((res) => {
          if (cancelled) return;
          if (res.status === 'success') {
            succeed({
              ...(res.maskedIdentifier !== undefined
                ? { maskedIdentifier: res.maskedIdentifier }
                : {}),
            });
          } else if (res.status === 'expired') {
            dispatch({ type: 'POLL_EXPIRED' });
          } else if (res.status === 'error') {
            // 后端终态 error（device 登录被拒 / helper 崩）：停止轮询、转失败态、给「再次登录」入口。
            // 区别于下方 catch 的**瞬时网络请求异常**（fetch 抛错）——那种才留在 polling 重试（P1-a）。
            dispatch({
              type: 'POLL_FAILED',
              message: '授权失败：登录被拒绝或授权助手异常，请再次登录。',
            });
          } else {
            dispatch({ type: 'POLL_PENDING' });
          }
        })
        .catch(() => {
          if (cancelled) return;
          // 网络请求异常（瞬时）只标记，不消耗设备码倒计时、不终止轮询（P22 §2）。
          dispatch({ type: 'POLL_NETWORK_ERROR' });
        });
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    // 硬性兜底：与 expiresAt（非 required）无关的强制上限，防后端漏发 expiresAt → 无限轮询假死（P1-a）。
    const hardStop = setTimeout(() => {
      if (cancelled) return;
      dispatch({ type: 'POLL_EXPIRED' });
    }, MAX_POLL_DURATION_MS);
    return (): void => {
      cancelled = true;
      clearInterval(timer);
      clearTimeout(hardStop);
    };
  }, [isPolling, challengeRef, runtimeId, succeed]);

  // —— 倒计时 tick（device-code polling/expired 期间每秒刷新 now，驱动 secondsLeft 与归零转红）——
  const expiresAt =
    state.branch === 'device-code' && (state.phase === 'polling' || state.phase === 'expired')
      ? state.challenge.expiresAt
      : undefined;

  useEffect(() => {
    if (expiresAt === undefined) return;
    setNowTick(Date.now());
    const timer = setInterval(() => {
      setNowTick(Date.now());
    }, 1_000);
    return (): void => {
      clearInterval(timer);
    };
  }, [expiresAt]);

  // 倒计时归零 → 客户端转 expired（服务端 expired 轮询也会触发；两者取先到）。
  const secondsLeft =
    expiresAt !== undefined
      ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - nowTick) / 1000))
      : 0;

  useEffect(() => {
    if (isPolling && expiresAt !== undefined && secondsLeft <= 0) {
      dispatch({ type: 'POLL_EXPIRED' });
    }
  }, [isPolling, expiresAt, secondsLeft]);

  return {
    state,
    secondsLeft,
    expectedPrefix: apiKeyExpectedPrefix(runtimeId),
    isApiKeyPrefixValid: (key: string) => apiKeyPrefixValid(runtimeId, key),
    begin,
    refetchChallenge,
    submitPaste,
    submitApiKey,
    reset,
  };
}
