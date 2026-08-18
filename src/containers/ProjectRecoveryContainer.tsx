'use client';
// 失败项目恢复门（P0-1）：工作台选中一个 cloneStatus==='failed' 的项目时，接上 retry-clone / convert-to-empty。
// 复用 CloneProgress.view 的 failed 分支；动作与回退/可见错误由 useProjectRecovery 统一处理。
// 权限类失败额外接入 clone 401 回程（S3）：跳凭证页配置后回程重试。
import { useRouter } from 'next/navigation';
import { useProjectRecovery } from '@/hooks/useProjectRecovery';
import { useAppStore } from '@/stores';
import { CloneProgressView } from '@/views/project/CloneProgress.view';

export interface ProjectRecoveryContainerProps {
  projectId: string;
  projectName: string;
  /** 后端 DTO.cloneErrorCode（引导文案 + retry 回退）。 */
  errorCode?: string | null;
  /** 转空成功 → 选中并进入建沙箱流。 */
  onConverted: (projectId: string) => void;
}

export function ProjectRecoveryContainer({
  projectId,
  projectName,
  errorCode,
  onConverted,
}: ProjectRecoveryContainerProps) {
  const router = useRouter();
  const setPendingProjectCreate = useAppStore((s) => s.setPendingProjectCreate);
  const { retry, convertToEmpty, busy, actionError, guidance } = useProjectRecovery({
    projectId,
    errorCode,
    onConverted,
  });

  // 权限类失败 → 携 pendingProjectCreate 跳凭证页（工作台选中失败项目路径；无 repoUrl，项目已落库）。
  const handleConfigureCredentials = (): void => {
    setPendingProjectCreate({ projectId, name: projectName, source: 'git' });
    router.push('/settings/credentials');
  };

  return (
    <CloneProgressView
      projectName={projectName}
      phase="failed"
      percent={null}
      guidanceMessage={guidance.message}
      canRetry={guidance.canRetry}
      needsCredentials={guidance.needsCredentials}
      actionError={actionError ?? undefined}
      busy={busy}
      onRetry={retry}
      onConvertToEmpty={convertToEmpty}
      onConfigureCredentials={handleConfigureCredentials}
    />
  );
}
