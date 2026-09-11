// 组头「⋯」下拉菜单（F21-6 §3 / §5）。纯展示、props 驱动、零副作用。
//
// ⚠️ **failed 态三出口（[重试克隆] / [改为空项目] / [删除]）不持有任何实现**（§10.2 A 裁决）：
// 前两项由 container 接到**同一个** `hooks/project/useProjectRecovery.ts` 上——恢复面板
// （`ProjectRecoveryContainer`）用的就是它。⛔ 全仓只许有一处持有 `retry-clone`：
// 菜单自己再发一次，就会出现"点一下发两个请求"，而两处的乐观回退逻辑还会互相打架。
//
// ⚠️ [取消克隆（保留项目）] 与 [删除项目…] **刻意长得不一样**（§10.6 第 2 条）：
// 前者是 `cancel-clone`，停下克隆、项目留在树里；后者对 cloning 项目会先取消克隆
// **再把项目一起删掉**。文案像了，用户就会拿删除当"取消"用，而那是不可逆的。
import type { ProjectCloneStatus } from '@/types/project';

export interface ProjectGroupMenuProps {
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  /** 恢复动作在途（retry / convert / cancel），期间禁用避免重复发。 */
  busy?: boolean;
  /** 恢复动作的可见错误（container 从 `useProjectRecovery` / cancel mutation 取）。 */
  actionError?: string;
  onOpenPanel: () => void;
  onRetryClone: () => void;
  onConvertToEmpty: () => void;
  onCancelClone: () => void;
  onRequestDelete: () => void;
}

function Item({
  label,
  testId,
  disabled = false,
  danger = false,
  onSelect,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-testid={testId}
      className={
        'w-full rounded px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50 ' +
        (danger ? 'text-red-300' : '')
      }
      onClick={() => {
        onSelect();
      }}
    >
      {label}
    </button>
  );
}

export function ProjectGroupMenuView({
  projectName,
  cloneStatus,
  busy = false,
  actionError,
  onOpenPanel,
  onRetryClone,
  onConvertToEmpty,
  onCancelClone,
  onRequestDelete,
}: ProjectGroupMenuProps) {
  return (
    <div
      role="menu"
      aria-label={`${projectName} 项目菜单`}
      data-testid="project-group-menu"
      className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-background p-1 shadow-lg"
    >
      <Item label="项目菜单…" testId="group-menu-open-panel" onSelect={onOpenPanel} />

      {/* failed 三出口的前两项（第三项 [删除] 在下面，与正常态共用同一个入口）。 */}
      {cloneStatus === 'failed' && (
        <>
          <Item
            label="重试克隆"
            testId="group-menu-retry-clone"
            disabled={busy}
            onSelect={onRetryClone}
          />
          <Item
            label="改为空项目"
            testId="group-menu-convert-to-empty"
            disabled={busy}
            onSelect={onConvertToEmpty}
          />
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
        <Item
          label="取消克隆（保留项目）"
          testId="group-menu-cancel-clone"
          disabled={busy}
          onSelect={onCancelClone}
        />
      )}

      <Item
        label="删除项目…"
        testId="group-menu-delete"
        danger
        disabled={busy}
        onSelect={onRequestDelete}
      />

      {actionError !== undefined && actionError !== '' && (
        <p role="alert" className="px-2 py-1 text-[10px] text-red-400">
          {actionError}
        </p>
      )}
    </div>
  );
}
