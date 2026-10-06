import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { diagnose } from '@/services/api/system.service';
import { usePresetImageProvision } from '@/hooks/system/usePresetImageProvision';
import { presetImageChainModel } from '@/lib/system/presetImageChain';
import type { DiagnoseCheckFrame } from '@/types/sse-protocol';

/** 镜像卡与诊断第⑧项读取同一检查，不用搬运done自行宣告就绪。 */
export function usePresetImageDownload(enabled: boolean) {
  const check = useQuery({
    queryKey: ['system', 'preset-image', 'images'],
    enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      let preset: DiagnoseCheckFrame | undefined;
      await diagnose(
        {
          onStart: () => {
            /* 清单由诊断卡使用，这里只消费预制镜像帧。 */
          },
          onCheck: (frame) => {
            if (frame.id === 'preset-image') preset = frame;
          },
          onDone: () => {
            /* diagnose 在 done 后关闭流，随后返回捕获的帧。 */
          },
        },
        signal,
      );
      if (preset === undefined) throw new Error('诊断没有返回预制镜像检查');
      return preset;
    },
  });
  const refresh = useCallback(() => {
    void check.refetch();
  }, [check]);
  const provision = usePresetImageProvision(refresh);
  const chain = useMemo(
    () =>
      presetImageChainModel({
        phase: check.data === undefined ? 'idle' : 'done',
        frame: check.data,
      }),
    [check.data],
  );
  const offer = chain.steps.find(
    (step) => step.provision !== undefined && step.state !== 'pass',
  )?.provision;
  const rawRef = check.data?.detail?.['ref'];
  return {
    offer,
    reference: typeof rawRef === 'string' ? rawRef : undefined,
    headline: check.data?.headline,
    isChecking: check.isFetching,
    checkFailed: check.isError,
    refresh,
    ...provision,
  };
}
