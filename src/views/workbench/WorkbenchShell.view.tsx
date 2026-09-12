// 工作台骨架 view（P21-1 / S2）：顶栏 + 左侧项目树（含 clone 徽标）+ 右侧内容区。纯展示，props 驱动。
import type { ReactNode } from 'react';
import { KeyRound, Package, Search, Settings } from 'lucide-react';
import type { ProjectGroup, TaskStatusFilter } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/status-pill';
import { ProjectGroupHeaderView } from '@/views/project/ProjectGroupHeader.view';
import { CurrentProjectIndicatorView } from '@/views/project/CurrentProjectIndicator.view';

/**
 * 筛选 chips 的显示文案（P21-1 §6 六档口径：全部/准备中/运行中/等待输入/已暂停/异常）。
 * design-notes.md 原型只画了四档，按产品文档裁决补齐「准备中」「异常」两档（F21-1 §9.1 #15）。
 */
const STATUS_FILTER_LABEL: Record<TaskStatusFilter, string> = {
  all: '全部',
  preparing: '准备中',
  running: '运行中',
  waitingInput: '等待输入',
  paused: '已暂停',
  error: '异常',
};
const STATUS_FILTER_ORDER: readonly TaskStatusFilter[] = [
  'all',
  'preparing',
  'running',
  'waitingInput',
  'paused',
  'error',
];

export interface WorkbenchShellProps {
  groups: ProjectGroup[];
  waitingInputCount: number;
  /**
   * 顶栏健康提示。`null` ⇒ **整行不渲染**（design-notes.md §1 问题 5 / §4 Phase 3 第 4 条）：
   * 「后端健康（HTTP 200）」这类常态文案用户拿它做不了任何决定，只会占地方；只有异常时
   * container 才会给出非空字符串（如「后端不可用」），此时才挂载。
   */
  healthLabel: string | null;
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
  /** 组头折叠箭头（design-notes.md §4 Phase 3）：只切折叠，不改变选中项目。 */
  onToggleGroupCollapse?: (projectId: string) => void;

  // —— 搜索 + 状态筛选（design-notes.md §4 Phase 3；硬要求：必须是真过滤，非摆设）——
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  statusFilter?: TaskStatusFilter;
  onStatusFilterChange?: (status: TaskStatusFilter) => void;
  /**
   * 过滤后一条任务都不剩，且原始树里本来就有任务（`useProjectTaskTree` 的
   * `hasNoFilterMatches`）。⛔ 与"这个人还没建过任务"是两种空态，不共用一句文案。
   */
  hasNoFilterMatches?: boolean;
  /** 系统状态入口（并行开发中的 21-5 页面，本文件只负责给一个链接）。 */
  systemStatusHref?: string;
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
  onToggleGroupCollapse,
  searchQuery = '',
  onSearchQueryChange,
  statusFilter = 'all',
  onStatusFilterChange,
  hasNoFilterMatches = false,
  systemStatusHref = '/settings/system',
}: WorkbenchShellProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <span className="font-semibold">Agent 管理平台</span>
        {healthLabel !== null && (
          <span className="text-xs text-error" data-testid="health-label">
            {healthLabel}
          </span>
        )}
        {/* 当前项目指示器（F21-6 §3）：只读 + 点击树内定位，⛔ 无下拉（§9.1 #2 否定性验收）。 */}
        <CurrentProjectIndicatorView
          projectName={currentProjectName}
          onLocate={() => {
            onLocateCurrentProject?.();
          }}
        />
        {/*
         * ⌘K 快捷提示（design-notes.md §4 Phase 3 / 原型顶栏）。⚠️ **纯视觉提示，非功能**：
         * 命令面板本身不在这一轮范围内——原型里这个徽标同样是静态的（点了没有反应），
         * 这里对齐的是原型的实际样子，不是替它多实现一个还没设计过交互的命令面板。
         */}
        <span
          data-testid="command-palette-hint"
          className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          aria-hidden="true"
        >
          ⌘K
        </span>
        {/*
         * 顶栏设置菜单（P20 §8.2「工作台 → 凭证/镜像/系统：顶栏 ⚙️ 设置菜单」）。
         *
         * ⚠️ 在此之前 `/settings/credentials` **没有任何常规入口**——全仓只有两处
         * `router.push` 能到它,且都是 **Git 克隆失败**的错误路径。于是"我想去配一下
         * runtime 凭证"这件最普通的事,在界面上无路可走,只能手敲 URL。
         *
         * ⚠️ **本轮收口**：design-notes.md §4 Phase 3 第 4 条原写的是「镜像管理落地时，
         * 这两条直链再收进一个真菜单」——`/settings/images`（F21-4 §2）已经落地，两条并列
         * 直链改收成一个 shadcn `DropdownMenu`，三子项（凭证/镜像/系统）与
         * `app/settings/layout.tsx` 的左侧菜单同一套图标语义（KeyRound/Package/Settings）。
         * Radix primitive 自带键盘操作（Enter/Space 展开、方向键在项间移动、Esc 关闭），
         * 触发器保留可见文字「⚙️ 设置」作为无障碍名，不额外拿 `aria-label` 盖掉它。
         */}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-testid="nav-settings-menu-trigger"
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              ⚙️ 设置
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href="/settings/credentials" data-testid="nav-settings-credentials">
                  <KeyRound aria-hidden="true" className="h-3.5 w-3.5" />
                  凭证管理
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href="/settings/images" data-testid="nav-settings-images">
                  <Package aria-hidden="true" className="h-3.5 w-3.5" />
                  镜像管理
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={systemStatusHref} data-testid="nav-settings-system">
                  <Settings aria-hidden="true" className="h-3.5 w-3.5" />
                  系统状态
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col border-r border-border">
          {waitingInputCount > 0 && (
            <div className="border-b border-border px-3 py-2 text-xs text-yellow-300">
              ⚡ {waitingInputCount} 个任务等待你输入
            </div>
          )}
          {/*
            搜索 + 状态筛选（design-notes.md §4 Phase 3 / 原型 `#taskTree` 上方）。
            硬要求：两者都是真过滤——`onSearchQueryChange`/`onStatusFilterChange` 接的是
            container 里驱动 `useProjectTaskTree` 的真实 state，⛔ 不是只有外观的摆设。
          */}
          <div className="flex flex-col gap-2 border-b border-border p-2">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                value={searchQuery}
                placeholder="搜索任务"
                aria-label="搜索任务"
                data-testid="task-search-input"
                className="h-8 pl-7 text-xs"
                onChange={(e) => {
                  onSearchQueryChange?.(e.target.value);
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="按状态筛选任务">
              {STATUS_FILTER_ORDER.map((status) => {
                const active = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    data-testid={`task-filter-${status}`}
                    className={
                      'rounded-full px-2 py-0.5 text-[11px] ' +
                      (active
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                    }
                    onClick={() => {
                      onStatusFilterChange?.(status);
                    }}
                  >
                    {STATUS_FILTER_LABEL[status]}
                  </button>
                );
              })}
            </div>
          </div>
          <nav className="flex-1 overflow-auto p-2" aria-label="项目分组任务树">
            {/*
              ⭐ 「搜不到时说什么」（硬要求）：过滤后一条任务都不剩，且原本就有任务
              （⛔ 不是"这个人还没建过任务"那种空态，两句话不能混）。
            */}
            {hasNoFilterMatches ? (
              <p
                className="p-3 text-center text-xs text-muted-foreground"
                data-testid="task-search-no-results"
              >
                {searchQuery.trim() !== ''
                  ? `没有找到匹配“${searchQuery.trim()}”的任务`
                  : `没有${STATUS_FILTER_LABEL[statusFilter]}的任务`}
              </p>
            ) : (
              groups.map((group) => (
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
                    collapsed={group.collapsed}
                    onToggleCollapse={(projectId) => {
                      onToggleGroupCollapse?.(projectId);
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
                                'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-muted ' +
                                (selectedTaskId === task.id ? 'bg-muted' : '')
                              }
                              onClick={() => onSelectTask?.(task.id)}
                            >
                              {/* 任务树状态点接入 StatusPill 的极简变体（design-notes.md §4
                                  Phase 3 第 2 条 / 原型 `.dot` 类）：换掉此前手写的 🔵 emoji，
                                  等待输入用 warn、其余用 ok——与原型 `renderTaskTree()` 的
                                  两态判据一致。 */}
                              <StatusDot
                                status={task.waitingInput ? 'warn' : 'ok'}
                                label={task.waitingInput ? '等待你输入' : '运行中'}
                              />
                              <span className="truncate">{task.name}</span>
                            </button>
                            {/*
                              副行「活跃于 X 前 · 等待输入」（design-notes.md §4 Phase 3 /
                              原型 `renderTaskTree()`）。⛔ **硬要求：没有真实时间戳就不渲染
                              这一句里的「活跃于」部分**——`task.activityLabel` 由
                              `useProjectTaskTree` 基于真实 `lastActiveAt` 派生，拿不到时是
                              `undefined`（`@/lib/project/taskActivity` 的说明），这里不拿
                              估算值顶替。等待输入是独立的真实字段，即使没有活跃时间也照常显示。
                            */}
                            {(task.activityLabel !== undefined || task.waitingInput) && (
                              <p
                                className="-mt-0.5 truncate px-2 pb-1 pl-7 text-[11px] text-muted-foreground"
                                data-testid={`task-activity-${task.id}`}
                              >
                                {task.activityLabel}
                                {task.activityLabel !== undefined && task.waitingInput && ' · '}
                                {task.waitingInput && (
                                  <span className="text-warning">等待输入</span>
                                )}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    ))}
                </section>
              ))
            )}
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
