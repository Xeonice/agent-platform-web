// 无头 Task 终态卡（S6）：退出码 + 产物列表 + 下载入口 + 续接。纯展示、props 驱动、零副作用。
//
// 两条硬要求落在这里：
//  ① **`exitCode` 可能缺席**——展示文本由 hook 侧的 `describeTaskOutcome` 给成品（缺席时是人话），
//     视图**永远不自己拼 `String(exitCode)`**，因此界面上不可能出现 "undefined"。
//  ② P22 §1：人话 + 可操作动作一起给；错误码只作诊断小字。
import type { TaskArtifactView, TaskOutcomeCopy } from '@/types/taskStream';
import { Button } from '@/components/ui/button';

export interface TaskOutcomeProps {
  copy: TaskOutcomeCopy;
  artifacts: readonly TaskArtifactView[];
  onDownload: (name: string) => void;
  /** 正在下载的产物名（同一时间只允许一个）。 */
  downloadingName?: string;
  /**
   * 下载进度的**成品文案**（hook 侧派生；view 不做数学也不猜百分比）。
   * undefined = 这一刻没有可显示的进度 —— 响应没给 `content-length`、或走的是回退存盘路径。
   * 那时按钮上的「下载中…」就是全部信息，**不造一个假的百分比来填空**。
   */
  downloadProgressLabel?: string;
  downloadErrorMessage?: string;
  /**
   * 续接入口：有 sessionRef 才可点（把它填进下一轮的 `resumeFrom`）。
   * 无 ref 时按钮禁用并说明原因——不给一个点了没反应的按钮。
   */
  onResume: () => void;
  sessionRef?: string;
  /** 重开一轮全新会话（不带 resumeFrom）。 */
  onNewTask: () => void;
}

export function TaskOutcomeView({
  copy,
  artifacts,
  onDownload,
  downloadingName,
  downloadProgressLabel,
  downloadErrorMessage,
  onResume,
  sessionRef,
  onNewTask,
}: TaskOutcomeProps) {
  const failed = copy.tone === 'failed';
  const canResume = sessionRef !== undefined && sessionRef !== '';

  return (
    <section
      className="flex flex-col gap-3 border-t border-border p-4"
      data-testid="task-outcome"
      data-code={copy.diagnosticCode}
      data-exit-missing={copy.exitCodeMissing}
    >
      <p
        {...(failed ? { role: 'alert' as const } : { role: 'status' as const })}
        className={failed ? 'text-sm text-red-400' : 'text-sm text-foreground'}
      >
        {copy.title}
      </p>

      <p className="text-xs text-muted-foreground">
        退出码：<span data-testid="task-exit-code">{copy.exitCodeLabel}</span>
      </p>

      <p className="max-w-2xl text-xs text-muted-foreground">{copy.advice}</p>

      <div>
        <h4 className="text-xs font-semibold">产物</h4>
        {artifacts.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">本次任务没有产出文件。</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {artifacts.map((artifact) => (
              <li key={artifact.name} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{artifact.name}</span>
                <span className="text-muted-foreground">{artifact.sizeLabel}</span>
                <span className="text-muted-foreground">{artifact.modifiedAt}</span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={downloadingName !== undefined}
                  onClick={() => {
                    onDownload(artifact.name);
                  }}
                >
                  {downloadingName === artifact.name ? '下载中…' : '下载'}
                </Button>
                {downloadingName === artifact.name &&
                  downloadProgressLabel !== undefined &&
                  downloadProgressLabel !== '' && (
                    <span className="text-muted-foreground" data-testid="download-progress">
                      {downloadProgressLabel}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        )}
        {downloadErrorMessage !== undefined && downloadErrorMessage !== '' && (
          <p role="alert" className="mt-1 text-xs text-red-400">
            {downloadErrorMessage}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!canResume}
          onClick={() => {
            onResume();
          }}
        >
          接着聊（续接这轮会话）
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onNewTask();
          }}
        >
          发起全新任务
        </Button>
      </div>

      {!canResume && (
        <p className="text-xs text-muted-foreground">
          这轮没有拿到会话引用（CLI 未上报 session-started），无法续接；可以发起一轮全新任务。
        </p>
      )}

      {copy.diagnosticCode !== undefined && copy.diagnosticCode !== '' && (
        <p className="text-[10px] text-muted-foreground">诊断码：{copy.diagnosticCode}</p>
      )}
    </section>
  );
}
