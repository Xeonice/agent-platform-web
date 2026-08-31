// 项目只读条（F21-6 §9.2）：主区**顶部**一条只读信息 —— 远端地址 / 分支 / 基线体积 / 最后同步。
// 纯展示、props 驱动、零副作用。
//
// **它不是详情页**：工作台主区在"没选任务"时本来就是空的，为四个字段开一个页面不成比例。
//
// ⚠️ **只读**：改远端、切默认分支、重新 clone 都**不在这条上**。它回答的是
// "我在拿什么代码干活"，不是项目管理。唯一的动作是 [重新同步]（§9.3，仅 `ready` 态）。
//
// ⚠️ 一个刻意不做呈现的语义（§9.3）：同步只更新**基线**，已有 Task 的工作区一律不动
//（它们是当时的写时复制副本）。于是同一项目下的两个 Task 可能跑在不同代码上，而界面上
// 看不出来 —— 这是**有意识留下的缺口**，不是遗漏；本轮只用「最后同步」这一格让
// "我的基线是什么时候的"可见。
import type { ProjectSourceType } from '@/types/project';
import { Button } from '@/components/ui/button';

export interface ProjectInfoBarProps {
  projectName: string;
  sourceType: ProjectSourceType;
  /** 远端地址（`ProjectDto.repoUrl`）；空项目没有 ⇒ 整条降级为"空项目"。 */
  repoUrl?: string;
  /** 基线所在分支（`ProjectDto.repoBranch`）。 */
  repoBranch?: string;
  /** 基线体积（`ProjectDto.baselineSizeBytes`）。 */
  baselineSizeBytes?: number;
  /** 最后同步（`ProjectDto.updatedAt`）；缺席时退到 `createdAt`。 */
  updatedAt?: string;
  createdAt: string;
  /**
   * 是否给 [重新同步] 入口。**仅 `ready` 态**（§9.3）——克隆中/失败的项目谈不上"重新同步"，
   * 它们各自有自己的出口（进度态 / 恢复面板）。
   */
  canSync: boolean;
  syncing: boolean;
  syncErrorMessage?: string;
  /** 权限类失败 ⇒ 就地给 [配置 Git 凭证]（与克隆失败同一条出路，不让用户自己找路）。 */
  syncNeedsCredentials?: boolean;
  onConfigureCredentials?: () => void;
  onSync: () => void;
  /**
   * 🎁 [已保留卷]（F21-6 §3.3）——**它本该住在 `ProjectMenuPanel` 里**，而那个侧弹层
   * 全仓至今不存在（组头「⋯」也不存在）。这条只读条是今天**唯一**已经落地的项目级落点，
   * 所以入口先挂在这里：功能是项目级的、位置是项目级的，语义不歪。
   * ⏳ `ProjectMenuPanel` 落地时，把这个 prop 连同按钮整段搬过去（那时这条只读条回到纯只读）。
   *
   * ⚠️ 它与「只读」不冲突：打开的是一个**管理面板**，本条上并不发生任何写操作。
   */
  onOpenRetainedVolumes?: () => void;
  /**
   * ⚙️ [自动化规则]（F21-7 §2）——与上面那条同样的处境：它本该住在 `ProjectMenuPanel`
   * 的组头「⋯」菜单里，而那个侧弹层全仓至今不存在。先挂在这条项目级只读条上，
   * 作用域仍是本条所指的项目，语义不歪。
   * ⏳ `ProjectMenuPanel` 落地时两个入口一起搬走。
   */
  onOpenAutomations?: () => void;
}

/**
 * 字节 → 人话。放在视图内是**刻意**的：views/ 不得 import lib（07 §4.1 boundaries），
 * 与 `NewSandboxPanel.view` 的 `capabilityNote`、`HeadlessTaskLauncher.view` 的
 * `timeoutLabel` 同一处理。行为由容器测试从外部钉住。
 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 整数字节不显示小数（"1024 B" → "1 KB" 而不是 "1.0 KB"）。
  const shown = unit === 0 ? String(value) : value.toFixed(value >= 10 ? 0 : 1);
  return `${shown} ${units[unit] ?? 'B'}`;
}

/** ISO → 本地可读；解析不出来就原样吐回去（不吞掉后端给的字符串）。 */
function formatTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </span>
  );
}

export function ProjectInfoBarView({
  projectName,
  sourceType,
  repoUrl,
  repoBranch,
  baselineSizeBytes,
  updatedAt,
  createdAt,
  canSync,
  syncing,
  syncErrorMessage,
  syncNeedsCredentials = false,
  onConfigureCredentials,
  onSync,
  onOpenRetainedVolumes,
  onOpenAutomations,
}: ProjectInfoBarProps) {
  const isEmptyProject = sourceType === 'empty';
  // 空项目「最后同步」显示的是**创建时间**（§9.2 表格最后一行）：它从来没同步过，
  // 显示一个空格子会让人以为"同步过但没记下来"。
  const stamp = isEmptyProject ? createdAt : (updatedAt ?? createdAt);

  return (
    <div
      data-testid="project-info-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs"
    >
      <span className="font-semibold">{projectName}</span>

      {isEmptyProject ? (
        <span className="text-muted-foreground">空项目（无远端）</span>
      ) : (
        <>
          <Field label="远端" value={repoUrl ?? '—'} />
          <Field label="分支" value={repoBranch ?? '—'} />
          <Field
            label="基线"
            value={baselineSizeBytes === undefined ? '—' : formatBytes(baselineSizeBytes)}
          />
        </>
      )}

      <Field label={isEmptyProject ? '创建于' : '最后同步'} value={formatTime(stamp)} />

      {canSync && !isEmptyProject && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing}
          onClick={() => {
            onSync();
          }}
        >
          {syncing ? '同步中…' : '重新同步'}
        </Button>
      )}

      {onOpenRetainedVolumes !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="open-retained-volumes"
          onClick={() => {
            onOpenRetainedVolumes();
          }}
        >
          🎁 已保留卷
        </Button>
      )}

      {onOpenAutomations !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="open-automations"
          onClick={() => {
            onOpenAutomations();
          }}
        >
          ⚙️ 自动化规则
        </Button>
      )}

      {syncErrorMessage !== undefined && syncErrorMessage !== '' && (
        <span className="flex items-center gap-2">
          <span role="alert" className="text-red-400">
            {syncErrorMessage}
          </span>
          {/* 权限类失败的出路不在这条只读条上——直接把用户送到凭证页，
              与克隆失败那条路同款（F21-3 §10.2）。 */}
          {syncNeedsCredentials && onConfigureCredentials !== undefined && (
            <button
              type="button"
              className="shrink-0 underline hover:text-foreground"
              onClick={onConfigureCredentials}
            >
              配置 Git 凭证
            </button>
          )}
        </span>
      )}
    </div>
  );
}
