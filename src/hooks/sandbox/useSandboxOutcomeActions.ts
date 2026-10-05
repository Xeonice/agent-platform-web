import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAppStore } from '@/stores';
import type { TaskImageSnapshot } from '@/types/image';

export function useSandboxOutcomeActions({
  sandboxId,
  projectId,
  taskName,
  image,
  failed,
  code,
  title,
  onRetry,
}: {
  sandboxId: string;
  projectId?: string;
  taskName?: string;
  image?: TaskImageSnapshot;
  failed: boolean;
  code?: string;
  title?: string;
  onRetry: (omitRuntime?: boolean, fromFailure?: boolean) => void;
}) {
  const router = useRouter();
  const requestDiagnoseAutorun = useAppStore((state) => state.requestDiagnoseAutorun);
  const copyDiagnostics = useCallback((text: string) => {
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .then(
        () => {
          toast.success('诊断信息已复制');
        },
        () => {
          toast.error('复制失败，请手动选中下面的失败细节复制');
        },
      );
  }, []);
  const onAction = (key: string) => {
    if (
      key === 'reconfigure' &&
      code !== undefined &&
      [
        'IMAGE_DIGEST_GONE',
        'IMAGE_PULL_FAILED',
        'INVALID_IMAGE_REFERENCE',
        'IMAGE_NOT_REGISTERED',
        'IMAGE_PROVIDER_MISMATCH',
        'IMAGE_CONTRACT_VIOLATION',
        'INSTALL_FAILED',
      ].includes(code)
    ) {
      const query = new URLSearchParams({
        fromTask: sandboxId,
        taskName: taskName ?? '未命名任务',
        symptom: title ?? '任务启动失败',
      });
      if (projectId !== undefined) query.set('project', projectId);
      if (image?.id !== undefined) query.set('image', image.id);
      if (image?.reference !== undefined) query.set('imageRef', image.reference);
      router.push(`/settings/images?${query.toString()}`);
      return;
    }
    if (key === 'reconfigure' && code === 'AUTH_REJECTED') {
      router.push('/settings/credentials');
      return;
    }
    onRetry(key === 'reconfigure' && code === 'UNKNOWN_RUNTIME', failed);
  };
  const runDiagnostics =
    failed && code !== undefined && ['PROVIDER_UNAVAILABLE', 'DISK_INSUFFICIENT'].includes(code)
      ? () => {
          requestDiagnoseAutorun();
          router.push('/settings/system');
        }
      : undefined;
  return { onAction, copyDiagnostics, runDiagnostics };
}
