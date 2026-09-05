import type { RuntimeDto } from '@/types/runtimeCredential';
import type {
  SubscriptionRuntimeModel,
  SubscriptionRuntimeState,
  SubscriptionStepModel,
} from '@/types/init';

/**
 * 初始化向导 Step 4「订阅配置」的判据（P21-8 §2）。
 *
 * ── 它回答的问题 ────────────────────────────────────────────────────────────
 * 前三步问的是「这台机器行不行」与「平台自己备齐了没有」。这一步问的是**用户自己的
 * 模型帐号配了没有** —— 少了它，八项诊断可以全绿、镜像可以就绪，而第一个任务照样发不出去。
 *
 * ⛔ **判据是「至少一个 runtime 可用」，不是「每个都可用」。** 一台只跑 codex 的机器不该被
 * claude-code 的空凭证挡住 —— 那会逼用户去配一个他根本不用的帐号，或者干脆学会无视这一步。
 * 「能不能发出第一个任务」这个真实门槛，只需要一个 runtime。
 */

const BLOCKED_TEXT =
  '⚠️ 跳过后平台能进、项目能建，但在配好至少一个模型帐号之前无法发起任何任务 —— agent 需要它才能调用模型。';

/**
 * ⚠️ **`expiring` 算可用。** 它说的是「快到期了」，不是「不能用了」；把它算成未就绪会在
 * 一台**完全能干活**的机器上挡住向导，而用户能做的只有重新授权一次——白付一次授权。
 * 到期的提醒归运行期的凭证管理页管（P21-3），不归首次部署这一步。
 */
export function subscriptionStepModel(runtimes: readonly RuntimeDto[]): SubscriptionStepModel {
  const models: SubscriptionRuntimeModel[] = runtimes.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    state: stateOf(r.credentialStatus),
    ...(r.maskedIdentifier === undefined ? {} : { maskedIdentifier: r.maskedIdentifier }),
    methods: r.authMethods,
  }));
  const ready = models.some((m) => m.state === 'ready');
  return {
    runtimes: models,
    ready,
    ...(ready ? {} : { blockedText: BLOCKED_TEXT }),
  };
}

function stateOf(status: RuntimeDto['credentialStatus']): SubscriptionRuntimeState {
  if (status === 'active' || status === 'expiring') return 'ready';
  if (status === 'expired') return 'expired';
  return 'none';
}
