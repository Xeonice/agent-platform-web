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
import { useCallback, type Ref } from 'react';
import { toast } from 'sonner';
import { useSystemStatus } from '@/hooks/system/useSystemStatus';
import { useSystemStatusModels } from '@/hooks/system/useSystemStatusModels';
import { useExportAuditLogs } from '@/hooks/system/useExportAuditLogs';
import { useDiagnosticsDisclosure } from '@/hooks/system/useDiagnosticsDisclosure';
import { useProviderLogs } from '@/hooks/system/useProviderLogs';
import { useProxySettings } from '@/hooks/system/useProxySettings';
import { ResourcePoolCardView } from '@/views/system/ResourcePoolCard.view';
import { SandboxEnvStatusCardView } from '@/views/system/SandboxEnvStatusCard.view';
import { ConnectionStatusCardView } from '@/views/system/ConnectionStatusCard.view';
import { ProxySettingsCardView } from '@/views/system/ProxySettingsCard.view';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';

export interface SystemStatusContainerProps {
  /** [清理保留卷] 的去处（页面注入路由跳转；story 注入 spy）。 */
  onCleanupRetained?: () => void;
  cleanupTriggerRef?: Ref<HTMLButtonElement>;
}

export function SystemStatusContainer({
  onCleanupRetained,
  cleanupTriggerRef,
}: SystemStatusContainerProps = {}) {
  const status = useSystemStatus();
  const models = useSystemStatusModels(status);
  const disclosure = useDiagnosticsDisclosure(models.diagnostics.items);
  const proxy = useProxySettings();
  const providerLogs = useProviderLogs();
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

  // 系统卡片分组由容器装配，栅格留在 app/settings/system/page.tsx。
  // 诊断展开后的高度会变化，独占整行；其它卡片不强制等高，避免空白和挤压。
  return (
    <>
      <div className="flex flex-col gap-4" data-testid="system-status-column-left">
        <ResourcePoolCardView
          model={models.resourcePool}
          isError={status.resourcesError}
          isRefreshing={status.isRefreshing}
          onRefresh={status.refresh}
          onCleanupRetained={cleanup}
          cleanupTriggerRef={cleanupTriggerRef}
        />
        <ConnectionStatusCardView model={models.connection} />
      </div>
      <div className="flex flex-col gap-4" data-testid="system-status-column-right">
        <SandboxEnvStatusCardView
          model={models.sandboxEnvStatus}
          isError={status.providersError}
          loadingProviderCount={models.loadingProviderCount}
          loadingRuntimeCount={models.loadingRuntimeCount}
          openLogProviderId={providerLogs.providerId}
          onToggleLogs={providerLogs.toggle}
          logPanel={{
            lines: providerLogs.lines,
            isLoading: providerLogs.isLoading,
            isError: providerLogs.isError,
            unavailableReason: providerLogs.unavailableReason,
            onRetry: providerLogs.retry,
          }}
        />
        {/* ⚠️ 一张高度稳定的表单卡，与沙箱环境状态配成一列正好（见上方的实测数字）。 */}
        <ProxySettingsCardView
          initial={proxy.initial}
          isLoading={proxy.isLoading}
          loadError={proxy.loadError}
          onRetry={proxy.retry}
          isSaving={proxy.isSaving}
          errorMessage={proxy.errorMessage}
          fieldErrors={proxy.fieldErrors}
          onFieldChange={proxy.clearSaveError}
          saveSucceeded={proxy.saveSucceeded}
          configured={proxy.configured}
          onSave={proxy.save}
        />
      </div>
      {/* 诊断：整行。⛔ 不要塞回任何一列，理由见上方注释。 */}
      <div className="lg:col-span-2" data-testid="system-status-diagnostics-row">
        <DiagnosticsCardView
          model={models.diagnostics}
          isDiagnosing={status.isDiagnosing}
          schemaMismatch={status.schemaMismatch}
          openIds={disclosure.openIds}
          onOpenIdsChange={disclosure.onOpenIdsChange}
          onDiagnose={status.runDiagnose}
          onExportLogs={exportLogs}
          onCopyHint={copyHint}
        />
      </div>
    </>
  );
}
