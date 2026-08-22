// 沙箱失败/结束态呈现（P22 §1）。纯展示、props 驱动、零副作用。
//
// P22 §1 的硬要求：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本视图把 title/advice/actions 三样一起渲染，且 actions 至少一条（由 container 经 lib 保证）。
// 错误码只作为 data 属性留给诊断/测试，不当正文显示给用户。
import { Button } from '@/components/ui/button';

export interface SandboxOutcomeAction {
  key: string;
  label: string;
}

export interface SandboxOutcomeProps {
  /** 'failed' 出红字告警；'ended' 是正常结束，不用红字。 */
  tone: 'failed' | 'ended';
  /** 人话：发生了什么。 */
  title: string;
  /** 现在能做什么 / 为什么会这样。 */
  advice: string;
  actions: readonly SandboxOutcomeAction[];
  onAction: (key: string) => void;
  /** 后端派生的默认任务名（有则显示是哪个任务失败了）。 */
  taskName?: string;
  /**
   * 后端给的**自由文本**失败细节（`SandboxResponseDto.failureMessage`），排障小字。
   * 与 advice 分开渲染：advice 是按码查表的人话，detail 是原样透出的技术细节。
   */
  detail?: string;
  /** 原始状态/错误码（诊断用，小字）。 */
  diagnosticCode?: string;
}

export function SandboxOutcomeView({
  tone,
  title,
  advice,
  actions,
  onAction,
  taskName,
  detail,
  diagnosticCode,
}: SandboxOutcomeProps) {
  const failed = tone === 'failed';
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="sandbox-outcome"
      data-code={diagnosticCode}
    >
      {taskName !== undefined && taskName !== '' && (
        <p className="text-sm text-muted-foreground">任务：{taskName}</p>
      )}

      <p
        {...(failed ? { role: 'alert' as const } : { role: 'status' as const })}
        className={failed ? 'max-w-md text-sm text-red-400' : 'max-w-md text-sm text-foreground'}
      >
        {title}
      </p>

      <p className="max-w-md text-sm text-muted-foreground">{advice}</p>

      {detail !== undefined && detail !== '' && (
        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-left text-xs text-muted-foreground">
          {detail}
        </pre>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.key}
            variant="outline"
            onClick={() => {
              onAction(action.key);
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>

      {diagnosticCode !== undefined && diagnosticCode !== '' && (
        <p className="text-xs text-muted-foreground">诊断码：{diagnosticCode}</p>
      )}
    </div>
  );
}
