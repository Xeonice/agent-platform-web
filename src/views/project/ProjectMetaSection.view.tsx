// 项目菜单侧弹层的元信息区（F21-6 §3「ProjectMetaSection.view」）：名称 / 状态 / 任务数 / 创建时间。
// 纯展示、props 驱动、零副作用。
//
// ⛔ **不渲染「来源」行**（§6 产品已定）：无论 git 克隆、空项目还是 failed 转空，一律不显示。
// 因此"转空之后来源显示什么"这个问题在 UI 上根本不存在。`source` / `repoUrl` 仍在数据里
// （后端语义需要，只读条也在用），只是**本面板不呈现** —— props 里连这两个字段都不接，
// 让"顺手加一行来源"这件事在类型上就做不到。
import type { ProjectCloneStatus } from '@/types/project';

export interface ProjectMetaSectionProps {
  projectName: string;
  cloneStatus: ProjectCloneStatus;
  taskCount: number;
  createdAt: string;
}

/**
 * cloneStatus → 人话。三值全覆盖（Record 而非 if 链：后端加第四值时 tsc 就红，§4）。
 * 「就绪」换成「可用」：前者是内部状态机的词，用户读的是"这个项目现在能不能开工"。
 */
const STATUS_LABEL: Record<ProjectCloneStatus, string> = {
  ready: '可用',
  cloning: '正在克隆',
  failed: '克隆失败',
};

/** ISO → 本地可读；解析不出来就原样吐回去（不吞掉后端给的字符串）。 */
function formatTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm">{value}</dd>
    </div>
  );
}

export function ProjectMetaSectionView({
  projectName,
  cloneStatus,
  taskCount,
  createdAt,
}: ProjectMetaSectionProps) {
  return (
    <dl data-testid="project-meta-section" className="border-b border-border px-5 py-3">
      <Row label="名称" value={projectName} />
      <Row label="状态" value={STATUS_LABEL[cloneStatus]} />
      <Row label="任务数" value={String(taskCount)} />
      <Row label="创建时间" value={formatTime(createdAt)} />

      {/*
        ★ **failed 态下这个面板此前是一条死路。**

        它只写一句「状态：克隆失败」，而同一个面板里能点的只有 [删除项目…] ——
        [重试克隆] / [改为空项目] 在**另一个**菜单（组头「⋯」）里。于是用户看到的是
        "这个项目挂了，我只能删掉它"，而两条不用删的出路就在一次点击之外。

        ⛔ 不许把那两个动作搬进来（全仓只许有一处持有 `retry-clone`，见
           `ProjectGroupMenu.view` 文件头）。要补的是**指路**，不是第二个入口。
      */}
      {cloneStatus === 'failed' && (
        <p
          className="pt-1 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="project-meta-failed-hint"
        >
          克隆没成功。[重试克隆] 和 [改为空项目] 在项目名右边的「⋯」菜单里，不用删掉重建。
        </p>
      )}
    </dl>
  );
}
