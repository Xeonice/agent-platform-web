// 组头「⋯」菜单（F21-6 §3 / §5）。纯展示、props 驱动、零副作用。
//
// ⚠️ **2026-09-14 重构：从手写 `role="menu"` 换成 shadcn `DropdownMenu`，并把二级面板拍平。**
//
// 旧结构是两层：`⋯` → 菜单里一项叫「项目菜单…」→ 打开一个侧弹层，弹层里才是
// [保留下来的成果] / [自动化规则] / [删除项目…]。三个毛病：
//  ① 一个菜单里有个叫「项目菜单」的项，自指且不含信息 —— 用户读不出点进去会看到什么；
//  ② 到自动化规则要点三次（⋯ → 项目菜单… → 自动化规则）；
//  ③ **[删除项目…] 在两层里各出现一次**，同一个不可逆动作两个入口。
// 现在所有去处都在这一层平铺，删除只此一个入口。项目详情不再和操作混在一块，
// 改由 `ProjectDetailPanel` 独立承担（菜单里是一项，点开是独立面板）。
//
// ⚠️ **触发器包含在本组件内**（`DropdownMenuTrigger asChild` + `Button`）：Radix 要求
// trigger 与 content 在同一棵组件树里才能接上定位、焦点与 `aria-expanded`。⛔ 不要再退回
// 「组头自己画一个 ⋯ 按钮、菜单经 slot 插进来」那种写法 —— 那样 Radix 管不到触发器，
// 键盘操作（Enter/Space/方向键/Esc）与焦点归位全要自己重写一遍。
//
// ⚠️ **failed 态三出口（[重试克隆] / [改为空项目] / [删除]）不持有任何实现**（§10.2 A 裁决）：
// 前两项由 container 接到**同一个** `hooks/project/useProjectRecovery.ts` 上——恢复面板
// （`ProjectRecoveryContainer`）用的就是它。⛔ 全仓只许有一处持有 `retry-clone`：
// 菜单自己再发一次，就会出现"点一下发两个请求"，而两处的乐观回退逻辑还会互相打架。
//
// ⚠️ **这一期只有 [删除] 一个真的破坏性动作**（原 `ProjectActions.view` 文件头，随该组件
// 删除搬到这里）。重命名 / 归档见 §10.2 D（2026-08-31 裁决：不做 —— 端点都不存在，且
// 「归档」的语义从未定义过）。⛔ 不出占位灰菜单项：一个点不动的项比没有更让人困惑，
// 它会让用户以为"功能在，只是我这会儿用不了"，然后去找那个并不存在的条件。
//
// ⚠️ [取消克隆（保留项目）] 与 [删除项目…] **刻意长得不一样**（§10.6 第 2 条）：
// 前者是 `cancel-clone`，停下克隆、项目留在树里；后者对 cloning 项目会先取消克隆
// **再把项目一起删掉**。文案像了，用户就会拿删除当"取消"用，而那是不可逆的。
import { Gift, MoreHorizontal, Settings, Trash2, Info } from 'lucide-react';
import type { ProjectCloneStatus } from '@/types/project';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ProjectGroupMenuProps {
  projectId: string;
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  /** 受控开合：container 要靠它决定给哪个项目加载 recovery / cancel 的 hook。 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 恢复动作在途（retry / convert / cancel），期间禁用避免重复发。 */
  busy?: boolean;
  /** 恢复动作的可见错误（container 从 `useProjectRecovery` / cancel mutation 取）。 */
  actionError?: string;
  onOpenDetail: () => void;
  onOpenRetainedVolumes: () => void;
  onOpenAutomations: () => void;
  onRetryClone: () => void;
  onConvertToEmpty: () => void;
  onCancelClone: () => void;
  onRequestDelete: () => void;
}

export function ProjectGroupMenuView({
  projectId,
  projectName,
  cloneStatus,
  open,
  onOpenChange,
  busy = false,
  actionError,
  onOpenDetail,
  onOpenRetainedVolumes,
  onOpenAutomations,
  onRetryClone,
  onConvertToEmpty,
  onCancelClone,
  onRequestDelete,
}: ProjectGroupMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        {/*
          ⚠️ 无障碍名**刻意不含项目名**（只放进 `title`）。含了的话，
          `getByRole('button', { name: /项目名/ })` 会同时命中组头按钮与这个「⋯」，
          全仓（含 e2e）按项目名点项目的地方会一起变成 strict-mode 二义匹配。
          菜单本体的 `DropdownMenuLabel` 带着项目名，上下文不丢。
        */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="项目菜单"
          title={`${projectName} 的项目菜单`}
          data-testid="project-group-menu-trigger"
          data-project-id={projectId}
          className="size-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56" data-testid="project-group-menu">
        {/* 菜单归属哪个项目 —— 旧版靠「项目菜单…」那一项旁边的名字交代，现在由 Label 承担。 */}
        <DropdownMenuLabel className="truncate">{projectName}</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem data-testid="group-menu-open-detail" onSelect={onOpenDetail}>
          <Info aria-hidden="true" />
          项目详情
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="group-menu-open-retained" onSelect={onOpenRetainedVolumes}>
          <Gift aria-hidden="true" />
          保留下来的成果
        </DropdownMenuItem>
        <DropdownMenuItem data-testid="group-menu-open-automations" onSelect={onOpenAutomations}>
          <Settings aria-hidden="true" />
          自动化规则
        </DropdownMenuItem>

        {/* failed 三出口的前两项（第三项 [删除] 在下面，与正常态共用同一个入口）。 */}
        {cloneStatus === 'failed' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="group-menu-retry-clone"
              disabled={busy}
              onSelect={onRetryClone}
            >
              重试克隆
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="group-menu-convert-to-empty"
              disabled={busy}
              onSelect={onConvertToEmpty}
            >
              改为空项目
            </DropdownMenuItem>
            {/*
              ★ **[改为空项目] 是不可逆动作，界面上此前一个字都没说它留下什么。**

              产品 §6 定得很清楚：项目 ID 留、已经关联的任务留，只是工作区变成空的。
              不说，用户按之前只知道"要改成空的"，不知道自己会不会连任务一起弄丢
              —— 于是要么不敢按（那这条出路等于没有），要么按了之后去找一个并不存在的损失。

              ⚠️ **「改完还能不能变回 git 项目」这一句刻意没写**：产品文档没裁过，而代码上
                 `retry-clone` 只允许 `failed` 态、改完是 `ready` ⇒ **事实上回不去**。
                 把"回不去"写死是替产品下裁决，写"以后可以"则是撒谎 —— 两个都不行。
                 已列进交付报告等裁决；⛔ 在裁决之前不要往这句里加"不可逆"或"以后可以改回"。
            */}
            <p className="px-2 py-1 text-[10px] leading-relaxed text-muted-foreground">
              [改为空项目]：项目和它下面已有的任务都留着，只是工作区从空的开始，不再关联这个仓库。
            </p>
          </>
        )}

        {/* cloning：**保留项目**地停下克隆。与下面的删除是两件事。 */}
        {cloneStatus === 'cloning' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="group-menu-cancel-clone"
              disabled={busy}
              onSelect={onCancelClone}
            >
              取消克隆（保留项目）
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid="group-menu-delete"
          disabled={busy}
          onSelect={onRequestDelete}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 aria-hidden="true" />
          删除项目…
        </DropdownMenuItem>

        {actionError !== undefined && actionError !== '' && (
          <p
            role="alert"
            data-testid="group-menu-action-error"
            className="px-2 py-1 text-[10px] leading-relaxed text-destructive"
          >
            {actionError}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
