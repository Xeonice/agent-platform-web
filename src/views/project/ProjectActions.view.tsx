// 项目菜单侧弹层的动作区（F21-6 §3「ProjectActions.view」/ §10.5）。
//
// ⚠️ **这一期只有 [删除] 一个真按钮。** 重命名 / 归档见 §10.2 D（2026-08-31 裁决：不做
// —— 端点都不存在，且「归档」的语义从未定义过）。⛔ 不出占位灰按钮：一个点不动的按钮
// 比没有更让人困惑，它会让用户以为"功能在，只是我这会儿用不了"，然后去找那个不存在的条件。
import { Button } from '@/components/ui/button';

export interface ProjectActionsProps {
  /** 删除请求在途：按钮禁用，防连点起两次不可逆操作。 */
  busy?: boolean;
  onRequestDelete: () => void;
}

export function ProjectActionsView({ busy = false, onRequestDelete }: ProjectActionsProps) {
  return (
    <div data-testid="project-actions" className="flex flex-col gap-2 px-5 py-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        data-testid="project-delete-entry"
        className="w-full justify-start border-red-500/40 text-red-300 hover:bg-red-500/10"
        onClick={() => {
          onRequestDelete();
        }}
      >
        🗑 删除项目…
      </Button>
    </div>
  );
}
