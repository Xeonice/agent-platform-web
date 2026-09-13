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
import { useDiagnosticsDisclosure } from '@/hooks/system/useDiagnosticsDisclosure';
import { ResourcePoolCardView } from '@/views/system/ResourcePoolCard.view';
import { SandboxEnvStatusCardView } from '@/views/system/SandboxEnvStatusCard.view';
import { ConnectionStatusCardView } from '@/views/system/ConnectionStatusCard.view';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';

export interface SystemStatusContainerProps {
  /** [清理保留卷] 的去处（页面注入路由跳转；story 注入 spy）。 */
  onCleanupRetained?: () => void;
}

export function SystemStatusContainer({ onCleanupRetained }: SystemStatusContainerProps = {}) {
  const status = useSystemStatus();
  const models = useSystemStatusModels(status);
  const disclosure = useDiagnosticsDisclosure(models.diagnostics.items);
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

  // ⚠️ 两栏分组在这一层，⛔ **栅格本身不在这里**（`lg:grid-cols-2` 与窄屏回落在上一层
  // `app/settings/system/page.tsx`，因为审计流卡是独立容器、要作为跨两列的整行纳入同一个栅格）。
  //
  // ⚠️ **诊断在左列**：它是最高的一张卡（八项手风琴，非 ok/info 还默认展开），和三张矮卡
  // 对半分才不会一边空一大截 —— design-notes.md §1 点名要修的正是「系统状态左列大片空白」。
  // ⛔ 两列都不给 `items-stretch`/固定高度：v1 的「三列卡片强制等高空出一大截」是 v2
  // 专门推翻掉的四个布局问题之一。
  return (
    <>
      <div className="flex flex-col gap-4" data-testid="system-status-column-left">
        <ResourcePoolCardView
          model={models.resourcePool}
          isError={status.resourcesError}
          isRefreshing={status.isRefreshing}
          onRefresh={status.refresh}
          onCleanupRetained={cleanup}
        />
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
      <div className="flex flex-col gap-4" data-testid="system-status-column-right">
        <SandboxEnvStatusCardView model={models.sandboxEnvStatus} isError={status.providersError} />
        <ConnectionStatusCardView model={models.connection} />
      </div>
    </>
  );
}
