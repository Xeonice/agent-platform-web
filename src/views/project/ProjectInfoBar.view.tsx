import * as DialogPrimitive from '@radix-ui/react-dialog';
import { GitBranch, Info, Loader2, MoreHorizontal } from 'lucide-react';
import type { ProjectSourceType } from '@/types/project';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export interface ProjectInfoBarProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  openWithoutFocus?: boolean;
  syncSucceeded?: boolean;
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
  open,
  onOpenChange,
  openWithoutFocus = false,
  syncSucceeded = false,
}: ProjectInfoBarProps) {
  const empty = sourceType === 'empty';
  const label = empty ? '空项目' : (repoBranch ?? '远端默认分支');
  const stamp = empty ? createdAt : (updatedAt ?? createdAt);
  return (
    <div className="relative flex shrink-0 items-center gap-2" data-testid="project-info-bar">
      <DialogPrimitive.Root modal={false} open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Trigger asChild>
          <Button
            variant="outline"
            size="sm"
            data-testid="project-info-trigger"
            title={`${label} · 最后拉取 ${syncSucceeded ? '刚刚' : formatTime(stamp)}`}
            aria-label={`项目信息：${label}`}
            className="max-w-40 data-[state=open]:bg-muted"
          >
            <GitBranch aria-hidden="true" className="hidden size-3.5 min-[1280px]:block" />
            <span className="hidden truncate min-[1280px]:inline">{label}</span>
            <Info aria-hidden="true" className="size-4 min-[1280px]:hidden" />
          </Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Content
          tabIndex={-1}
          aria-describedby="project-info-description"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[min(360px,calc(100vw-2rem))] rounded-lg border border-border bg-card p-4 text-sm shadow-lg focus:outline-none"
          onOpenAutoFocus={(event) => {
            if (openWithoutFocus) event.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="font-semibold">{projectName}</DialogPrimitive.Title>
          <DialogPrimitive.Description
            id="project-info-description"
            className="mt-1 text-xs text-muted-foreground"
          >
            项目信息
          </DialogPrimitive.Description>
          <dl className="my-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
            <dt className="text-muted-foreground">仓库</dt>
            <dd className="break-all font-mono">
              {empty ? '空项目（没有关联仓库）' : (repoUrl ?? '—')}
            </dd>
            {!empty && (
              <>
                <dt className="text-muted-foreground">分支</dt>
                <dd className="font-mono">{label}</dd>
                <dt className="text-muted-foreground">代码体积</dt>
                <dd className="font-mono">
                  {baselineSizeBytes === undefined ? '—' : formatBytes(baselineSizeBytes)}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{empty ? '创建于' : '最后拉取'}</dt>
            <dd title={formatTime(stamp)}>
              {!empty && syncSucceeded ? '刚刚' : formatTime(stamp)}
            </dd>
          </dl>
          {syncErrorMessage && (
            <div role="alert" className="mb-3 text-xs text-error">
              <p>{syncErrorMessage}</p>
              {syncNeedsCredentials && (
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={onConfigureCredentials}
                >
                  配置 Git 凭证
                </Button>
              )}
            </div>
          )}
          {syncing && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              正在拉取 {projectName} 的最新代码…
            </p>
          )}
          {syncSucceeded && (
            <p role="status" className="mb-3 text-xs text-muted-foreground">
              已更新到最新；已建好的任务不受影响
            </p>
          )}
          {canSync && !empty && (
            <div className="border-t border-border pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncing}
                aria-label={syncing ? '正在拉取最新代码' : '拉取最新代码'}
                aria-describedby="project-sync-scope"
                data-testid="project-sync"
                onClick={onSync}
              >
                {syncing && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
                {syncing ? '正在拉取…' : '拉取最新代码'}
              </Button>
              <p
                id="project-sync-scope"
                className="mt-2 text-xs leading-relaxed text-muted-foreground"
              >
                {SYNC_SCOPE_NOTE}
              </p>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
      {canSync && !empty && (
        <Button
          className="hidden min-[1120px]:inline-flex"
          variant="ghost"
          size="sm"
          disabled={syncing}
          title={SYNC_SCOPE_NOTE}
          aria-label={syncing ? '正在拉取最新代码' : '拉取最新代码'}
          onClick={onSync}
        >
          {syncing && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          {syncing ? '正在拉取…' : '拉取最新代码'}
        </Button>
      )}
      {canSync && !empty && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="min-[1120px]:hidden"
              variant="ghost"
              size="icon"
              aria-label="更多项目操作"
            >
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={syncing} onSelect={onSync}>
              {syncing && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
              {syncing ? '正在拉取…' : '拉取最新代码'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {syncSucceeded && !open && (
        <p role="status" className="sr-only">
          已更新到最新；已建好的任务不受影响
        </p>
      )}
    </div>
  );
}
