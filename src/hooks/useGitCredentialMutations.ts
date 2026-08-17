// Git 凭证 mutation（15 §2.4）：save/test/revoke。save/revoke 成功后 invalidate 列表（mutation 不自动重试）。
// 凭证明文（私钥/token）只经 mutation 变量传入 → 请求体 → 立即丢弃；绝不进 store/persist（15 §3.5）。
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import {
  saveGitCredential,
  testGitCredential,
  revokeGitCredential,
} from '@/services/api/gitCredential.service';
import { gitCredentialKeys } from '@/hooks/useGitCredentials';
import type {
  CreateGitCredentialRequest,
  StoreGitCredentialResponse,
  GitTestResult,
  GitTestRequest,
} from '@/types/gitCredential';

export function useSaveGitCredential(): UseMutationResult<
  StoreGitCredentialResponse,
  Error,
  CreateGitCredentialRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveGitCredential,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gitCredentialKeys.all() });
    },
  });
}

export function useTestGitCredential(): UseMutationResult<GitTestResult, Error, GitTestRequest> {
  // 测试连接不改服务端资源，无需 invalidate；仅返回 ok/errorCode 供 UI 展示。
  return useMutation({ mutationFn: testGitCredential });
}

export function useRevokeGitCredential(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeGitCredential,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: gitCredentialKeys.all() });
    },
  });
}
