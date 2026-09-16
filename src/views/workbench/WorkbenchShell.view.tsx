// 工作台骨架 view（P21-1 / S2）：顶栏 + 左侧项目树（含 clone 徽标）+ 右侧内容区。纯展示，props 驱动。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, KeyRound, Package, Search, Settings, Zap } from 'lucide-react';
import type { ProjectGroup, TaskStatusFilter } from '@/types/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot } from '@/components/ui/status-pill';
import { ProjectGroupHeaderView } from '@/views/project/ProjectGroupHeader.view';
import { CurrentProjectIndicatorView } from '@/views/project/CurrentProjectIndicator.view';

/**
 * 筛选 chips 的显示文案（P21-1 §6 六档口径 + 用户 2026-09-13 裁决新增的第七档）：
 * 全部/准备中/运行中/等待输入/已暂停/异常/已停止。design-notes.md 原型只画了四档，
 * 按产品文档裁决补齐「准备中」「异常」两档（F21-1 §9.1 #15），「已停止」是后补的第七档——
 * 停掉一个任务之后要能找回来，不能只落进「全部」（`types/domain.ts` 的
 * `TaskStatusFilter` 头注释有完整背景）。
 */
const STATUS_FILTER_LABEL: Record<TaskStatusFilter, string> = {
  all: '全部',
  preparing: '准备中',
  running: '运行中',
  waitingInput: '等待输入',
  paused: '已暂停',
  error: '异常',
  stopped: '已停止',
};
const STATUS_FILTER_ORDER: readonly TaskStatusFilter[] = [
  'all',
  'preparing',
  'running',
  'waitingInput',
  'paused',
  'error',
  'stopped',
];

/**
 * 单行放得下的那几档 + 收进「更多」的那几档。
 *
 * 实测（2026-09-14，Playwright 量的真实 DOM，⛔ 不是估算）：侧栏筛选行的可视宽只有
 * **271px**，七档单行要 **356px**，溢出 85px。此前的注释写「400px 侧栏」是错的。
 * 压缩也救不回来：字号 11→10px、`px-2`→`px-1.5`、`gap-1`→`gap-0.5` 全用上才省 60px，
 * 连 gap 去光也只有 72px，仍差 13px，而那时字已经挤到影响辨认。
 *
 * 所以只剩两条路：换行，或把后几档收起来。用户 2026-09-14 裁决选后者
 * —— ⛔ 不换行（推翻不了 09-13「侧栏顶部会显得散」那条），⛔ 不缩短文案，
 * ⛔ 也不要横向滚动条（本次要修的正是那道灰杠）。
 *
 * 前三档合计 38+49+49=136，加「更多」触发器 ≈58 与三个 gap ≈12 → 约 206px，
 * 对 271px 留 65px 余量。⚠️ 想往主行再挪一档前先量一遍：加「等待输入」(60+4) 就是
 * 270px，只剩 1px，换个字体渲染就溢出 —— 而现在没有滚动条，溢出是**直接看不见**，
 * 不像以前还能滑。`FilterChipsFitWithoutScrolling` 那条 story 钉的就是这件事。
 */
const THEME_CHOICES = ['system', 'dark', 'light'] as const;
/** ⚠️「跟随系统」排第一：它是默认值，也是"我不想管这件事"的那个选项。 */
const THEME_LABEL: Record<ThemeChoice, string> = {
  system: '跟随系统',
  dark: '暗色',
  light: '亮色',
};

const PRIMARY_STATUS_FILTERS: readonly TaskStatusFilter[] = ['all', 'preparing', 'running'];
/**
 * ⚠️ 从 `STATUS_FILTER_ORDER` **派生**，⛔ 不手列第二份：两份各写一遍的话，将来加第八档
 * 只往 ORDER 里加、忘了同步这里，那一档就哪儿都点不到了 —— 而且不报错、不变红，
 * 因为没有任何断言会去数"七档是不是都有归宿"。派生保证新增档默认落进「更多」。
 */
const OVERFLOW_STATUS_FILTERS: readonly TaskStatusFilter[] = STATUS_FILTER_ORDER.filter(
  (status) => !PRIMARY_STATUS_FILTERS.includes(status),
);

/** 主题三态（与 `hooks/_shared/useTheme` 同一口径）。 */
export type ThemeChoice = 'system' | 'dark' | 'light';

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
  /**
   * 组头菜单本体：由 container 渲染 `ProjectGroupMenu.view` 并接上
   * **同一个** `useProjectRecovery`（§10.2 A）。本层只负责把它插在正确的组头下。
   */
  /**
   * 按项目渲染组头「⋯」菜单。⚠️ 2026-09-14 从 `groupMenuSlot?: ReactNode` 改成按行调用的
   * 函数：菜单换成 shadcn `DropdownMenu` 之后**触发器住在菜单组件里**，所以每一行都要有
   * 自己的一个实例 —— 旧的单个 slot 只喂给"当前打开的那一行"，其余行会连 ⋯ 按钮都没有。
   * Radix 的 Content 只在展开时才挂载（Portal），每行一个实例不会带来常驻开销。
   */
  renderGroupMenu?: (projectId: string) => ReactNode;
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
  /**
   * 主题偏好与切换（design-notes §4 Phase 5 第 3 条）。
   *
   * ⚠️ 入口放在**设置菜单**里而不是顶栏摆一个太阳/月亮图标：它是一次性设好就不再碰的
   * 偏好，不是高频动作。顶栏那点横向空间留给真的每天要点的东西。
   * ⚠️ 缺省 `'system'` + 可选回调：⛔ 让它必填会逼着每个 story / 测试都传一份，
   * 而它们大多不关心主题。
   */
  theme?: ThemeChoice;
  onThemeChange?: (theme: ThemeChoice) => void;
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
  renderGroupMenu,
  onToggleGroupCollapse,
  searchQuery = '',
  onSearchQueryChange,
  statusFilter = 'all',
  onStatusFilterChange,
  hasNoFilterMatches = false,
  systemStatusHref = '/settings/system',
  theme = 'system',
  onThemeChange,
}: WorkbenchShellProps) {
  const overflowFilterActive = OVERFLOW_STATUS_FILTERS.includes(statusFilter);
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        {/*
          ⚠️ 是 `h1` 不是 `span`（2026-09-15，axe `page-has-heading-one`）：
          每页要有且只有一个一级标题，读屏用户靠它知道"我在哪个应用/哪一页"。
          ⛔ 不要为了排版换回 `span` —— 视觉上它本来就是这一页最大的那行字，
          `font-semibold` 与其余样式一个字没动，改的只是标签语义。
          e2e/a11y.spec.ts 的 `page-has-heading-one` 钉着它。
        */}
        <h1 className="font-semibold">Agent 管理平台</h1>
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
         * 顶栏设置菜单（P20 §8.2「工作台 → 凭证/镜像/系统：顶栏 [设置] 菜单」）。
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
         * 触发器保留可见文字「设置」作为无障碍名，不额外拿 `aria-label` 盖掉它——
         * 前面的齿轮图标纯装饰（`aria-hidden`），去掉它这句名字仍然完整。
         */}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            {/*
              ⚠️ 触发器走 shadcn 官方组合 `DropdownMenuTrigger asChild` + `Button`
              （官方 composition 树就是 Trigger └ Button），⛔ 不往 Trigger 上直接堆
              className。此前那种写法手抄了一遍 hover 和 focus ring —— 等于把 Button
              的样式在这里重新实现一次，一旦 Button 的 focus 环改了，全站按钮都跟着变、
              唯独这个触发器留在原地，而且没有任何东西会报错。
            */}
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                data-testid="nav-settings-menu-trigger"
                className="gap-1 px-2 text-muted-foreground hover:text-foreground"
              >
                <Settings aria-hidden="true" />
                设置
              </Button>
            </DropdownMenuTrigger>
            {/*
              ⚠️ 用 `next/link` 而不是裸 `<a href>`：App Router 里 `<a>` 是**整页刷新**，
              工作台的 Query 缓存、WS 连接、终端会话全部重来 —— 从设置页点回来就得再等
              一次冷启动。`<Link>` 走客户端路由，还会预取目标路由。
              ⚠️ `[&>svg]:size-4` 是 DropdownMenuItem 的**直接子元素**选择器，而这里是
              `Item asChild > Link > svg`，隔了一层够不着 ⇒ 图标尺寸在 Link 上自己声明。
              ⛔ 不改成非 asChild：那样菜单项就不是链接，丢掉中键新标签页 / 右键复制链接。
            */}
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link
                  href="/settings/credentials"
                  data-testid="nav-settings-credentials"
                  className="[&>svg]:size-3.5 [&>svg]:shrink-0"
                >
                  <KeyRound aria-hidden="true" />
                  凭证管理
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href="/settings/images"
                  data-testid="nav-settings-images"
                  className="[&>svg]:size-3.5 [&>svg]:shrink-0"
                >
                  <Package aria-hidden="true" />
                  镜像管理
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link
                  href={systemStatusHref}
                  data-testid="nav-settings-system"
                  className="[&>svg]:size-3.5 [&>svg]:shrink-0"
                >
                  <Settings aria-hidden="true" />
                  系统状态
                </Link>
              </DropdownMenuItem>

              {/*
                外观：三态单选。⚠️ 用 `RadioGroup` 而不是一个「暗色」开关 ——
                「跟随系统」不是「暗色」的反面，它是第三种状态；做成开关就表达不了，
                用户也就没法把已经表过的态**收回去**。
              */}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                外观
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={theme}
                onValueChange={(v) => {
                  const next = THEME_CHOICES.find((t) => t === v);
                  if (next !== undefined) onThemeChange?.(next);
                }}
              >
                {THEME_CHOICES.map((t) => (
                  <DropdownMenuRadioItem
                    key={t}
                    value={t}
                    data-testid={`theme-${t}`}
                    className="text-xs"
                  >
                    {THEME_LABEL[t]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col border-r border-border">
          {waitingInputCount > 0 && (
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-yellow-300">
              <Zap aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {waitingInputCount} 个任务等待你输入
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
            {/*
              ⚠️ 七档单行放不下（实测 356px vs 可视 271px），⛔ 不换行、⛔ 不缩短文案、
              ⛔ 也不要横向滚动条 —— 取舍与实测数字见 `OVERFLOW_STATUS_FILTERS` 头注释。
              前三档留在行内，其余四档收进「更多」。
              ⚠️ 容器保持 `flex-nowrap` 但**不再给 overflow**：现在是"本来就放得下"，
              万一将来文案变长而悄悄溢出，没有滚动条兜底 ⇒ 那几档会直接看不见。
              `FilterChipsFitWithoutScrolling` 用 scrollWidth ≤ clientWidth 钉死这件事，
              ⛔ 不靠肉眼，也⛔ 不靠类名（类名断言拦不住"文案变长"这种溢出）。
            */}
            <div
              className="flex flex-nowrap items-center gap-1"
              role="group"
              aria-label="按状态筛选任务"
              data-testid="task-filter-chips"
            >
              {PRIMARY_STATUS_FILTERS.map((status) => {
                const active = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={active}
                    data-testid={`task-filter-${status}`}
                    className={
                      'shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ' +
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/*
                    ⚠️ 选中项落在收纳档里时，触发器**显示那一档的名字并高亮**，⛔ 不是恒显
                    「更多」：否则筛成「异常」之后整行看不出任何选中痕迹，用户会以为筛选丢了
                    —— 收起来的代价只该是"多点一次"，不该是"看不见自己筛了什么"。
                  */}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={
                      overflowFilterActive
                        ? `更多筛选，当前：${STATUS_FILTER_LABEL[statusFilter]}`
                        : '更多筛选'
                    }
                    data-testid="task-filter-more"
                    data-active={overflowFilterActive ? 'true' : 'false'}
                    className={
                      // chip 造型（药丸、11px、紧凑）盖在 Button 之上：⛔ 只覆盖尺寸与圆角，
                      // hover / focus-visible / disabled 一律留给 Button —— 它跟主行那三个
                      // chip 挨着，交互反馈必须和全站按钮同一套。
                      'h-auto shrink-0 gap-0.5 rounded-full px-2 py-0.5 text-[11px] ' +
                      (overflowFilterActive
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground')
                    }
                  >
                    {overflowFilterActive ? STATUS_FILTER_LABEL[statusFilter] : '更多'}
                    <ChevronDown className="size-3" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-32">
                  <DropdownMenuRadioGroup
                    value={statusFilter}
                    onValueChange={(v) => {
                      // ⛔ 不用 `v as TaskStatusFilter`：Radix 给的是 string，断言只是
                      // 让类型检查闭嘴。在这份闭集里找一遍，找不到就什么都不做。
                      const next = OVERFLOW_STATUS_FILTERS.find((status) => status === v);
                      if (next !== undefined) onStatusFilterChange?.(next);
                    }}
                  >
                    {OVERFLOW_STATUS_FILTERS.map((status) => (
                      <DropdownMenuRadioItem
                        key={status}
                        value={status}
                        data-testid={`task-filter-${status}`}
                        className="text-[11px]"
                      >
                        {STATUS_FILTER_LABEL[status]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
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
                    {...(() => {
                      const menu = renderGroupMenu?.(group.projectId);
                      return menu === undefined || menu === null ? {} : { menuSlot: menu };
                    })()}
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
