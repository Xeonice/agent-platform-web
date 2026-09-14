// 项目分组组头（F21-6 §3）：`[Folder] ProjectName (N) ⋯`，两个 variant。纯展示、props 驱动、零副作用。
//
// 两个 variant 由 `cloneStatus` 派生，不额外开一个 prop（多一个入参就多一种"两处不一致"的可能）：
//   · `normal`      —— `[Folder] ProjectName · N ⋯`（cloning 另带黄色徽标）
//   · `cloneFailed` —— `● [Folder] ProjectName [AlertTriangle] 克隆失败 ⋯`（产品 P21-6 §9；
//     前导的 `●` 是 `StatusDot`（`status="fail"`），design-notes.md §4 Phase 3 第 2 条落地前
//     是手写的 emoji，现在接入 `StatusPill` 极简变体的同一套语义色；`[Folder]` 与
//     `[AlertTriangle]` 同理——本轮（emoji 收口）从字面 emoji 换成 lucide 组件）
//
// ⚠️ **failed 项目在本实现里仍然可以选中**，与 §5/§6 那条「failed 不可选为当前项目、
// 点组头仅展开」不一致 —— 这是**刻意的**，理由回填进了文档：`ProjectRecoveryContainer`
// （§10.2 A 裁决明写"恢复面板留在原地不动"）正是靠"选中失败项目"才渲染得出来的。
// 把选中挡掉，P0-1 那条通路（刷新/切走再回来仍能触达 retry-clone）当场断掉。
//
// 「⋯」的菜单本体是 `ProjectGroupMenu.view`，由 container 决定开合后经 `menuSlot` 插进来
// （views 不持有开合状态；组头只负责给它一个定位锚点）。
import type { ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Folder } from 'lucide-react';
import { StatusDot } from '@/components/ui/status-pill';
import type { ProjectGroup } from '@/types/domain';

export interface ProjectGroupHeaderProps {
  projectId: string;
  projectName: string;
  taskCount: number;
  cloneStatus: ProjectGroup['cloneStatus'];
  selected: boolean;
  onSelect: (projectId: string) => void;
  /**
   * 折叠态（design-notes.md §4 Phase 3 / 原型 `renderTaskTree()` 的 chevron）。
   * 由 `taskListFolds`（store）经 `selectProjectTaskTree` 派生。
   */
  collapsed: boolean;
  /** 点折叠箭头：只切折叠，⛔ 不连带选中项目——两个是不同的动作。 */
  onToggleCollapse: (projectId: string) => void;
  /** 点「⋯」：由 container 记下 openMenuProjectId。 */
  /** 菜单本体（打开时由 container 传入；关闭时为 undefined）。 */
  menuSlot?: ReactNode;
}

export function ProjectGroupHeaderView({
  projectId,
  projectName,
  taskCount,
  cloneStatus,
  selected,
  onSelect,
  collapsed,
  onToggleCollapse,
  menuSlot,
}: ProjectGroupHeaderProps) {
  const failed = cloneStatus === 'failed';

  return (
    <div
      data-testid="project-group-header"
      data-variant={failed ? 'cloneFailed' : 'normal'}
      className="relative flex items-center gap-1"
    >
      {/*
        折叠箭头是**独立的兄弟按钮**，不是嵌进选中按钮里的子节点——`<button>` 不能嵌套
        `<button>`（无效 HTML，且两个动作的语义本来就不同：这个只切"展开/收起"，
        不改变当前选中的项目）。与旁边「⋯」菜单按钮同一个模式（07 §…"⋯"那条注释）。
      */}
      <button
        type="button"
        /*
          ⚠️ 无障碍名**刻意不含项目名**（项目名放 `title`）——理由与旁边「⋯」按钮上的
          注释完全一样：含了的话，`getByRole('button', { name: /项目名/ })` 会同时命中
          这个折叠按钮与下面的组头选中按钮，全仓（含 e2e）按项目名点项目的地方一起变成
          strict-mode 二义匹配。
        */
        aria-label={collapsed ? '展开分组' : '收起分组'}
        title={`${collapsed ? '展开' : '收起'} ${projectName}`}
        aria-expanded={!collapsed}
        data-testid="project-group-toggle"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => {
          onToggleCollapse(projectId);
        }}
      >
        <ChevronDown
          aria-hidden="true"
          className={'h-3.5 w-3.5 transition-transform' + (collapsed ? ' -rotate-90' : '')}
        />
      </button>
      <button
        type="button"
        aria-current={selected || undefined}
        className={
          'flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted ' +
          (selected ? 'bg-muted text-foreground' : '')
        }
        onClick={() => {
          onSelect(projectId);
        }}
      >
        {/* 组头徽标接入 StatusPill 的极简变体（design-notes.md §4 Phase 3 第 2 条）：
            纯色 dot 换掉此前手写的 emoji——语义（fail）与颜色都来自同一套 token，
            八态本体（`statusPillVariants`）一个字节没动。 */}
        {failed && <StatusDot status="fail" label="克隆失败" />}
        <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        {/* 计数徽标**右对齐**（原型 `renderTaskTree()`：`<span class="text-xs ...">${g.tasks.length}</span>`
            单独一格，不再拼进名字后面的「· N」——名字长时两者会挤在一起不可读。 */}
        <span className="shrink-0 text-xs text-muted-foreground" data-testid="project-group-count">
          {taskCount}
        </span>
        {cloneStatus === 'cloning' && (
          <span className="rounded bg-yellow-500/15 px-1 text-[10px] text-yellow-300">克隆中</span>
        )}
        {failed && (
          <span className="flex items-center gap-0.5 rounded bg-red-500/15 px-1 text-[10px] text-red-300">
            <AlertTriangle aria-hidden="true" className="h-2.5 w-2.5" />
            克隆失败
          </span>
        )}
      </button>

      {/*
        「⋯」：项目的管理入口。在它之前，删除项目在界面上根本够不着（§10.1）。
        ⚠️ **触发器不在这里画**（2026-09-14 起）：它连同菜单一起住在 `ProjectGroupMenu.view`，
        由 shadcn `DropdownMenuTrigger asChild` 承担。Radix 要 trigger 与 content 同树才能接上
        定位、焦点归位和 `aria-expanded`；⛔ 不要再在组头补一个自己的 ⋯ 按钮，那会变成两个
        触发器抢同一个菜单。本组件只负责把它摆在这一行的末尾。
      */}
      {menuSlot}
    </div>
  );
}
