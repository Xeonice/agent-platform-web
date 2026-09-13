// 沙箱失败/结束态呈现（P22 §1）。纯展示、props 驱动、零副作用。
//
// P22 §1 的硬要求：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本视图把 title/advice/actions 三样一起渲染，且 actions 至少一条（由 container 经 lib 保证）。
// 错误码只作为 data 属性留给诊断/测试，不当正文显示给用户。
//
// ⚠️ **上面这句话此前只兑现了一半**：文件头写着"不当正文显示"，卡片底部却常驻一行
// 「诊断码：{code}」——P22 §1 明令禁止裸抛错误码，三份口径并存了很久。
// ⇒ 本轮收进 [复制诊断信息]：码、detail、traceId 一起进剪贴板交给管理员，正文不出现码。
//   `data-code` 保留，测试与排障照旧从它取。
import { Button } from '@/components/ui/button';
import { OutcomeIcon } from '@/components/ui/outcome-icon';
import type { OutcomeSeverity } from '@/types/outcomeSeverity';

export interface SandboxOutcomeAction {
  key: string;
  label: string;
}

export interface SandboxOutcomeProps {
  /** 'failed' 出红字告警；'ended' 是正常结束，不用红字。 */
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
  /**
   * 后端给的**自由文本**失败细节（`SandboxResponseDto.failureMessage`），排障小字。
   * 与 advice 分开渲染：advice 是按码查表的人话，detail 是原样透出的技术细节。
   */
  detail?: string;
  /**
   * 原始错误码。**只进 `data-code` 与 [复制诊断信息]，⛔ 不进正文。**
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
}): string {
  const lines = [
    input.taskName === undefined || input.taskName === '' ? undefined : `任务：${input.taskName}`,
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
  severity,
  title,
  advice,
  actions,
  onAction,
  taskName,
  detail,
  diagnosticCode,
  traceId,
  onCopyDiagnostics,
}: SandboxOutcomeProps) {
  const failed = tone === 'failed';
  const diagnosticText = buildDiagnosticText({ title, diagnosticCode, detail, traceId, taskName });
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
      {taskName !== undefined && taskName !== '' && (
        <p className="text-sm text-muted-foreground">任务：{taskName}</p>
      )}

      <p
        {...(failed ? { role: 'alert' as const } : { role: 'status' as const })}
        className={
          failed
            ? 'flex max-w-md items-center gap-1.5 text-sm text-red-400'
            : 'flex max-w-md items-center gap-1.5 text-sm text-foreground'
        }
      >
        <OutcomeIcon severity={severity} />
        {title}
      </p>

      {/* ⚠️ advice 必须**留在可见处、不折叠**：它承载"为什么"、"失败在哪一步"以及
          "重试没有用"的解释——那句话防的正是用户白点十次重试。 */}
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
    </div>
  );
}
