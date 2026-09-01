// 工作台入口（P21-1）：只装配 container（app 层只做布局编排，07 §2）。
// AccessGateContainer 包裹：启用口令时 401/未授权浮出解锁门；未启用（dev）时透明。
import { WorkbenchContainer } from '@/containers/workbench/WorkbenchContainer';
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { NewTaskDeepLinkContainer } from '@/containers/sandbox/NewTaskDeepLinkContainer';

export default function Page() {
  return (
    <AccessGateContainer>
      {/*
        「新建任务」深链（F21-2 §2.1，`/?new=1&project=<id>`）。不渲染任何东西，只是给
        深链读取与 URL 同步一个**在项目选中之上**的位置——理由见该 container 的文件头。
        放在 `AccessGateContainer` 之内：启用口令时它与工作台一起被解锁门挡在后面，
        项目列表 401 期间深链**不会**被当成失效抹掉（见 hook 里 `isSuccess` 那条注释）。
      */}
      <NewTaskDeepLinkContainer />
      <WorkbenchContainer />
    </AccessGateContainer>
  );
}
