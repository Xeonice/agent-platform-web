'use client';
// 工作台容器：把 hooks 输出映射为 WorkbenchShellView 的 props（唯一 view↔hooks 粘合点，07 §2）。
// S1：终端区 = SandboxTerminalContainer（建沙箱 + 终端）；左侧任务树是 S2 范围，此处先空。
import { useHealth } from '@/hooks/useHealth';
import { useProjectTaskTree } from '@/hooks/useProjectTaskTree';
import { useAppStore } from '@/stores';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import { SandboxTerminalContainer } from '@/containers/SandboxTerminalContainer';
import type { Project, Sandbox } from '@/types/domain';

const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? 'ws://localhost:3001';

// S1 不做项目/任务列表（S2 接入）：先空数组，只保证 shell 渲染路径与派生逻辑被走到。
const S1_PROJECTS: Project[] = [];
const S1_TASKS: Sandbox[] = [];

export function WorkbenchContainer() {
  const health = useHealth();
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const taskListFolds = useAppStore((s) => s.taskListFolds);

  const { groups, waitingInputCount } = useProjectTaskTree(
    S1_PROJECTS,
    S1_TASKS,
    taskListFolds,
    selectedProjectId,
  );

  // getHealth 成功路径必返回 ok=true（非 2xx 会 throw），只显示 HTTP 状态。
  const healthLabel =
    health.data !== undefined
      ? `后端健康（HTTP ${String(health.data.status)}）`
      : health.isError
        ? '后端不可用'
        : '正在检查后端…';

  return (
    <WorkbenchShellView
      groups={groups}
      waitingInputCount={waitingInputCount}
      healthLabel={healthLabel}
      terminalSlot={<SandboxTerminalContainer wsBaseUrl={WS_BASE_URL} />}
    />
  );
}
