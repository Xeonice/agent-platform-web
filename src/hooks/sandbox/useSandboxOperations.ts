import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  destroySandbox,
  stopSandbox,
  startSandbox,
  getSandbox,
} from '@/services/api/sandbox.service';
import { ApiErrorException } from '@/services/api/apiError';
import { describeSandboxError } from '@/lib/sandbox/sandboxErrorCopy';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { useAppStore } from '@/stores';
export function useSandboxOperations(id: string, name: string, projectId?: string) {
  const client = useQueryClient();
  const { reportRestError } = useReportUnauthorized();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['sandboxes'] });
    void client.invalidateQueries({ queryKey: ['projects'] });
    void client.invalidateQueries({ queryKey: ['system'] });
    void client.invalidateQueries({ queryKey: ['retained-volumes'] });
  };
  const mutation = useMutation({
    mutationFn: async (input: {
      operation: 'start' | 'stop' | 'destroy';
      keepVolume?: boolean;
    }) => {
      const store = useAppStore.getState();
      const previous = store.sandboxStatuses[id];
      const wasSelected = store.selectedSandboxId === id;
      if (input.operation === 'start') store.markSandboxRestart(id);
      else store.setSandboxStatus(id, input.operation === 'stop' ? 'stopping' : 'destroying');
      if (input.operation === 'destroy' && wasSelected) {
        store.setSelectedSandboxId(null);
        store.setSelectedProjectId(null);
        store.setWorkbenchNotice({ message: `正在销毁任务「${name}」…` });
        if (typeof window !== 'undefined')
          window.history.replaceState(window.history.state, '', '/');
      }
      try {
        if (input.operation === 'destroy') {
          await destroySandbox(id, input.keepVolume === true);
          store.clearSandboxStatus(id);
          client.setQueriesData<unknown>({ queryKey: ['sandboxes'] }, (data: unknown) =>
            Array.isArray(data) ? data.filter((row: { id: string }) => row.id !== id) : data,
          );
          const success = {
            message: `已销毁任务「${name}」`,
            description:
              input.keepVolume === true
                ? '代码副本已留下来作为成果，30 天后自动清理；可在「保留下来的成果」里下载。'
                : '代码副本一起删掉了（没有成果可留）。',
            retainedProjectId: input.keepVolume === true ? projectId : undefined,
          };
          if (wasSelected) store.setWorkbenchNotice(success);
          else toast(success.message, { description: success.description });
          refresh();
          return;
        }
        const dto = await (input.operation === 'stop' ? stopSandbox(id) : startSandbox(id));
        store.setSandboxStatus(id, dto.status, {
          failureCode: dto.failureCode,
          failureMessage: dto.failureMessage,
          failureOperation: dto.failureOperation,
        });
        refresh();
      } catch (error) {
        if (error instanceof ApiErrorException && error.httpStatus === 409) {
          toast('任务状态已变化，已重新读取最新状态。');
          const dto = await getSandbox(id);
          store.setSandboxStatus(id, dto.status, {
            failureCode: dto.failureCode,
            failureMessage: dto.failureMessage,
            failureOperation: dto.failureOperation,
          });
          refresh();
          return;
        }
        reportRestError(error);
        if (!(error instanceof ApiErrorException) || error.httpStatus === 401) {
          if (previous) store.setSandboxStatus(id, previous.status, previous);
          if (input.operation === 'destroy' && wasSelected)
            store.setWorkbenchNotice({
              message: `没能确认任务「${name}」是否销毁`,
              description: '网络不通，请稍后重试；任务状态会在连接恢复后重新读取。',
            });
          refresh();
          throw error;
        }
        const code = error.envelope.code;
        store.setSandboxStatus(id, 'failed', {
          failureCode: code,
          failureOperation: input.operation,
        });
        if (input.operation === 'destroy' && wasSelected)
          store.setWorkbenchNotice({
            message: `没能销毁任务「${name}」`,
            description: `${describeSandboxError({ code }).title}。任务已转为异常，名额已释放；在左侧点开它可以再试一次。`,
          });
        if (!wasSelected)
          toast(
            `任务「${name}」${input.operation === 'destroy' ? '删除' : input.operation === 'stop' ? '停止' : '启动'}失败`,
            { description: describeSandboxError({ code }).title },
          );
        refresh();
        throw error;
      }
    },
  });
  return {
    busy: mutation.isPending,
    error: mutation.isError ? '操作没有完成，请稍后再试。' : undefined,
    stop: () => {
      mutation.mutate({ operation: 'stop' });
    },
    start: () => {
      mutation.mutate({ operation: 'start' });
    },
    destroy: (keepVolume: boolean) => mutation.mutateAsync({ operation: 'destroy', keepVolume }),
    projectId,
  };
}

export function useTaskActionDetails(id: string, enabled: boolean) {
  return useQuery({ queryKey: ['sandboxes', id], queryFn: () => getSandbox(id), enabled });
}
