// 创建/编辑规则表单（P21-7 §3.2 / F21-7 §3）。纯展示、props 驱动、零副作用。
//
// ⚠️ **安全红线（15 §3.5）**：`prompt` 的值由 hook 的局部 state 持有并经 props 传入，
//   视图不得把它写进任何 store / storage。与向导「任务指令」同一条红线。
//
// ⚠️ **`RuntimeSelector.view` / `TaskPromptField.view` 在这个仓里不存在。**
//   F21-7 §3 写的是「复用自 F21-2」，但 F21-2 的向导从未实现（`uiSlice` 文件头：
//   "20 个组件里 15 个不存在"），`src/views/wizard/` 下只有 auth 四件套。
//   ⇒ 这里不新造两个"复用组件"的空壳（那只是把不存在换个地方写一遍），而是保住
//   **产品真正要的那条不变量**：任务内容与向导任务指令是**同一字段同一校验**。
//   落地方式是共用同一个常量 `TASK_PROMPT_MAX_LENGTH`（`types/task`，无头 Task 那份），
//   计数算法也照抄 `HeadlessTaskLauncher.view`（`Array.from` 数码点，emoji 不算两个）。
//   ⇒ 后端加一档 / 改上限时，两处一起变，不会漂。
import { Button } from '@/components/ui/button';
import { ScheduleSelectorView } from '@/views/project/ScheduleSelector.view';
import { WebhookSectionView } from '@/views/project/WebhookSection.view';
import {
  ARTIFACT_RETENTION_OPTIONS,
  AUTOMATION_TIMEOUT_OPTIONS,
  type ArtifactRetentionDays,
  type AutomationScheduleConfig,
  type ScheduleKind,
  type TriggerOn,
} from '@/types/automation';
import { TASK_PROMPT_MAX_LENGTH } from '@/types/task';

export interface AutomationFormFields {
  name: string;
  description: string;
  runtime: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: AutomationScheduleConfig;
  timezone: string;
  timezoneTouched: boolean;
  timeoutMinutes: number;
  artifactRetentionDays: ArtifactRetentionDays;
  webhookEnabled: boolean;
  webhookUrl: string;
  triggerOn: TriggerOn;
}

export interface AutomationFormErrors {
  name?: string;
  prompt?: string;
  runtime?: string;
  schedule?: string;
  webhookUrl?: string;
}

export interface AutomationFormProps {
  mode: 'create' | 'edit';
  draft: AutomationFormFields;
  errors: AutomationFormErrors;
  canSave: boolean;
  saving: boolean;
  promptCount: number;
  schedulePreview: string;
  /** `GET /api/runtimes` 的可选值（开放 registry，⛔ 前端不写死 'codex'|'claude'）。 */
  runtimeOptions: { id: string; label: string }[];
  runtimesLoading?: boolean;
  webhookDeliveryNote: string;
  webhookTestPhase: 'idle' | 'testing' | 'ok' | 'error';
  webhookTestErrorMessage?: string;
  saveErrorMessage?: string;
  onPatch: (patch: Partial<AutomationFormFields>) => void;
  onTimeZoneChange: (timezone: string) => void;
  onTestWebhook: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function timeoutLabel(minutes: number): string {
  return minutes < 60 ? `${String(minutes)} 分钟` : `${String(minutes / 60)} 小时`;
}

export function AutomationFormView({
  mode,
  draft,
  errors,
  canSave,
  saving,
  promptCount,
  schedulePreview,
  runtimeOptions,
  runtimesLoading = false,
  webhookDeliveryNote,
  webhookTestPhase,
  webhookTestErrorMessage,
  saveErrorMessage,
  onPatch,
  onTimeZoneChange,
  onTestWebhook,
  onSave,
  onCancel,
}: AutomationFormProps) {
  const promptTooLong = promptCount > TASK_PROMPT_MAX_LENGTH;

  return (
    <div className="flex flex-col gap-4 px-5 py-4 text-sm" data-testid="automation-form">
      <p className="text-xs text-muted-foreground">
        {mode === 'create' ? '新建自动化规则' : '编辑自动化规则'}
        ：到点自动起一个无头任务，跑完自动销毁实例、只留成果。
      </p>

      <label className="flex flex-col gap-1 text-xs">
        名称
        <input
          type="text"
          value={draft.name}
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(e) => {
            onPatch({ name: e.target.value });
          }}
          data-testid="form-name"
        />
        {errors.name !== undefined && (
          <span role="alert" className="text-red-400" data-testid="form-name-error">
            {errors.name}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-xs">
        描述（可选）
        <input
          type="text"
          value={draft.description}
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(e) => {
            onPatch({ description: e.target.value });
          }}
          data-testid="form-description"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs">
        Runtime
        <select
          value={draft.runtime}
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(e) => {
            onPatch({ runtime: e.target.value });
          }}
          data-testid="form-runtime"
        >
          <option value="">{runtimesLoading ? '正在读取…' : '请选择'}</option>
          {runtimeOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {errors.runtime !== undefined && (
          <span role="alert" className="text-red-400" data-testid="form-runtime-error">
            {errors.runtime}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="flex items-baseline justify-between">
          <span>任务内容</span>
          <span
            className={promptTooLong ? 'text-red-400' : 'text-muted-foreground'}
            data-testid="form-prompt-count"
          >
            {promptCount} / {TASK_PROMPT_MAX_LENGTH}
          </span>
        </span>
        <textarea
          rows={5}
          value={draft.prompt}
          className="rounded border border-border bg-background px-2 py-1 font-mono"
          onChange={(e) => {
            onPatch({ prompt: e.target.value });
          }}
          data-testid="form-prompt"
        />
        {errors.prompt !== undefined && (
          <span role="alert" className="text-red-400" data-testid="form-prompt-error">
            {errors.prompt}
          </span>
        )}
      </label>

      <fieldset className="flex flex-col gap-1 text-xs">
        <legend className="font-medium">超时配置</legend>
        <div className="flex flex-wrap gap-3">
          {AUTOMATION_TIMEOUT_OPTIONS.map((minutes) => (
            <label key={minutes} className="flex items-center gap-1.5">
              <input
                type="radio"
                name="timeout"
                checked={draft.timeoutMinutes === minutes}
                onChange={() => {
                  onPatch({ timeoutMinutes: minutes });
                }}
                data-testid={`form-timeout-${String(minutes)}`}
              />
              {timeoutLabel(minutes)}
            </label>
          ))}
        </div>
        <span className="text-[11px] text-muted-foreground">
          无头任务硬超时。超时记 failed 并计入连续失败。
        </span>
      </fieldset>

      <ScheduleSelectorView
        kind={draft.scheduleKind}
        config={draft.scheduleConfig}
        timezone={draft.timezone}
        editing={mode === 'edit'}
        timezoneTouched={draft.timezoneTouched}
        {...(errors.schedule === undefined ? {} : { errorMessage: errors.schedule })}
        onKindChange={(scheduleKind) => {
          // 换预设要同时换掉配置形状，否则「每天 08:00」切到「每小时」会留着一个
          // 没人读的 time 字段，切回来时又冒出一个用户没设过的旧值。
          onPatch({
            scheduleKind,
            scheduleConfig:
              scheduleKind === 'hourly'
                ? { minute: 0 }
                : scheduleKind === 'weekly'
                  ? { time: draft.scheduleConfig.time ?? '08:00', days: [1] }
                  : { time: draft.scheduleConfig.time ?? '08:00' },
          });
        }}
        onConfigChange={(scheduleConfig) => {
          onPatch({ scheduleConfig });
        }}
        onTimeZoneChange={onTimeZoneChange}
      />

      <p className="text-[11px] text-muted-foreground" data-testid="form-schedule-preview">
        预览：{schedulePreview}
      </p>

      <details className="rounded border border-border px-3 py-2" data-testid="form-advanced">
        <summary className="cursor-pointer text-xs font-medium">高级选项</summary>

        <fieldset className="mt-2 flex flex-col gap-1 text-xs">
          <legend className="font-medium">并发模式</legend>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              name="concurrency"
              checked
              readOnly
              data-testid="form-concurrency-skip"
            />
            跳过（上次还在跑就不再起一个）
          </label>
          <label className="flex cursor-not-allowed items-center gap-1.5 text-muted-foreground">
            <input type="radio" name="concurrency" disabled data-testid="form-concurrency-queue" />
            排队（v1.2）
          </label>
          <label className="flex cursor-not-allowed items-center gap-1.5 text-muted-foreground">
            <input
              type="radio"
              name="concurrency"
              disabled
              data-testid="form-concurrency-parallel"
            />
            并发（v1.2）
          </label>
        </fieldset>

        <fieldset className="mt-3 flex flex-col gap-1 text-xs">
          <legend className="font-medium">成果保留期</legend>
          <div className="flex flex-wrap gap-3">
            {ARTIFACT_RETENTION_OPTIONS.map((days) => (
              <label key={days} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="retention"
                  checked={draft.artifactRetentionDays === days}
                  onChange={() => {
                    onPatch({ artifactRetentionDays: days });
                  }}
                  data-testid={`form-retention-${String(days)}`}
                />
                {days} 天
              </label>
            ))}
          </div>
          {/* ⭐ 与已落地的保留卷是同一条路（13 §2.2.2 / F21-7 §10.4）：这个天数直接
              喂 `retained_volumes.retain_until`，产物以 source='automation-artifact' 落进
              项目的「🎁 已保留卷」面板，不是另开一套存储。说出来用户才知道去哪儿找成果。 */}
          <span className="text-[11px] text-muted-foreground" data-testid="form-retention-note">
            成果以保留卷形式存放，到期自动清理；期间可在项目的「🎁 已保留卷」里下载。
          </span>
        </fieldset>
      </details>

      <WebhookSectionView
        enabled={draft.webhookEnabled}
        url={draft.webhookUrl}
        triggerOn={draft.triggerOn}
        {...(errors.webhookUrl === undefined ? {} : { errorMessage: errors.webhookUrl })}
        deliveryNote={webhookDeliveryNote}
        testPhase={webhookTestPhase}
        {...(webhookTestErrorMessage === undefined
          ? {}
          : { testErrorMessage: webhookTestErrorMessage })}
        onEnabledChange={(webhookEnabled) => {
          onPatch({ webhookEnabled });
        }}
        onUrlChange={(webhookUrl) => {
          onPatch({ webhookUrl });
        }}
        onTriggerOnChange={(triggerOn) => {
          onPatch({ triggerOn });
        }}
        onTest={onTestWebhook}
      />

      {saveErrorMessage !== undefined && saveErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="form-save-error">
          {saveErrorMessage}
        </p>
      )}

      <div className="flex gap-2">
        <Button disabled={!canSave || saving} onClick={onSave} data-testid="form-save">
          {saving ? '保存中…' : '保存规则'}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={onCancel} data-testid="form-cancel">
          取消
        </Button>
      </div>
    </div>
  );
}
