// 系统状态页 /settings/system（F21-5 §2）：只装配 container（app 层只做布局编排，07 §2）。
// 布局复用 `src/app/settings/layout.tsx` + `SettingsLayout.view`。
//
// ⚠️ 组件树顺序照 F21-5 §3：资源池 → provider → 连接 → 诊断 → 审计流。
// 层级理由（P21-5 §3）：资源水位回答"还能再发几个 Task"（最高频）> provider 健康 >
// 连接状态（排障用）> 诊断（故障触发的深度动作）。
//
// ⚠️ **审计流与 provider 的运行日志是两样东西，同屏共存、绝不合并**（P21-5 §10.1）。
//
// ⏳ 仍未落地：`AccessProtectionSection`（规格属 F21-8）、`UpgradeBackupSection`（v1.5）、
// `ProviderLogPanel`（"最近 20 行运行日志"在契约里还没有端点）。
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { AuditStreamContainer } from '@/containers/system/AuditStreamContainer';
import { SystemStatusContainer } from '@/containers/system/SystemStatusContainer';

export default function SystemStatusPage() {
  return (
    <AccessGateContainer>
      <div className="flex flex-col gap-4">
        <SystemStatusContainer />
        <AuditStreamContainer />
      </div>
    </AccessGateContainer>
  );
}
