// 建沙箱 mutation（15 §2.4：mutation 不自动重试，走全局 mutations.retry:0）。
import { useMemo } from 'react';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import {
  createSandbox,
  type CreateSandboxInput,
  type SandboxResponse,
} from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';
import {
  describeSandboxError,
  isZeroSideEffectRejection,
  capabilityRejectionMessage,
  type SandboxErrorCopy,
} from '@/lib/sandboxErrorCopy';

export function useCreateSandbox(): UseMutationResult<SandboxResponse, Error, CreateSandboxInput> {
  return useMutation<SandboxResponse, Error, CreateSandboxInput>({
    mutationFn: createSandbox,
  });
}

/** 创建期错误的两条**互斥**渲染路径（详见 lib/sandboxErrorCopy 的零副作用注释）。 */
export interface CreateSandboxErrorView {
  /**
   * 「零副作用」的 409（能力静态校验，10 §6.1 / 04 §5）：请求在落库之前就被拒，
   * **没有 sandbox id、列表也不留 failed 记录** ⇒ 必须**就地**提示改选，
   * 绝不能渲染成"创建失败可重试"（那会让用户以为有个任务失败了）。
   */
  rejection?: string;
  /** 其余创建期错误：人话 + 可操作建议（P22 §1）。 */
  failure?: SandboxErrorCopy;
}

/** 把 mutation 的 error 归一化为可渲染形状（container 不碰 lib，故在 hook 层派生）。 */
export function useCreateSandboxErrorView(error: Error | null): CreateSandboxErrorView {
  return useMemo(() => {
    if (error === null) return {};
    if (error instanceof ApiErrorException) {
      if (isZeroSideEffectRejection(error.httpStatus, error.envelope.code)) {
        return { rejection: capabilityRejectionMessage(error.envelope) };
      }
      return {
        failure: describeSandboxError({
          code: error.envelope.code,
          message: error.envelope.message,
        }),
      };
    }
    return { failure: describeSandboxError({ message: error.message }) };
  }, [error]);
}
