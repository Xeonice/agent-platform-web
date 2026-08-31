// 简化预设调度（P21-7 §3.2 / F21-7 §3）。纯展示、props 驱动。
//
// ★ **时区在这个组件里有两条硬规则**：
//   ① 它**始终可见**——不是折叠在「高级选项」里。规则的触发时刻只有连着时区读才有意义。
//   ② 编辑既有规则时，改它是**一个显式动作**（走 `onTimeZoneChange`，不是普通字段的 onChange）。
//      理由见 `lib/automation/automationPayload` 文件头：编辑时隐式重传 timezone，
//      用户换台机器改个 prompt 就会把凌晨任务挪走（23 I-AUT-9）。
import {
  SCHEDULE_KINDS,
  type AutomationScheduleConfig,
  type ScheduleKind,
} from '@/types/automation';

export interface ScheduleSelectorProps {
  kind: ScheduleKind;
  config: AutomationScheduleConfig;
  timezone: string;
  /** 编辑既有规则时为真：时区旁边多一句"改它会影响以后所有触发时刻"。 */
  editing?: boolean;
  /** 用户是否已显式改过时区（改过就会随 PUT 提交）。 */
  timezoneTouched?: boolean;
  errorMessage?: string;
  onKindChange: (kind: ScheduleKind) => void;
  onConfigChange: (config: AutomationScheduleConfig) => void;
  /** ★ 时区的唯一改法。 */
  onTimeZoneChange: (timezone: string) => void;
}

const KIND_LABEL: Record<ScheduleKind, string> = {
  daily: '每天',
  hourly: '每小时',
  weekly: '每周',
};

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export function ScheduleSelectorView({
  kind,
  config,
  timezone,
  editing = false,
  timezoneTouched = false,
  errorMessage,
  onKindChange,
  onConfigChange,
  onTimeZoneChange,
}: ScheduleSelectorProps) {
  const days = config.days ?? [];

  return (
    <fieldset className="flex flex-col gap-2" data-testid="schedule-selector">
      <legend className="text-xs font-medium">调度</legend>

      <div className="flex flex-wrap gap-3">
        {SCHEDULE_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1.5 text-xs">
            <input
              type="radio"
              name="schedule-kind"
              checked={kind === k}
              onChange={() => {
                onKindChange(k);
              }}
              data-testid={`schedule-kind-${k}`}
            />
            {KIND_LABEL[k]}
          </label>
        ))}
        {/* 自定义 cron 是 v1.2（P21-7 §3.2）。**摆一个禁用项而不是隐藏**，
            是为了让"这条路存在但还没通"可见——与「恢复保留卷」那条相反的处理：
            那条连禁用态都不摆，因为它的语义还没裁；这条语义已经定了，只是没排期。 */}
        <label className="flex cursor-not-allowed items-center gap-1.5 text-xs text-muted-foreground">
          <input type="radio" name="schedule-kind" disabled data-testid="schedule-kind-cron" />
          自定义 cron（v1.2）
        </label>
      </div>

      {kind === 'hourly' && (
        <label className="flex items-center gap-2 text-xs">
          每小时的第
          <input
            type="number"
            min={0}
            max={59}
            value={config.minute ?? 0}
            className="w-16 rounded border border-border bg-background px-2 py-1"
            onChange={(e) => {
              onConfigChange({ ...config, minute: Number.parseInt(e.target.value, 10) });
            }}
            data-testid="schedule-minute"
          />
          分
        </label>
      )}

      {(kind === 'daily' || kind === 'weekly') && (
        <label className="flex items-center gap-2 text-xs">
          时间
          <input
            type="time"
            value={config.time ?? ''}
            className="rounded border border-border bg-background px-2 py-1"
            onChange={(e) => {
              onConfigChange({ ...config, time: e.target.value });
            }}
            data-testid="schedule-time"
          />
        </label>
      )}

      {kind === 'weekly' && (
        <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="schedule-days">
          星期
          {WEEKDAYS.map((label, index) => (
            <label key={label} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={days.includes(index)}
                onChange={() => {
                  const next = days.includes(index)
                    ? days.filter((d) => d !== index)
                    : [...days, index];
                  onConfigChange({ ...config, days: next });
                }}
                data-testid={`schedule-day-${String(index)}`}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs">
        <span>
          时区
          {timezoneTouched && (
            <span className="ml-1 text-amber-500" data-testid="timezone-touched">
              （已修改，保存时会一并提交）
            </span>
          )}
        </span>
        <input
          type="text"
          value={timezone}
          className="rounded border border-border bg-background px-2 py-1"
          onChange={(e) => {
            onTimeZoneChange(e.target.value);
          }}
          data-testid="schedule-timezone"
        />
        <span className="text-[11px] text-muted-foreground">
          {editing
            ? '时区在规则创建时快照。不动它，保存时就不会重传——否则换台机器编辑一次，触发时刻就跟着这台机器挪走了。'
            : '默认取你当前的时区，创建后快照保存；之后你换机器或改系统时区都不会影响这条规则。'}
        </span>
      </label>

      {errorMessage !== undefined && errorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400" data-testid="schedule-error">
          {errorMessage}
        </p>
      )}
    </fieldset>
  );
}
