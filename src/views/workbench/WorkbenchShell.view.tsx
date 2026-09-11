// 工作台骨架 view（P21-1 / S2）：顶栏 + 左侧项目树（含 clone 徽标）+ 右侧内容区。纯展示，props 驱动。
import type { ReactNode } from 'react';
import type { ProjectGroup } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { ProjectGroupHeaderView } from '@/views/project/ProjectGroupHeader.view';
import { CurrentProjectIndicatorView } from '@/views/project/CurrentProjectIndicator.view';

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

  // —— 项目菜单整块（F21-6 §10）——
  /** 当前项目名（顶栏指示器；未选中给 null）。 */
  currentProjectName?: string | null;
  /** 指示器点击 = **只做树内定位展开**（§5），⛔ 不是下拉、不承载管理入口。 */
  onLocateCurrentProject?: () => void;
  /** 组头「⋯」当前展开的是哪个项目的菜单（null = 都没开）。 */
  openMenuProjectId?: string | null;
  onOpenGroupMenu?: (projectId: string) => void;
  /**
   * 组头菜单本体：由 container 渲染 `ProjectGroupMenu.view` 并接上
   * **同一个** `useProjectRecovery`（§10.2 A）。本层只负责把它插在正确的组头下。
   */
  groupMenuSlot?: ReactNode;
}

// ⚠️ 组头（含 clone 徽标与「⋯」）本轮抽成了 `ProjectGroupHeader.view`（F21-6 §10.5）：
// 它是**项目**的组件，不是工作台骨架的一部分，而"组头上有没有管理入口"这件事
// 恰恰是这一期要改的（在此之前组头是纯按钮，删除项目在界面上够不着）。

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
  currentProjectName = null,
  onLocateCurrentProject,
  openMenuProjectId = null,
  onOpenGroupMenu,
  groupMenuSlot,
}: WorkbenchShellProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <span className="font-semibold">Agent 管理平台</span>
        <span className="text-xs text-muted-foreground" data-testid="health-label">
          {healthLabel}
        </span>
        {/* 当前项目指示器（F21-6 §3）：只读 + 点击树内定位，⛔ 无下拉（§9.1 #2 否定性验收）。 */}
        <CurrentProjectIndicatorView
          projectName={currentProjectName}
          onLocate={() => {
            onLocateCurrentProject?.();
          }}
        />
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
                <ProjectGroupHeaderView
                  projectId={group.projectId}
                  projectName={group.projectName}
                  taskCount={group.taskCount}
                  cloneStatus={group.cloneStatus}
                  selected={selectedProjectId === group.projectId}
                  onSelect={(projectId) => {
                    onSelectProject?.(projectId);
                  }}
                  onOpenMenu={(projectId) => {
                    onOpenGroupMenu?.(projectId);
                  }}
                  {...(openMenuProjectId === group.projectId && groupMenuSlot !== undefined
                    ? { menuSlot: groupMenuSlot }
                    : {})}
                />
                {!group.collapsed &&
                  (group.tasks.length === 0 ? (
                    /**
                     * ⚠️ **它此前是个 `<p>`，却带着一个 `→`。**
                     * 箭头是"这里能点"的承诺，而它点不动 —— 用户点上去没有任何反应，
                     * 比不给这句话更糟。⇒ 改成真按钮：点它 = 选中这个项目 + 打开新建任务弹层。
                     * ⛔ 别只把箭头删掉了事：空组下确实需要一个发起入口，那正是这行字的用意。
                     */
                    <button
                      type="button"
                      data-testid={`empty-group-new-task-${group.projectId}`}
                      /**
                       * ⚠️ 可见文案**刻意不含项目名**（项目名放 `title`）——组头就在上一行，
                       * 上下文不丢；而含了项目名的话，`getByRole('button', { name: /项目名/ })`
                       * 会同时命中组头按钮与这一条，全仓（含 e2e）按项目名点项目的地方
                       * 一起变成 strict-mode 二义匹配。这与同组「⋯」按钮上那条注释是同一条纪律。
                       */
                      title={`在 ${group.projectName} 中发起第一个任务`}
                      className="w-full rounded px-1 py-1 text-left text-xs text-muted-foreground underline-offset-2 hover:bg-muted hover:text-foreground hover:underline"
                      onClick={() => {
                        // 先把归属定下来再开弹层：弹窗里没有项目下拉，归属继承选中项（§9.0）。
                        onSelectProject?.(group.projectId);
                        onNewTask?.();
                      }}
                    >
                      发起第一个任务 →
                    </button>
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
