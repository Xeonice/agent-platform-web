// 项目列表 Query + 项目 mutation（15 §1/§2.4）：服务端资源 → Query；mutation 成功后 invalidate 列表。
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  listProjects,
  createProject,
  retryClone,
  convertToEmpty,
  cancelClone,
  deleteProject,
} from '@/services/api/project.service';
import { sandboxListKeys } from '@/hooks/sandbox/useSandboxes';
import { ApiErrorException } from '@/services/api/apiError';
import { useAppStore } from '@/stores';
import type { CreateProjectInput, ProjectDto } from '@/types/project';

export const projectKeys = {
  all: () => ['projects'] as const,
};

/**
 * 新建项目错误 → 表单友好文案（container 不便 import service，故收敛在 hook 层）。
 * 名称重复（`ALREADY_EXISTS`）给明确提示；其余 4xx 用后端信封；网络错误给通用文案。
 *
 * ⚠️ 判据读**信封里的码**，不读 HTTP 状态码。这条与 `lib/sandboxErrorCopy` 的
 * `sideEffectFree` / 契约里的 `retryable` 同源：语义由后端在信封里声明，前端不从状态码反推。
 * 旧写法 `httpStatus === 409` 拿状态码当 `ALREADY_EXISTS` 的代理——后端哪天在这个端点上
 * 多返回一种 409（并发冲突、配额冲突……），用户就会被告知"项目名已存在"，而名字根本没重。
 */
export function describeCreateProjectError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (error instanceof ApiErrorException) {
    if (error.envelope.code === 'ALREADY_EXISTS') return '项目名已存在，请换一个名称。';
    return error.envelope.message !== '' ? error.envelope.message : '创建失败，请稍后重试。';
  }
  return '网络错误，请稍后重试。';
}

export function useProjects(): UseQueryResult<ProjectDto[]> {
  return useQuery({
    queryKey: projectKeys.all(),
    queryFn: listProjects,
    staleTime: 30_000,
  });
}

export function useCreateProject(): UseMutationResult<ProjectDto, Error, CreateProjectInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

export function useRetryClone(): UseMutationResult<ProjectDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryClone,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

export function useConvertToEmpty(): UseMutationResult<ProjectDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: convertToEmpty,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

/**
 * 项目管理动作（删除 / 取消克隆）失败 → 用户可见文案（F21-6 §10.7 集成 ③）。
 *
 * ⚠️ **不静默关闭**：后端拒绝（有运行中任务的 409、并发冲突……）时，弹层/菜单必须留在
 * 原地并把原因说出来。把 409 当"删掉了"处理，是这条路上最容易犯、也最难被发现的错——
 * 树里那一项还在，用户会以为是刷新问题。
 */
export function describeProjectActionError(error: unknown): string {
  if (error instanceof ApiErrorException) {
    return error.envelope.message !== '' ? error.envelope.message : '删除失败，请稍后重试。';
  }
  return '网络错误，请稍后重试。';
}

/**
 * 取消进行中的克隆（**保留项目**）。与 `useDeleteProject` 是两条路，见 service 里的注释。
 */
export function useCancelClone(): UseMutationResult<ProjectDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelClone,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}

/**
 * 删除项目（级联，F21-6 §5/§10.2 B）。
 *
 * 成功后三件事，缺一条都会留下一个"看起来还在"的界面：
 * ① invalidate 项目列表——树里那一组要消失；
 * ② invalidate 沙箱列表——它的 Task 一并没了，不 invalidate 会变成挂在空项目下的孤儿；
 * ③ **删的正是当前选中项目时，清掉选中态**（§10.6 第 1 条）。⛔ 不许留一个指向已删项目
 *    的 `selectedProjectId`：那一位是 persist 的，刷新之后仍然指着一个 404 的 id，
 *    主区会停在"项目正在克隆"之类的死分支上（21-4「沙箱 404 → 清掉持久化选中」同一类）。
 *    选中的 Task 一起清——它属于被删的项目，留着同样是悬空指向。
 *
 * ⚠️ 选中态读的是 `getState()` 而不是订阅：这个 hook 挂在项目菜单容器上，订阅
 * `selectedProjectId` 会让每次切项目都重渲染一个与选中无关的容器；而 onSuccess 需要的
 * 恰恰是**回调发生那一刻**的值。
 */
export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_data, projectId) => {
      const store = useAppStore.getState();
      if (store.selectedProjectId === projectId) {
        store.setSelectedProjectId(null);
        store.setSelectedSandboxId(null);
      }
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
      void queryClient.invalidateQueries({ queryKey: sandboxListKeys.list() });
    },
  });
}
