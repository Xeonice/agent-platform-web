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
//   | 有结果·坏   | failed / timeout                 | **真的跑了，跑挂了**     | 看原因；这类才计入连续失败 |
//   | 还没有结果  | pending / running / resource-exhausted | 还在路上（排队 n/5）| 等 |
//   | **没有跑**  | skipped / missed                 | 这次压根没触发           | 跳过看原因；missed 什么都不用做 |
//
//   ⚠️ **`missed` 是最容易被误读的一个**：它的意思是"调度器当时没在运行，错过了这个时刻"，
//   既不是规则的错，也没有产生任何执行。按 03 §8.2 它**不补跑**（补跑会让凌晨任务在中午执行）。
//   所以它的文案必须把"平台的问题"和"不会补跑"两件事都说出来，
//   ⛔ 绝不能只给一个 ⏸️ 图标了事 —— 那和"手动禁用"长得一模一样。
//
//   ⚠️ 界面上区分这四类的**硬判据是 `countsTowardFailure`**，不是配色：只有它为真的那两个
//   会把规则推向降频/自动禁用（P21-7 §4 计数口径）。配色是给眼睛的，这个布尔是给逻辑的。
import { AUTOMATION_MAX_RETRIES, type AutomationRunDto, type RunOutcome } from '@/types/automation';

/** 两种 skipped 的原因文案。**必须不同** —— 一个要用户去重新授权，另一个什么都不用做。 */
const SKIP_DETAIL: Record<string, string> = {
  AUTH_EXPIRED: '该 runtime 的凭证已过期或被吊销，本次未触发。重新授权后会按原调度继续。',
  PREVIOUS_RUNNING: '上一次触发的任务当时还在跑，按「跳过」并发策略未再起一个。',
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
        detail: '任务执行完成。连续失败计数已清零。',
        countsTowardFailure: false,
      };

    case 'failed':
      return {
        category: 'failure',
        icon: '❌',
        label: '失败',
        detail: '任务真的跑了但失败了。这次计入连续失败：累计 3 次会自动降频。',
        countsTowardFailure: true,
      };

    case 'timeout':
      // 超时是失败的一种（03 §8.3：run 记 timeout 并计入 consecutive_failures），
      // 但原因完全不同 —— 用户该做的是调大超时档位，不是查代码。
      return {
        category: 'failure',
        icon: '❌',
        label: '超时',
        detail: '达到硬超时被强制结束，按失败处理。这次计入连续失败；可在规则里调大超时档位。',
        countsTowardFailure: true,
      };

    case 'resource-exhausted': {
      const n = run.retryCount ?? 0;
      return {
        category: 'waiting',
        icon: '⚠️',
        label: `排队重试中 ${String(n)}/${String(AUTOMATION_MAX_RETRIES)}`,
        detail: `触发时资源不足，正按 24 分钟间隔重试（最多 ${String(AUTOMATION_MAX_RETRIES)} 次，约 2 小时窗口）。还没有结果，不计入连续失败。`,
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
        detail: `${detail ?? '这次没有触发（原因未下发）。'}这次没有执行，不计入连续失败。`,
        countsTowardFailure: false,
      };
    }

    case 'missed':
      return {
        category: 'missed',
        icon: '🕳️',
        label: '错过',
        detail:
          '调度器当时没在运行，错过了这个触发时刻。这不是规则失败，按设计也不会补跑（否则凌晨任务会在中午执行）。不计入连续失败。',
        countsTowardFailure: false,
      };

    case 'running':
      return {
        category: 'running',
        icon: '⏳',
        label: '运行中',
        detail: '任务正在执行。',
        countsTowardFailure: false,
      };

    case 'pending':
      return {
        category: 'waiting',
        icon: '⏳',
        label: '待执行',
        detail: '已触发，正在创建任务。',
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
      return 'Webhook 已送达。';
    case 'failed':
      return 'Webhook 投递失败（重试 2 次后放弃）。仅通知未送出，规则状态不受影响。';
    case 'skipped':
      return '按 trigger_on 配置，本次不发 Webhook。';
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
