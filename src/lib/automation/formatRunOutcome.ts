// 运行结果 → 界面上的一格（F21-7 §6 状态矩阵 / §7.1 / 03 §8.2 决策表逐条对齐）。
//
// ★ **这个文件存在的唯一理由：8 个 status 不是一条从好到坏的刻度尺。**
//   `automation_runs.status` 的取值是 pending / running / success / failed / timeout /
//   resource-exhausted / skipped / missed —— 把它们排成一列彩色徽章，用户会把后四个
//   全读成"出问题了"，然后去查一个根本不存在的故障。它们其实分属四件不同的事：
//
//   | 归类        | status                          | 发生了什么              | 用户要做什么 |
//   |------------|----------------------------------|------------------------|-------------|
//   | 有结果·好   | success                          | 跑完了，成功            | 无 |
//   | 有结果·坏   | failed / timeout                 | **真的跑了，跑挂了**     | 看原因；这类才算失败 |
//   | 还没有结果  | pending / running / resource-exhausted | 还在路上（排队 n/5）| 等 |
//   | **没有跑**  | skipped / missed                 | 这次压根没触发           | 跳过看原因；missed 什么都不用做 |
//
//   ⚠️ **`failed` 自己还要再分一次**（见下面那个 `case`）：带 `errorCode:'RESOURCE_EXHAUSTED'`
//   的那一支是"排了 5 次队仍没资源、放弃了"，它**算一次失败但根本没跑起来** ——
//   横跨了上表第 2 行与第 4 行，是这张表唯一一个不能只看 `status` 就归类的取值。
//
//   ⚠️ **`missed` 是最容易被误读的一个**：它的意思是"调度器当时没在运行，错过了这个时刻"，
//   既不是规则的错，也没有产生任何执行。按 03 §8.2 它**不补跑**（补跑会让凌晨任务在中午执行）。
//   所以它的文案必须把"平台的问题"和"不会补跑"两件事都说出来，
//   ⛔ 绝不能只给一个 ⏸️ 图标了事 —— 那和"手动禁用"长得一模一样。
//
//   ⚠️ 界面上区分这四类的**硬判据是 `countsTowardFailure`**，不是配色：只有它为真的那两个
//   会把规则推向降频/自动禁用（P21-7 §4 计数口径）。配色是给眼睛的，这个布尔是给逻辑的。
import {
  AUTOMATION_MAX_RETRIES,
  DEGRADE_AFTER_FAILURES,
  type AutomationRunDto,
  type RunOutcome,
} from '@/types/automation';

/** 两种 skipped 的原因文案。**必须不同** —— 一个要用户去重新授权，另一个什么都不用做。 */
const SKIP_DETAIL: Record<string, string> = {
  AUTH_EXPIRED: '这个 Agent 的凭证已过期或被吊销，本次没有触发。重新授权后会按原来的时间表继续。',
  PREVIOUS_RUNNING: '上一次触发的任务当时还在跑，按「跳过」的策略这次没有再起一个。',
};

export function formatRunOutcome(run: {
  status: AutomationRunDto['status'];
  retryCount?: number;
  errorCode?: string | undefined;
}): RunOutcome {
  switch (run.status) {
    case 'success':
      return {
        category: 'success',
        icon: '✅',
        label: '成功',
        detail: '任务跑完了，成功。之前累计的失败次数已经清零。',
        countsTowardFailure: false,
      };

    /**
     * ★ **`failed` 有两支，判据是 `errorCode`。**
     *
     * `automation.scheduler.ts` 的 `queueOrGiveUp` 写得很清楚：排队 5 次仍拿不到资源
     * ⇒ `finalize('failed', { errorCode: 'RESOURCE_EXHAUSTED' })`，且这一次**计入**
     * 连续失败。可这一支**根本没跑起来** —— 没有容器、没有 Agent、没有一行输出。
     * 此前这里不读 `errorCode`，于是它和"跑了然后挂了"共用一句「任务真的跑了但失败了」，
     * 而那句话对这一支是**假的**：用户会去翻一份不存在的日志找一个不存在的报错。
     *
     * ⚠️ 两支都 `countsTowardFailure: true` —— 后端确实记了这一笔（`applyOutcome(…,'failed')`），
     * ⛔ 界面不许替它改口径。要区分的是**发生了什么**，不是**算不算数**。
     */
    case 'failed':
      if (run.errorCode === 'RESOURCE_EXHAUSTED') {
        return {
          category: 'failure',
          icon: '❌',
          label: '没排到资源',
          detail: `一直没排到资源，等了 ${String(AUTOMATION_MAX_RETRIES)} 次还是没跑起来，这一次就不再等了。任务没有真正开始，所以没有输出可看。这次算一次失败：累计 ${String(DEGRADE_AFTER_FAILURES)} 次会自动放慢（每天只试一次）。`,
          countsTowardFailure: true,
        };
      }
      return {
        category: 'failure',
        icon: '❌',
        label: '失败',
        detail: `任务真的跑起来了，但没跑成。这次算一次失败：累计 ${String(DEGRADE_AFTER_FAILURES)} 次会自动放慢（每天只试一次）。`,
        countsTowardFailure: true,
      };

    case 'timeout':
      // 超时是失败的一种（03 §8.3：run 记 timeout 并计入 consecutive_failures），
      // 但原因完全不同 —— 用户该做的是调大超时档位，不是查代码。
      return {
        category: 'failure',
        icon: '❌',
        label: '超时',
        detail:
          '跑到了规则里设的最长运行时间，被强制结束，按失败处理。这次算一次失败；' +
          '可以在规则里把最长运行时间调大一档。',
        countsTowardFailure: true,
      };

    case 'resource-exhausted': {
      const n = run.retryCount ?? 0;
      return {
        category: 'waiting',
        icon: '⚠️',
        label: `排队重试中 ${String(n)}/${String(AUTOMATION_MAX_RETRIES)}`,
        detail: `触发的时候没有空闲资源，正在按 24 分钟一次的间隔排队重试（最多 ${String(AUTOMATION_MAX_RETRIES)} 次）。还没有结果，这次不算失败。`,
        countsTowardFailure: false,
      };
    }

    case 'skipped': {
      const detail =
        run.errorCode !== undefined && run.errorCode in SKIP_DETAIL
          ? SKIP_DETAIL[run.errorCode]
          : undefined;
      return {
        category: 'skipped',
        icon: '⏭️',
        label: '跳过',
        // ⏳ 后端补上 error_code 之前只能给通用文案（契约缺口见 types/automation 文件头）。
        detail: `${detail ?? '这次没有触发（后端没有下发原因）。'}这次没有执行，不算失败。`,
        countsTowardFailure: false,
      };
    }

    case 'missed':
      return {
        category: 'missed',
        icon: '🕳️',
        label: '错过',
        detail:
          '平台的定时调度当时没在运行，错过了这个时刻。这不是规则的问题；按设计也不会补跑（补跑会让凌晨的任务在中午执行）。这次不算失败。',
        countsTowardFailure: false,
      };

    case 'running':
      return {
        category: 'running',
        icon: '⏳',
        label: '运行中',
        detail: '任务正在跑。',
        countsTowardFailure: false,
      };

    case 'pending':
      return {
        category: 'waiting',
        icon: '⏳',
        label: '待执行',
        detail: '已经触发，正在创建任务。',
        countsTowardFailure: false,
      };
  }
}

/**
 * webhook 投递结果的旁注。
 * ★ 必须带上"不影响规则状态"这半句（P21-7 §7 / §9.1 #30）：否则一条 `failed` 的投递
 *   会被读成"规则又失败了一次"，而 webhook 只是旁路通知，投递失败改变不了规则的任何状态。
 */
export function describeWebhookStatus(status: string | undefined): string | undefined {
  switch (status) {
    case 'sent':
      return 'Webhook 通知已送达。';
    case 'failed':
      return 'Webhook 通知没发出去（重试 2 次后放弃）。只是通知没送到，规则本身的状态不受影响。';
    case 'skipped':
      return '按这条规则「什么时候发通知」的设置，这次不发 Webhook。';
    default:
      return undefined;
  }
}

/** `1 分 12 秒` / `840 毫秒`。`undefined` → 缺席（未结束 / 后端没给）。 */
export function formatDuration(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 1000) return `${String(Math.round(durationMs))} 毫秒`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)} 秒`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${String(minutes)} 分 ${String(seconds)} 秒`;
  return `${String(hours)} 小时 ${String(minutes % 60)} 分`;
}
