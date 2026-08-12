// 工作台入口（P21-1）：只装配 container（app 层只做布局编排，07 §2）。
import { WorkbenchContainer } from '@/containers/WorkbenchContainer';

export default function Page() {
  return <WorkbenchContainer />;
}
