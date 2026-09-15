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
import { useProxySettings } from '@/hooks/system/useProxySettings';
import { ResourcePoolCardView } from '@/views/system/ResourcePoolCard.view';
import { SandboxEnvStatusCardView } from '@/views/system/SandboxEnvStatusCard.view';
import { ConnectionStatusCardView } from '@/views/system/ConnectionStatusCard.view';
import { ProxySettingsCardView } from '@/views/system/ProxySettingsCard.view';
import { DiagnosticsCardView } from '@/views/system/DiagnosticsCard.view';

export interface SystemStatusContainerProps {
  /** [清理保留卷] 的去处（页面注入路由跳转；story 注入 spy）。 */
  onCleanupRetained?: () => void;
}

export function SystemStatusContainer({ onCleanupRetained }: SystemStatusContainerProps = {}) {
  const status = useSystemStatus();
  const models = useSystemStatusModels(status);
  const disclosure = useDiagnosticsDisclosure(models.diagnostics.items);
  const proxy = useProxySettings();
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
  // ⚠️⚠️ **诊断不在任何一列，它占整行**（2026-09-15 按原型 v3 重排，design-notes §1 问题 6）。
  // 问题从来不是"哪张卡放错了列"，而是 `DiagnosticsCard` 的高度在两个状态之间跳：
  // **尚未运行 98px、跑完八项 789px**（实测）。把一张高度差 8 倍的卡固定指派给某一列，
  // 另一列必然一会儿空一会儿挤 —— 按"跑完"的样子分，进页面时左边是空的；按"没跑"的样子
  // 分，跑完之后右边被顶出屏幕。这就是这个问题反复出现又反复"修好"的原因。
  // ⇒ 两列只留**高度稳定**的卡：左 [资源水位 303 + 连接状态 180]=499，
  //   右 [沙箱环境 320 + 出网代理 363]=698，差 199px（重排前 626px，实测）。
  // ⛔ **不要再把诊断塞回某一列去"配平"** —— 它下一次展开/收起就会把配平破坏掉，
  //   而看起来又像是某人手滑改错了列。
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
        <ConnectionStatusCardView model={models.connection} />
      </div>
      <div className="flex flex-col gap-4" data-testid="system-status-column-right">
        <SandboxEnvStatusCardView model={models.sandboxEnvStatus} isError={status.providersError} />
        {/* ⚠️ 一张高度稳定的表单卡，与沙箱环境状态配成一列正好（见上方的实测数字）。 */}
        <ProxySettingsCardView
          initial={proxy.initial}
          isSaving={proxy.isSaving}
          errorMessage={proxy.errorMessage}
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
