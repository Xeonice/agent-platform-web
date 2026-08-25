// 项目分支列表（F21-2 §N.1「分支选择器」）：`GET /api/projects/:id/branches` → `string[]`。
//
// 三条语义写在这里，都是**否定性**的，很容易在实现时"顺手"丢掉：
//  · **不触网、不需要凭证**：完整克隆（03 §7.2★）之后后端读的是本地引用（`git branch -r`），
//    不是 `ls-remote`。所以这条路上一条网络失败路径都没有，也**不该**为它设计"去配 Git 凭证"分支。
//  · **空项目不发请求**：没有 git，谈不上分支（`enabled:false`，不是"发了再忽略结果"）。
//  · **失败不拦创建**：分支只是"可选的覆盖"，缺省永远在（基线当前分支）。取不到列表时
//    选择器降级为"用基线分支"，创建按钮**照常可点** —— 把一个可选项的加载失败升级成
//    阻断，等于让一条本来不该存在的失败路径拦住核心链路。
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listProjectBranches, syncProject } from '@/services/api/project.service';
import { projectKeys } from '@/hooks/project/useProjects';
import { cloneFailureGuidance } from '@/lib/project/projectClone';
import { ApiErrorException } from '@/services/api/apiError';

/** 分支 query key 族（15 §2.1）：挂在项目下的独立资源。 */
export const branchKeys = {
  all: () => ['project-branches'] as const,
  list: (projectId: string) => [...branchKeys.all(), projectId] as const,
};

export interface ProjectBranchesView {
  /** 可选分支（空数组 = 还没有 / 取不到，两者由 `isPending` / `isError` 区分）。 */
  branches: readonly string[];
  isPending: boolean;
  isError: boolean;
}

export interface UseProjectBranchesInput {
  projectId: string | null;
  /**
   * 该项目是不是 git 项目。**空项目一律不发请求**——`sourceType==='empty'` 的项目
   * 工作区里根本没有 `.git`，问它有哪些分支不是"结果为空"，是这个问题不成立。
   */
  isGitProject: boolean;
}

export function useProjectBranches({
  projectId,
  isGitProject,
}: UseProjectBranchesInput): ProjectBranchesView {
  const enabled = projectId !== null && isGitProject;
  const query = useQuery({
    queryKey: branchKeys.list(projectId ?? ''),
    queryFn: () => listProjectBranches(projectId ?? ''),
    enabled,
    // 本地引用，读一次就够；换项目换 key，弹窗重开不必再打一次。
    staleTime: 30_000,
    retry: false,
  });
  return {
    branches: query.data ?? [],
    // enabled:false 时 react-query 的 status 恒为 'pending'，直接透出去会让选择器
    // 在空项目下永远转圈 —— 没发请求就不叫"加载中"。
    isPending: enabled && query.isPending,
    isError: query.isError,
  };
}

/**
 * 重新同步基线（F21-6 §9.3）：`POST /api/projects/:id/sync`，**仅 `ready` 态**可调。
 * 成功后 invalidate 项目列表，只读条的「最后同步」与「基线体积」随之刷新。
 */
export interface SyncProjectApi {
  sync: (projectId: string) => void;
  isPending: boolean;
  /** 人话失败原因；`undefined` = 没失败。 */
  errorMessage?: string;
  /** 权限类失败 ⇒ 就地给 [配置 Git 凭证] 入口（与克隆失败同一条出路）。 */
  needsCredentials: boolean;
}

/**
 * `POST /api/projects/:id/sync`。
 *
 * ★ **失败原因按 code 查人话表，不直接渲染 message**（10A E-5）。
 *
 * 后端 sync 的 git 失败复用了 clone 的错误码（`CLONE_FAILED_PERMISSION` /
 * `CLONE_FAILED_NETWORK` / `TIMEOUT` / `DISK_INSUFFICIENT` / `INTERRUPTED`），
 * 它的注释里明写着这个复用假设：「前端已经按这些码分支了」。
 *
 * 但那句话此前**不成立**：`cloneFailureGuidance` 全仓只有一处调用，读的是
 * `clone_progress` 的 WS 投影表，与 sync mutation 的 error **不同源**。
 * 于是私有仓没配凭证时点 [重新同步]，用户看到的是 `envelope.message` ——
 * 而那是 `sanitizeCloneMessage(git stderr)`，一行英文：
 *   `remote: Repository not found. fatal: repository '…' not found`
 * 同一个失败原因在**克隆**路径上早就有中文人话 + 凭证入口，好的那套用不上。
 */
export function useSyncProject(): SyncProjectApi {
  const queryClient = useQueryClient();
  const m = useMutation({
    mutationFn: syncProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });

  const code = m.error instanceof ApiErrorException ? m.error.envelope.code : undefined;
  const guidance = m.error ? cloneFailureGuidance(code) : null;

  return {
    sync: (projectId) => {
      m.mutate(projectId);
    },
    isPending: m.isPending,
    ...(guidance === null ? {} : { errorMessage: guidance.message }),
    needsCredentials: guidance?.needsCredentials ?? false,
  };
}
