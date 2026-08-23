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
  zeroSideEffectRejectionMessage,
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
   * 后端显式标了 `sideEffectFree` 的门口拒绝（10 §6.1 / 04 §5）：请求在落库之前就被拒，
   * **没有 sandbox id、列表也不留 failed 记录** ⇒ 必须**就地**提示改配置，
   * 绝不能渲染成"创建失败可重试"（那会让用户以为有个任务失败了）。
   *
   * ⚠️ 判据读的是**后端声明的字段**，不是 HTTP 状态码——这六条拒绝散落在 400/404/409 三个
   * 状态码上，从码反推必然漏。缺席（后端未表态）按保守读法落进下面的 `failure`。
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
      if (isZeroSideEffectRejection(error.envelope)) {
        // 'create' 是必填语境：同一个标记在终止那条路上的人话完全不同（见 lib 里的注释）。
        return { rejection: zeroSideEffectRejectionMessage(error.envelope, 'create') };
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
