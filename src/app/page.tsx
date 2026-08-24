// 工作台入口（P21-1）：只装配 container（app 层只做布局编排，07 §2）。
// AccessGateContainer 包裹：启用口令时 401/未授权浮出解锁门；未启用（dev）时透明。
import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';

export default function Page() {
  return (
    <AccessGateContainer>
      <WorkbenchContainer />
    </AccessGateContainer>
  );
}
