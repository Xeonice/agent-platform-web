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
  deleteProject,
} from '@/services/api/project.service';
import { ApiErrorException } from '@/services/api/apiError';
import type { CreateProjectInput, ProjectDto } from '@/types/project';

export const projectKeys = {
  all: () => ['projects'] as const,
};

/**
 * 新建项目错误 → 表单友好文案（container 不便 import service，故收敛在 hook 层）。
 * 409（名称重复 ALREADY_EXISTS）给明确提示；其余 4xx 用后端信封；网络错误给通用文案。
 */
export function describeCreateProjectError(error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  if (error instanceof ApiErrorException) {
    if (error.httpStatus === 409) return '项目名已存在，请换一个名称。';
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

export function useDeleteProject(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all() });
    },
  });
}
