// 「设置 → 系统状态」里的代理配置（读回填 + 保存）。
//
// ⚠️ **为什么要有这一份，而不是让用户回向导改**：向导的 `proxyActive` 只在连通性检查
//    **有失败项**时才让代理那一步进流程，而连通性测的是**可达**、用户缺的可能是**带宽**
//    （2026-09-14 真机：ghcr.io 1.4 秒应答但只有 200 KB/s，320 MB 镜像拉到 84% 断掉）。
//    检查全绿 ⇒ 向导判定"不需要代理"。那时若表单只在向导里，用户就**再也没地方配代理**。
//
// ⚠️ 复用向导那份 `toProxyUpdate`（三态：`null` 清空 / 缺席不改 / 有值改成这个）——
//    ⛔ 在这里再写一遍三态判断，两份迟早会分叉，而分叉的样子是「清空代理」在一处生效、
//    在另一处变成"不改"。
import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSettings, putSettings } from '@/services/api/system.service';
import { systemKeys } from '@/hooks/system/useAuditStream';
import { toProxyUpdate } from '@/lib/system/initWizardModel';
import { describeErrorCode } from '@/lib/_shared/errorCopy';
import { ApiErrorException } from '@/services/api/apiError';
import type { ProxyFormValues } from '@/types/init';

const EMPTY: ProxyFormValues = { httpProxy: '', httpsProxy: '', noProxy: '' };

export interface UseProxySettingsResult {
  /** 已存配置的回填值；还没取回来时是三个空串。 */
  initial: ProxyFormValues;
  isSaving: boolean;
  /** 保存失败的人话原因；`null` = 没有失败。 */
  errorMessage: string | null;
  save: (values: ProxyFormValues) => void;
}

export function useProxySettings(): UseProxySettingsResult {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: systemKeys.settings(), queryFn: getSettings });

  const initial = useMemo<ProxyFormValues>(() => {
    const proxy = settings.data?.proxyConfig;
    if (proxy === undefined) return EMPTY;
    return {
      httpProxy: proxy.httpProxy ?? '',
      httpsProxy: proxy.httpsProxy ?? '',
      noProxy: proxy.noProxy ?? '',
    };
  }, [settings.data]);

  const mutation = useMutation({
    mutationFn: async (values: ProxyFormValues) => putSettings(toProxyUpdate(values)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: systemKeys.settings() });
    },
  });

  const save = useCallback(
    (values: ProxyFormValues): void => {
      mutation.mutate(values);
    },
    [mutation],
  );

  // ⚠️ 保存失败要给**人话**：服务端 message 不上屏（它随时可能是技术腔，
  //    与 `projectErrorCopy` 同一条纪律）。
  const errorMessage =
    mutation.error === null
      ? null
      : mutation.error instanceof ApiErrorException
        ? describeErrorCode(mutation.error.envelope.code, {
            overrides: {},
            fallback: '保存失败，请稍后重试。',
            traceId: mutation.error.envelope.traceId,
          })
        : '网络不通，请稍后再试。';

  return { initial, isSaving: mutation.isPending, errorMessage, save };
}
