// 建沙箱 mutation（15 §2.4：mutation 不自动重试，走全局 mutations.retry:0）。
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  createSandbox,
  type CreateSandboxInput,
  type SandboxResponse,
} from '@/services/api/sandbox.service';

export function useCreateSandbox(): UseMutationResult<SandboxResponse, Error, CreateSandboxInput> {
  return useMutation<SandboxResponse, Error, CreateSandboxInput>({
    mutationFn: createSandbox,
  });
}
