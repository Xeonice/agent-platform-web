import type { ReactNode } from 'react';
// 沙箱失败/结束态呈现（P22 §1）。纯展示、props 驱动、零副作用。
//
// P22 §1 的硬要求：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本视图把 title/advice/actions 三样一起渲染，且 actions 至少一条（由 container 经 lib 保证）。
// 新设计 SBX：人话标题与建议之后，诊断码单独列为排障信息；镜像快照不进入播报区。
import { Button } from '@/components/ui/button';
import { OutcomeIcon } from '@/components/ui/outcome-icon';
import type { OutcomeSeverity } from '@/types/outcomeSeverity';

export interface SandboxOutcomeAction {
  key: string;
  label: string;
}

export interface SandboxOutcomeProps {
  /** 'failed' 出红字告警；'ended' 是正常结束，不用红字。 */
  footnote?: string;
  actionsSlot?: ReactNode;
  tone: 'failed' | 'ended';
  /**
   * `title` 属于哪一类结果（`lib/sandbox/sandboxErrorCopy.ts` 的 `SandboxErrorCopy.severity`
   * 原样透传）——本视图只按它查表选一个装饰图标，不做任何判定。
   */
  severity: OutcomeSeverity;
  /** 人话：发生了什么。 */
  title: string;
  /** 现在能做什么 / 为什么会这样。 */
  advice: string;
  actions: readonly SandboxOutcomeAction[];
  onAction: (key: string) => void;
  /** 后端派生的默认任务名（有则显示是哪个任务失败了）。 */
  taskName?: string;
  imageLabel?: string;
  imageDiagnostic?: string;
  onRunDiagnostics?: () => void;
  /**
   * 后端给的**自由文本**失败细节（`SandboxResponseDto.failureMessage`），排障小字。
   * 与 advice 分开渲染：advice 是按码查表的人话，detail 是原样透出的技术细节。
   */
  detail?: string;
  /**
   * 原始错误码，单独放在诊断码行与复制诊断信息里，不充当标题。
   *
   * ⚠️ 只有 `failed` 才该有它。`ended`（用户主动停止）那一支曾经把**原始 status**
   * 当错误码传进来，于是一次正常的停止会显示「诊断码：stopped」。
   */
  diagnosticCode?: string;
  /** 排障用的 traceId（后端有就给；没有就不出现在复制出来的文本里）。 */
  traceId?: string;
  /**
   * [复制诊断信息]。**剪贴板与提示都在 container**（07 §3 规则 2：宿主环境态不是本地 UI 态；
   * `navigator.clipboard` 在非 HTTPS 部署下干脆不存在）。视图只负责把拼好的那段文本递出去。
   * 缺席 ⇒ 不渲染这个按钮（不给一个点了没反应的按钮）。
   */
  onCopyDiagnostics?: (text: string) => void;
}

/** 把三样东西拼成一段可以直接粘给管理员的纯文本。缺席的行不出现（不粘 `undefined`）。 */
function buildDiagnosticText(input: {
  title: string;
  diagnosticCode?: string;
  detail?: string;
  traceId?: string;
  taskName?: string;
  imageDiagnostic?: string;
}): string {
  const lines = [
    input.taskName === undefined || input.taskName === '' ? undefined : `任务：${input.taskName}`,
    input.imageDiagnostic === undefined ? undefined : `镜像：${input.imageDiagnostic}`,
    `现象：${input.title}`,
    input.diagnosticCode === undefined || input.diagnosticCode === ''
      ? undefined
      : `错误码：${input.diagnosticCode}`,
    input.traceId === undefined || input.traceId === '' ? undefined : `traceId：${input.traceId}`,
    input.detail === undefined || input.detail === '' ? undefined : `细节：${input.detail}`,
  ].filter((line): line is string => line !== undefined);
  return lines.join('\n');
}

export function SandboxOutcomeView({
  tone,
  footnote,
  actionsSlot,
  severity,
  title,
  advice,
  actions,
  onAction,
  taskName,
  imageLabel,
  imageDiagnostic,
  onRunDiagnostics,
  detail,
  diagnosticCode,
  traceId,
  onCopyDiagnostics,
}: SandboxOutcomeProps) {
  const failed = tone === 'failed';
  const diagnosticText = buildDiagnosticText({
    title,
    diagnosticCode,
    detail,
    traceId,
    taskName,
    imageDiagnostic,
  });
  // 有码或有细节才值得给这个按钮 —— 只有一句 title 的话，复制出来的东西没有排障价值。
  const hasDiagnostics =
    onCopyDiagnostics !== undefined &&
    ((diagnosticCode !== undefined && diagnosticCode !== '') ||
      (detail !== undefined && detail !== '') ||
      (traceId !== undefined && traceId !== ''));

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
      data-testid="sandbox-outcome"
      data-code={diagnosticCode}
    >
      <p
        {...(failed ? { role: 'alert' as const } : { role: 'status' as const })}
        className={
          failed
            ? severity === 'timeout'
              ? 'flex max-w-md items-center gap-2 text-sm text-timeout'
              : 'flex max-w-md items-center gap-2 text-sm text-error'
            : 'flex max-w-md items-center gap-1.5 text-sm text-foreground'
        }
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-current bg-current/5">
          <OutcomeIcon severity={severity} />
        </span>
        {title}
      </p>

      <div className="space-y-1 text-sm text-muted-foreground">
        {taskName !== undefined && taskName !== '' && <p>任务：{taskName}</p>}
        {imageLabel !== undefined && <p className="break-all">镜像：{imageLabel}</p>}
      </div>

      {/* ⚠️ advice 必须**留在可见处、不折叠**：它承载"为什么"、"失败在哪一步"以及
          "重试没有用"的解释——那句话防的正是用户白点十次重试。 */}
      <p className="max-w-md text-sm text-muted-foreground">{advice}</p>

      {detail !== undefined && detail !== '' && (
        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-muted p-2 text-left text-xs text-muted-foreground">
          {detail}
        </pre>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {actionsSlot}
        {actions.map((action) => (
          <Button
            key={action.key}
            variant={action.key === 'retry' ? 'default' : 'outline'}
            onClick={() => {
              onAction(action.key);
            }}
          >
            {action.label}
          </Button>
        ))}
        {onRunDiagnostics !== undefined && (
          <Button variant="ghost" onClick={onRunDiagnostics}>
            运行诊断
          </Button>
        )}
        {hasDiagnostics && (
          <Button
            variant="ghost"
            data-testid="copy-diagnostics"
            data-diagnostic-text={diagnosticText}
            onClick={() => {
              onCopyDiagnostics(diagnosticText);
            }}
          >
            复制诊断信息
          </Button>
        )}
      </div>
      {footnote && <p className="max-w-md text-xs text-muted-foreground">{footnote}</p>}
      {!failed && (
        <p className="max-w-md text-xs text-muted-foreground">
          停着的任务仍占一个任务名额；不用了就从任务菜单销毁，名额才会腾出来。
        </p>
      )}
      {diagnosticCode !== undefined && (
        <p className="font-mono text-xs text-muted-foreground">诊断码：{diagnosticCode}</p>
      )}
    </div>
  );
}
