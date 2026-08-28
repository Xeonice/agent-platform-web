// 系统状态页 /settings/system（F21-5 §2）：只装配 container（app 层只做布局编排，07 §2）。
// 布局复用 `src/app/settings/layout.tsx` + `SettingsLayout.view`。
//
// ⚠️ **本轮只落审计流这一块**（§3 组件树最后一个分支）。资源池 / provider / 连接状态 /
// 诊断四张卡依赖 `GET /api/system/resources`、`/providers`、`POST /diagnose` —— 这三个端点
// 后端尚未落地，现在摆一个占位卡片只会让"这页做完了"看起来是真的。
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { AuditStreamContainer } from '@/containers/system/AuditStreamContainer';

export default function SystemStatusPage() {
  return (
    <AccessGateContainer>
      <div className="flex flex-col gap-4">
        <AuditStreamContainer />
      </div>
    </AccessGateContainer>
  );
}
