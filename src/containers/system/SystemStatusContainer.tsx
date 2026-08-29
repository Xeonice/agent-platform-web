'use client';
// 系统状态页四张卡的容器（F21-5 §3）。**唯一的 view ↔ hook 粘合点**。
//
// ⚠️ 取数、轮询、诊断流编排全在 `useSystemStatus`；阈值判定、单位换算、文案挑选全在
// `lib/system/`；这里只做三件事：把 DTO 交给 model 工厂、把 store 里的连接事实读出来、
// 把回调接上。⛔ 容器里不许出现任何百分比阈值或单位换算——那是 lib 的活，而且容器
// **碰不到 lib**（boundaries：container 只能 import view/hook/type/store/component），
// 所以 model 组装经 `useSystemStatusModels` 这一层 hook 完成。
//
// ⚠️ **审计卡与这四张卡同屏共存，且不合并**（P21-5 §10.1）：审计流是结构化事件、给产品
// 用户看；provider 那边的运行日志是文本行、给运维看。两者在组件层不共享任何视图。
import { useCallback } from 'react';
import { toast } from 'sonner';
import { useSystemStatus } from '@/hooks/system/useSystemStatus';
import { useSystemStatusModels } from '@/hooks/system/useSystemStatusModels';
import { useExportAuditLogs } from '@/hooks/system/useExportAuditLogs';
import { ResourcePoolCardView } from '@/views/system/ResourcePoolCard.view';
import { ProviderStatusCardView } from '@/views/system/ProviderStatusCard.view';
import { ConnectionStatusCardView } from '@/views/system/ConnectionStatusCard.view';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';

export interface SystemStatusContainerProps {
  /** [清理保留卷] 的去处（页面注入路由跳转；story 注入 spy）。 */
  onCleanupRetained?: () => void;
}

export function SystemStatusContainer({ onCleanupRetained }: SystemStatusContainerProps = {}) {
  const status = useSystemStatus();
  const models = useSystemStatusModels(status);
  const exportLogs = useExportAuditLogs();

  const copyHint = useCallback((hint: string) => {
    void navigator.clipboard.writeText(hint).then(
      () => {
        toast.success('已复制');
      },
      () => {
        // ⚠️ 复制失败要说出来：静默失败时用户会去粘贴一段**上一次**复制的内容。
        toast.error('复制失败，请手动选中命令复制');
      },
    );
  }, []);

  const cleanup = useCallback(() => {
    onCleanupRetained?.();
  }, [onCleanupRetained]);

  return (
    <>
      <ResourcePoolCardView
        model={models.resourcePool}
        isError={status.resourcesError}
        isRefreshing={status.isRefreshing}
        onRefresh={status.refresh}
        onCleanupRetained={cleanup}
      />
      <ProviderStatusCardView model={models.providerStatus} isError={status.providersError} />
      <ConnectionStatusCardView model={models.connection} />
      <DiagnosticsCardView
        model={models.diagnostics}
        isDiagnosing={status.isDiagnosing}
        schemaMismatch={status.schemaMismatch}
        onDiagnose={status.runDiagnose}
        onExportLogs={exportLogs}
        onCopyHint={copyHint}
      />
    </>
  );
}
