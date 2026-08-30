// 工作台骨架 view（P21-1 / S2）：顶栏 + 左侧项目树（含 clone 徽标）+ 右侧内容区。纯展示，props 驱动。
import type { ReactNode } from 'react';
import type { ProjectGroup } from '@/types/domain';
import { Button } from '@/components/ui/button';

export interface WorkbenchShellProps {
  groups: ProjectGroup[];
  waitingInputCount: number;
  healthLabel: string;
  terminalSlot: ReactNode;
  selectedTaskId?: string | null;
  selectedProjectId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onNewProject?: () => void;
  /**
   * 「新建任务」入口（F21-2 §N.1）。
   *
   * ⚠️ **今天一个入口都没有** —— 新建任务面板是 `SandboxTerminalContainer` 在
   * "沙箱为空"时的**兜底渲染**，不是被打开的，于是"创建"根本不是一个动作（§N.0）。
   * 这个按钮存在本身就是"它变成了一个动作"的证据（§9.1 #1）。
   */
  onNewTask?: () => void;
  /**
   * 非空 → 入口置灰并给出原因。今天唯一来源：**没有可用的选中项目**
   *（§9.1 #33：绕过会建出无项目归属的 Task）。
   */
  newTaskDisabledReason?: string;
  /**
   * 弹层插槽（`currentModal` 的两个取值都往这儿渲染）。
   * 放在**最后**：overlay 自己是 `fixed inset-0 z-50`，DOM 顺序决定堆叠时谁在上。
   */
  overlaySlot?: ReactNode;
}

/** clone 徽标：cloning→克隆中(黄) / failed→克隆失败(红) / ready→无（就绪不打扰）。 */
function CloneBadge({ cloneStatus }: { cloneStatus: ProjectGroup['cloneStatus'] }) {
  if (cloneStatus === 'cloning') {
    return (
      <span className="rounded bg-yellow-500/15 px-1 text-[10px] text-yellow-300">克隆中</span>
    );
  }
  if (cloneStatus === 'failed') {
    return <span className="rounded bg-red-500/15 px-1 text-[10px] text-red-300">克隆失败</span>;
  }
  return null;
}

export function WorkbenchShellView({
  groups,
  waitingInputCount,
  healthLabel,
  terminalSlot,
  selectedTaskId = null,
  selectedProjectId = null,
  onSelectTask,
  onSelectProject,
  onNewProject,
  onNewTask,
  newTaskDisabledReason,
  overlaySlot,
}: WorkbenchShellProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <span className="font-semibold">Agent 管理平台</span>
        <span className="text-xs text-muted-foreground" data-testid="health-label">
          {healthLabel}
        </span>
        {/*
         * 顶栏设置入口（P20 §8.2「工作台 → 凭证/镜像/系统：顶栏 ⚙️ 设置菜单」）。
         *
         * ⚠️ 在此之前 `/settings/credentials` **没有任何常规入口**——全仓只有两处
         * `router.push` 能到它,且都是 **Git 克隆失败**的错误路径。于是"我想去配一下
         * runtime 凭证"这件最普通的事,在界面上无路可走,只能手敲 URL。
         *
         * 规格里那是个**三子页菜单**（凭证/镜像/系统）。这里先只给凭证一条直链:
         * 镜像管理与系统状态两个子页尚未实现,先摆一个只有一项的菜单是把空壳做进 UI。
         * ⏳ 那两页落地时,这里换成菜单。
         */}
        <a
          href="/settings/credentials"
          data-testid="nav-settings-credentials"
          className="ml-auto rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          ⚙️ 凭证管理
        </a>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col border-r border-border">
          {waitingInputCount > 0 && (
            <div className="border-b border-border px-3 py-2 text-xs text-yellow-300">
              ⚡ {waitingInputCount} 个任务等待你输入
            </div>
          )}
          <nav className="flex-1 overflow-auto p-2" aria-label="项目分组任务树">
            {groups.map((group) => (
              <section key={group.projectId} className="mb-2">
                <button
                  type="button"
                  aria-current={selectedProjectId === group.projectId || undefined}
                  className={
                    'flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted ' +
                    (selectedProjectId === group.projectId ? 'bg-muted text-foreground' : '')
                  }
                  onClick={() => onSelectProject?.(group.projectId)}
                >
                  <span className="truncate">{group.projectName}</span>
                  <span className="text-muted-foreground">· {group.taskCount}</span>
                  <CloneBadge cloneStatus={group.cloneStatus} />
                </button>
                {!group.collapsed &&
                  (group.tasks.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-muted-foreground">
                      在 {group.projectName} 中发起第一个任务 →
                    </p>
                  ) : (
                    <ul>
                      {group.tasks.map((task) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            aria-current={selectedTaskId === task.id || undefined}
                            className={
                              'w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ' +
                              (selectedTaskId === task.id ? 'bg-muted' : '')
                            }
                            onClick={() => onSelectTask?.(task.id)}
                          >
                            {task.waitingInput ? '🔵 ' : ''}
                            {task.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </section>
            ))}
          </nav>
          <div className="flex flex-col gap-2 border-t border-border p-2">
            {/* 两个「新建」并排：它们本来就是**两个平级的动作**（§9.0 两个弹窗、两个交互）。 */}
            <Button
              size="sm"
              className="w-full"
              data-testid="new-task-entry"
              disabled={newTaskDisabledReason !== undefined}
              title={newTaskDisabledReason}
              onClick={onNewTask}
            >
              ＋ 新任务
            </Button>
            {newTaskDisabledReason !== undefined && (
              <p className="px-1 text-[10px] text-muted-foreground">{newTaskDisabledReason}</p>
            )}
            <Button variant="outline" size="sm" className="w-full" onClick={onNewProject}>
              ＋ 新建项目
            </Button>
          </div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* min-h-0 + overflow-hidden 缺一不可：flex 项默认 `min-height:auto`，
              终端内容一高就把外层高度撑破，页面出现整页滚动条、xterm 的 fit
              又按失控高度算行数 ⇒ 一大片空黑。终端自己有 scrollback，不需要页面滚。 */}
          {terminalSlot}
        </main>
      </div>
      {overlaySlot}
    </div>
  );
}
