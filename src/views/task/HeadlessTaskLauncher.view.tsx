// 无头 Task 发起入口（S6）：指令 + 超时档位 + 额外旗标 + [发起]。纯展示、props 驱动、零副作用。
//
// ⚠️ 安全红线（15 §3.5）：指令的值由 **container 的局部 state** 持有并经 props 传入，
// 视图不得把它写进任何 store / storage；container 提交即清空。与 initialPrompt 同一纪律。
import {
  TASK_EXTRA_ARGS,
  TASK_PROMPT_MAX_LENGTH,
  TASK_TIMEOUT_OPTIONS,
  type TaskTimeoutMinutes,
} from '@/types/task';
import { Button } from '@/components/ui/button';

export interface HeadlessTaskLauncherProps {
  /** 当前输入值（container 局部 state；绝不来自 store）。 */
  prompt: string;
  onPromptChange: (value: string) => void;
  timeoutMinutes: TaskTimeoutMinutes;
  onTimeoutChange: (value: TaskTimeoutMinutes) => void;
  /** 唯一白名单旗标 `--verbose`（后端也有一份白名单，前端这份只为不出现必拒的选项）。 */
  verbose: boolean;
  onVerboseChange: (value: boolean) => void;
  onSubmit: () => void;
  submitting: boolean;
  /**
   * 非空 → **禁用**发起并展示原因。今天唯一来源：所选 provider 的 `capabilities.headlessTask === false`
   * （与 spawnTty=false 禁用终端入口同一套做法）。
   */
  disabledReason?: string;
  /** 能力位**未知**时的说明（不禁用，以后端 409 为准）。 */
  capabilityUnknownNote?: string;
  /** 发起失败文案（人话，已由 hook 按码翻译）。 */
  errorMessage?: string;
  /** 非空 = 本次将续接该会话（上一轮的 sessionRef，填进请求体 resumeFrom）。 */
  resumeFrom?: string;
  onClearResume?: () => void;
}

function timeoutLabel(minutes: TaskTimeoutMinutes): string {
  return minutes < 60 ? `${String(minutes)} 分钟` : `${String(minutes / 60)} 小时`;
}

export function HeadlessTaskLauncherView({
  prompt,
  onPromptChange,
  timeoutMinutes,
  onTimeoutChange,
  verbose,
  onVerboseChange,
  onSubmit,
  submitting,
  disabledReason,
  capabilityUnknownNote,
  errorMessage,
  resumeFrom,
  onClearResume,
}: HeadlessTaskLauncherProps) {
  // 用 Array.from 数码点，与后端 8000 的口径（UTF-8 码点）一致，emoji 不被算成两个。
  const promptLength = Array.from(prompt).length;
  const tooLong = promptLength > TASK_PROMPT_MAX_LENGTH;
  const empty = prompt.trim() === '';
  const blocked = disabledReason !== undefined && disabledReason !== '';
  const submitDisabled = submitting || tooLong || empty || blocked;
  const resuming = resumeFrom !== undefined && resumeFrom !== '';

  return (
    <section
      className="flex flex-col gap-3 border-t border-border p-4"
      data-testid="headless-task-launcher"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">无头任务</h3>
        <p className="text-xs text-muted-foreground">
          不开终端，直接把指令交给 agent 跑完；输出与产物在下方回收
        </p>
      </div>

      {resuming && (
        <p className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
          <span>
            本次将<strong>续接上一轮会话</strong>（{resumeFrom}）
          </span>
          {onClearResume !== undefined && (
            <button
              type="button"
              className="underline"
              onClick={() => {
                onClearResume();
              }}
            >
              改为全新会话
            </button>
          )}
        </p>
      )}

      <div>
        <label htmlFor="headless-task-prompt" className="text-xs text-muted-foreground">
          任务指令
        </label>
        <textarea
          id="headless-task-prompt"
          value={prompt}
          onChange={(e) => {
            onPromptChange(e.target.value);
          }}
          disabled={submitting || blocked}
          rows={3}
          aria-invalid={tooLong}
          aria-describedby="headless-task-prompt-counter"
          placeholder="把这个仓库的测试补齐并输出改动摘要…"
          className="mt-1 w-full resize-y rounded border border-input bg-background p-2 text-sm"
        />
        <p
          id="headless-task-prompt-counter"
          {...(tooLong ? { role: 'alert' as const } : {})}
          className={tooLong ? 'mt-1 text-xs text-red-400' : 'mt-1 text-xs text-muted-foreground'}
        >
          {String(promptLength)}/{String(TASK_PROMPT_MAX_LENGTH)}
          {tooLong ? ' —— 已超出上限，请精简后再发起' : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label htmlFor="headless-task-timeout" className="text-xs text-muted-foreground">
            硬超时
          </label>
          <select
            id="headless-task-timeout"
            value={String(timeoutMinutes)}
            disabled={submitting || blocked}
            onChange={(e) => {
              const picked = TASK_TIMEOUT_OPTIONS.find((o) => String(o) === e.target.value);
              if (picked !== undefined) onTimeoutChange(picked);
            }}
            className="rounded border border-input bg-background px-2 py-1 text-sm"
          >
            {TASK_TIMEOUT_OPTIONS.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {timeoutLabel(minutes)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={verbose}
            disabled={submitting || blocked}
            onChange={(e) => {
              onVerboseChange(e.target.checked);
            }}
          />
          <span className="font-mono">{TASK_EXTRA_ARGS[0]}</span>
          <span>（更详细的 CLI 日志）</span>
        </label>
      </div>

      {blocked && (
        <p role="alert" className="text-sm text-amber-400">
          {disabledReason}
        </p>
      )}

      {!blocked && capabilityUnknownNote !== undefined && capabilityUnknownNote !== '' && (
        <p role="status" className="text-xs text-muted-foreground">
          {capabilityUnknownNote}
        </p>
      )}

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      <div>
        <Button
          onClick={() => {
            onSubmit();
          }}
          disabled={submitDisabled}
        >
          {submitting ? '发起中…' : resuming ? '接着跑（续接会话）' : '发起无头任务'}
        </Button>
      </div>
    </section>
  );
}
