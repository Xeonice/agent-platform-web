// 项目详情面板（F21-6 §3.3）。纯展示、props 驱动、零副作用。
//
// ⚠️ **2026-09-14 从 `ProjectMenuPanel` 拆出来**。旧面板把三件事塞在一起：详情表格 +
// [保留下来的成果]/[自动化规则] 两个入口 + [删除项目…]。三个毛病：
//  ① 两个入口在这里是**二级**的（⋯ → 项目菜单 → 自动化规则，三次点击），现已提到 ⋯ 菜单一级；
//  ② [删除项目…] 与 ⋯ 菜单里那个**重复**，同一个不可逆动作两个入口；
//  ③ 详情里第一行「名称」和面板标题下方的项目名**重复显示**。
// 拆完之后：本面板只回答「这个项目现在什么状况」，⛔ 不承载任何跳转与危险动作。
//
// ⚠️ 摘要计数（成果数 / 规则数）**必须能表达"不知道"**：加载中与真的是 0 是两回事。
// 传 `undefined` ⇒ 渲染「—」而不是「0 项」—— 报 0 会让用户以为自己什么都没留下，
// 而实际可能只是还没加载完。⛔ 不要在 container 里用 `?? 0` 把这个区别抹掉。
import type { ProjectCloneStatus } from '@/types/project';

export interface ProjectDetailPanelProps {
  /*
   * ⛔ **刻意不接 `projectName`**：项目名由弹层标题区呈现，本面板再列一行就是同一个值
   * 占两行（拆分前的毛病之一）。不接这个 prop，"顺手补一行名称"在类型上就做不到 ——
   * 与下面「不接 source / repoUrl」同一手法。
   */
  cloneStatus: ProjectCloneStatus;
  taskCount: number;
  createdAt: string;
  /** 已保留成果数；`undefined` = 还不知道（加载中 / 取不到），⛔ 不是 0。 */
  retainedCount?: number;
  /** 自动化规则数；同上。 */
  automationCount?: number;
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

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className="min-w-0 truncate text-sm"
        {...(testId === undefined ? {} : { 'data-testid': testId })}
      >
        {value}
      </dd>
    </div>
  );
}

/** `undefined` ⇒「—」。见文件头：加载中和真的是 0 必须看得出区别。 */
function countText(n: number | undefined, unit: string): string {
  return n === undefined ? '—' : `${String(n)} ${unit}`;
}

export function ProjectDetailPanelView({
  cloneStatus,
  taskCount,
  createdAt,
  retainedCount,
  automationCount,
}: ProjectDetailPanelProps) {
  return (
    <div data-testid="project-detail-panel" className="flex flex-col">
      <dl className="px-5 py-3">
        {/*
          ⛔ **没有「名称」行**：面板标题下方已经写着项目名，再列一遍是同一个值占两行。
          ⛔ **不渲染「来源」行**（§6 产品已定）：无论 git 克隆、空项目还是 failed 转空，
             一律不显示。因此"转空之后来源显示什么"这个问题在 UI 上根本不存在。
             `source` / `repoUrl` 仍在数据里（后端语义需要，只读条也在用），只是**本面板不呈现**
             —— props 里连这两个字段都不接，让"顺手加一行来源"这件事在类型上就做不到。
        */}
        <Row label="状态" value={STATUS_LABEL[cloneStatus]} />
        <Row label="任务数" value={String(taskCount)} />
        <Row label="创建时间" value={formatTime(createdAt)} />

        {/*
          摘要两行：让这个面板真的回答"这个项目现在什么状况"，而不是四行元数据。
          它们只是**读数**，点不动 —— 去处在 ⋯ 菜单里，⛔ 不在这里再开一个入口
          （那正是拆分前的病：同一个去处散在两层）。
        */}
        <Row
          label="已保留成果"
          value={countText(retainedCount, '项')}
          testId="project-detail-retained-count"
        />
        <Row
          label="自动化规则"
          value={countText(automationCount, '条')}
          testId="project-detail-automation-count"
        />
      </dl>

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
          className="px-5 pb-3 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="project-detail-failed-hint"
        >
          克隆没成功。[重试克隆] 和 [改为空项目] 在项目名右边的「⋯」菜单里，不用删掉重建。
        </p>
      )}
    </div>
  );
}
