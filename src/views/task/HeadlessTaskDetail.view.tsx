// 无头任务面板的**非发起态**（F21-2 §N.3）：无任务 → 引导；有任务 → 只读详情 + [新任务]。
// 纯展示、props 驱动、零副作用。
//
// ⚠️ **病根**：`HeadlessTaskContainer` 此前只要沙箱 running 就渲染 `HeadlessTaskLauncher`
//（带指令 textarea + 发起按钮），**与这个沙箱有没有任务无关**。于是建完任务之后，界面主体
// 仍然是"再发起一个"的入口 —— 用户看不到自己刚建的那个任务，只看到一张空表单。
//
// ⚠️ **[新任务] 入口不能省。** `GET /api/sandboxes/:id/tasks` 是**列表**、`selectedTaskId`
// 记的是"用户上次盯着哪一个" —— 数据模型本来就是**一个沙箱多个任务**。
// "建完就没有发起入口"会把多任务能力从界面上抹掉；正确形态是「详情 + 显式新建」，
// 不是「详情替代发起」。
//
// ⚠️ **本视图不得出现指令 textarea**：那正是它要替换掉的东西。这条是结构性断言
//（`HeadlessTaskContainer.test.tsx`「详情态没有指令 textarea」），变异 = 让详情态也渲染 textarea。
import type { AgentTaskDto } from '@/types/task';
import { Button } from '@/components/ui/button';

export interface HeadlessTaskDetailProps {
  /**
   * 这个沙箱**最近的一条任务**；`undefined` = 一条都没有（引导态）。
   * 形状直接用生成物 DTO：后端加字段 → codegen → 这里编译期可见。
   */
  task?: AgentTaskDto;
  /** 打开发起入口（**同一沙箱内的下一个任务**，不是新建沙箱）。 */
  onNewTask: () => void;
  /** 回到这条任务的输出面板（产物下载与终态卡都在那儿；本视图保持只读）。 */
  onOpenTask?: () => void;
  /** 非空 → 禁用 [新任务] 并展示原因（provider `capabilities.headlessTask === false`）。 */
  disabledReason?: string;
  /** 能力位**未知**时的说明（不禁用，以后端 409 为准）。 */
  capabilityUnknownNote?: string;
}

const STATUS_LABEL: Record<AgentTaskDto['status'], string> = {
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  killed: '已终止',
  timed_out: '超时',
};

/** 耗时（毫秒 → 人话）。未结束的任务算不出终值，交给调用方按 `finishedAt` 缺席处理。 */
function formatDuration(startedAt: string, finishedAt: string): string {
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${String(sec)} 秒`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  if (min < 60) return `${String(min)} 分 ${String(rest)} 秒`;
  return `${String(Math.floor(min / 60))} 小时 ${String(min % 60)} 分`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

export function HeadlessTaskDetailView({
  task,
  onNewTask,
  onOpenTask,
  disabledReason,
  capabilityUnknownNote,
}: HeadlessTaskDetailProps) {
  const blocked = disabledReason !== undefined && disabledReason !== '';

  return (
    <section
      className="flex flex-col gap-3 border-t border-border p-4"
      data-testid="headless-task-detail"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{task === undefined ? '无头任务' : '任务详情'}</h3>
        <p className="text-xs text-muted-foreground">
          {task === undefined
            ? // ⚠️ 措辞刻意避开裸的"任务"：左侧树的 `项目 · N` 数的是 **Sandbox**
              // （Task 的产品叫法），这里数的是**沙箱内部的无头运行**。两者同名不同物，
              // 摆在一屏上就成了"· 1"与"还没有任务"互相打架。
              '这个沙箱还没跑过无头运行 —— 在下面发起一次'
            : '只读；一个沙箱可以有多个任务'}
        </p>
      </div>

      {task !== undefined && (
        <div className="flex flex-col gap-1 rounded border border-border p-3">
          {/* 指令**不回显**：后端刻意不返回（10 §7.3 / 15 §3.5 安全红线），前端手里也没有。
              直说这件事，好过留一个永远空着的格子让人以为是 bug。 */}
          <Row label="指令">
            <span className="text-muted-foreground">不回显（后端不返回任务指令）</span>
          </Row>
          <Row label="状态">
            <span data-testid="detail-status">{STATUS_LABEL[task.status]}</span>
            {task.errorCode !== undefined && (
              <span className="ml-2 font-mono text-muted-foreground">{task.errorCode}</span>
            )}
          </Row>
          <Row label="耗时">
            {task.finishedAt === undefined
              ? '进行中'
              : formatDuration(task.startedAt, task.finishedAt)}
          </Row>
          <Row label="退出码">
            {/* `exitCode` 缺席 ≠ 0。写成 `task.exitCode ?? 0` 会把"没拿到"渲染成"成功退出"。 */}
            <span data-testid="detail-exit-code" className="font-mono">
              {task.exitCode === undefined ? '—' : String(task.exitCode)}
            </span>
          </Row>
          <Row label="产物">
            {task.artifacts.length === 0 ? (
              <span className="text-muted-foreground">无</span>
            ) : (
              <span className="font-mono">{task.artifacts.map((a) => a.name).join('、')}</span>
            )}
          </Row>
          <Row label="runtime">
            <span className="font-mono">{task.runtime}</span>
          </Row>
        </div>
      )}

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

      <div className="flex gap-2">
        <Button
          onClick={() => {
            onNewTask();
          }}
          disabled={blocked}
        >
          发起无头运行
        </Button>
        {task !== undefined && onOpenTask !== undefined && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onOpenTask();
            }}
          >
            查看输出
          </Button>
        )}
      </div>
    </section>
  );
}
