import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/stores';
import { getResources } from '@/services/api/system.service';
import { systemKeys } from '@/hooks/system/useAuditStream';
import { matchesTaskStatus } from '@/lib/project/filterTaskTree';
import { cloneFailureGuidance, formatBytes } from '@/lib/project/projectClone';
import type { ProjectDto } from '@/types/project';
import type { Sandbox } from '@/types/domain';
export function useOverviewModel(projects: ProjectDto[], tasks: Sandbox[]) {
  const statusFilter = useAppStore((s) => s.taskStatusFilter);
  const search = useAppStore((s) => s.taskSearch);
  const setStatusFilter = useAppStore((s) => s.setTaskStatusFilter);
  const setSearch = useAppStore((s) => s.setTaskSearch);
  const resources = useQuery({
    queryKey: systemKeys.resources(),
    queryFn: getResources,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const query = search.trim().toLowerCase();
  const filtered = tasks.filter(
    (t) =>
      t.status !== 'deleting' &&
      matchesTaskStatus(t, statusFilter) &&
      (query === '' ||
        `${t.name} ${projectNames.get(t.projectId) ?? ''}`.toLowerCase().includes(query)),
  );
  const rank = (t: Sandbox) => (t.status === 'error' ? 0 : t.stuck ? 1 : 2);
  const attention = filtered
    .filter((t) => t.status === 'error' || t.stuck === true || t.waitingInput)
    .sort((a, b) => rank(a) - rank(b));
  const attentionIds = new Set(attention.map((t) => t.id));
  const recent = filtered
    .filter((t) => !attentionIds.has(t.id))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const visibleProjects = projects.filter((p) =>
    statusFilter === 'all'
      ? query === '' ||
        p.name.toLowerCase().includes(query) ||
        filtered.some((t) => t.projectId === p.id)
      : filtered.some((t) => t.projectId === p.id),
  );
  const projectMeta = Object.fromEntries(
    visibleProjects.map((p) => {
      const rows = filtered.filter((t) => t.projectId === p.id);
      const count = statusFilter === 'all' ? p.taskCount : rows.length;
      const label =
        statusFilter === 'waitingInput'
          ? '等待你输入'
          : statusFilter === 'preparing'
            ? '准备中'
            : statusFilter === 'error'
              ? '异常'
              : statusFilter === 'stopped'
                ? '已停止'
                : statusFilter === 'running'
                  ? '运行中'
                  : '个任务';
      const guidance = cloneFailureGuidance(p.cloneErrorCode ?? undefined);
      return [
        p.id,
        {
          countText: `${String(count)} ${label}`,
          failureMessage: p.cloneStatus === 'failed' ? guidance.message : undefined,
          canRetry: guidance.canRetry,
          needsCredentials: guidance.needsCredentials,
          lastPull: Date.now() - Date.parse(p.updatedAt) < 60_000 ? '刚刚' : p.updatedAt,
        },
      ];
    }),
  );
  const r = resources.data;
  const resourceRows =
    r === undefined
      ? undefined
      : [
          ...(r.capacity === undefined
            ? [`当前 ${String(r.activeTasks)} 个任务`]
            : [
                `已登记 ${String(r.capacity.registeredTasks)} / ${String(r.capacity.maxTasks)} 个任务 · 还能再发 ${String(r.capacity.remainingTasks)} 个`,
              ]),
          `磁盘已用 ${String(r.disk.usedPercent)}%，还剩 ${formatBytes(r.disk.availableBytes)}`,
          `保留下来的成果 ${String(r.retainedVolumes.count)} 份 · ${formatBytes(r.retainedVolumes.totalBytes)}`,
        ];
  return {
    statusFilter,
    search,
    onStatusFilterChange: setStatusFilter,
    onSearchChange: setSearch,
    attention,
    recent,
    filteredProjects: visibleProjects,
    projectMeta,
    totalProjectCount: projects.length,
    resourceRows,
    resourcesError: resources.isError,
    onRetryResources: () => {
      void resources.refetch();
    },
  };
}
