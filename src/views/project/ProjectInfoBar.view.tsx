// 项目只读条（F21-6 §9.2）：主区**顶部**一条只读信息 —— 仓库地址 / 分支 / 代码体积 / 最后拉取。
//
// ⚠️ 屏上用词：内部叫「远端 / 基线 / 同步」，界面上分别是「仓库 / 项目当前代码 / 拉取最新代码」。
// 「同步」尤其要避开 —— 它双向暧昧，而这条路**只拉不推**，用户会以为按一下会把本地改动推上去。
// 纯展示、props 驱动、零副作用。
//
// **它不是详情页**：工作台主区在"没选任务"时本来就是空的，为四个字段开一个页面不成比例。
//
// ⚠️ **只读**：改仓库地址、切默认分支、重新 clone 都**不在这条上**。它回答的是
// "我在拿什么代码干活"，不是项目管理。唯一的动作是 [拉取最新代码]（§9.3，仅 `ready` 态）。
//
// ★ 2026-09-01（F21-6 §10.2 C）：[🎁 已保留卷] / [⚙️ 自动化规则] 两个入口**已搬进
// `ProjectMenuPanel`**（组头「⋯」→ 项目菜单）。它们当初挂在这条上是 `ProjectMenuPanel`
// 不存在时的权宜之计（两处 ⏳ 注释随之删除）。这条自此**回到纯只读 + 一个 [拉取最新代码]**。
// ⛔ 别再往这儿加项目级管理入口——那正是"只读条慢慢长成项目菜单"的第一步。
//
// ⚠️ 一个曾经"有意识留下"的缺口（§9.3）：拉取只更新**项目里的这份代码**，已经建好的任务
// 工作区一律不动（它们是当时的写时复制副本）。于是同一项目下的两个任务可能跑在不同代码上。
//
// ★ **那个缺口的"看不出来"这一半，本轮补上了。** 原注释把它整条记成了缺口，但其中
//   "界面上没说过这件事"纯粹是**文案层就能补**的：给 [拉取最新代码] 挂一句
//   `SYNC_SCOPE_NOTE`，用户按之前就知道这一下不会动已有任务。剩下那一半（同项目下两个
//   任务跑在不同代码上，界面上区分不出来）确实要数据支撑，仍然是缺口。
//   ⛔ 不要因为"这是已知缺口"就把这句 tooltip 删掉 —— 缺的是数据，不是这句话。
import type { ProjectSourceType } from '@/types/project';
import { Button } from '@/components/ui/button';

export interface ProjectInfoBarProps {
  projectName: string;
  sourceType: ProjectSourceType;
  /** 仓库地址（`ProjectDto.repoUrl`）；空项目没有 ⇒ 整条降级为"空项目"。 */
  repoUrl?: string;
  /** 项目当前代码所在的分支（`ProjectDto.repoBranch`）。 */
  repoBranch?: string;
  /** 项目当前代码的体积（`ProjectDto.baselineSizeBytes`）。 */
  baselineSizeBytes?: number;
  /** 最后一次拉取（`ProjectDto.updatedAt`）；缺席时退到 `createdAt`。 */
  updatedAt?: string;
  createdAt: string;
  /**
   * 是否给 [拉取最新代码] 入口。**仅 `ready` 态**（§9.3）——克隆中/失败的项目谈不上"拉取最新"，
   * 它们各自有自己的出口（进度态 / 恢复面板）。
   */
  canSync: boolean;
  syncing: boolean;
  syncErrorMessage?: string;
  /** 权限类失败 ⇒ 就地给 [配置 Git 凭证]（与克隆失败同一条出路，不让用户自己找路）。 */
  syncNeedsCredentials?: boolean;
  onConfigureCredentials?: () => void;
  onSync: () => void;
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

/**
 * [拉取最新代码] 的作用范围。⚠️ 这句必须在**按下之前**看得到，所以挂在按钮的 tooltip 上，
 * 而不是等拉完了再解释一遍。
 */
const SYNC_SCOPE_NOTE =
  '只更新项目里的这份代码。已经建好的任务用的是各自建的时候复制的那一份，不会跟着变；下次新建任务才会用到刚拉下来的代码。';

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
}: ProjectInfoBarProps) {
  const isEmptyProject = sourceType === 'empty';
  // 空项目「最后拉取」显示的是**创建时间**（§9.2 表格最后一行）：它从来没拉取过，
  // 显示一个空格子会让人以为"拉过但没记下来"。
  const stamp = isEmptyProject ? createdAt : (updatedAt ?? createdAt);

  return (
    <div
      data-testid="project-info-bar"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-xs"
    >
      <span className="font-semibold">{projectName}</span>

      {isEmptyProject ? (
        <span className="text-muted-foreground">空项目（没有关联仓库）</span>
      ) : (
        <>
          <Field label="仓库" value={repoUrl ?? '—'} />
          <Field label="分支" value={repoBranch ?? '—'} />
          <Field
            label="代码体积"
            value={baselineSizeBytes === undefined ? '—' : formatBytes(baselineSizeBytes)}
          />
        </>
      )}

      <Field label={isEmptyProject ? '创建于' : '最后拉取'} value={formatTime(stamp)} />

      {canSync && !isEmptyProject && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncing}
          title={SYNC_SCOPE_NOTE}
          aria-label={`拉取最新代码。${SYNC_SCOPE_NOTE}`}
          data-testid="project-sync"
          onClick={() => {
            onSync();
          }}
        >
          {syncing ? '正在拉取…' : '拉取最新代码'}
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
