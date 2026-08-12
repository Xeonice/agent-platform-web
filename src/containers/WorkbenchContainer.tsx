'use client';
// 工作台容器：把 hooks 输出映射为 WorkbenchShellView 的 props（唯一 view↔hooks 粘合点，07 §2）。
// 脚手架期后端未就绪：projects/tasks 先为空数组，仅打通 health 调用与终端装配链路。
import { useHealth } from '@/hooks/useHealth';
import { useProjectTaskTree } from '@/hooks/useProjectTaskTree';
import { useAppStore } from '@/stores';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import { TerminalContainer } from '@/containers/TerminalContainer';
import type { Project, Sandbox } from '@/types/domain';

const WS_BASE_URL = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? 'ws://localhost:3001';
const DEMO_SANDBOX_ID = 'demo-sandbox';

// 冒烟切片：后端未接入前用于验证终端装配与 msw echo。真实数据来自 Query（后端就绪后替换）。
const DEMO_PROJECTS: Project[] = [{ id: 'demo', name: '演示项目', cloneStatus: 'ok' }];
const DEMO_TASKS: Sandbox[] = [
  {
    id: DEMO_SANDBOX_ID,
    projectId: 'demo',
    name: '演示任务（点击右下方按钮打开终端）',
    status: 'running',
    waitingInput: false,
    lastActiveAt: Date.now(),
  },
];

export function WorkbenchContainer() {
  const health = useHealth();
  const selectedSandboxId = useAppStore((s) => s.selectedSandboxId);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const taskListFolds = useAppStore((s) => s.taskListFolds);
  const setSelectedSandboxId = useAppStore((s) => s.setSelectedSandboxId);

  const { groups, waitingInputCount } = useProjectTaskTree(
    DEMO_PROJECTS,
    DEMO_TASKS,
    taskListFolds,
    selectedProjectId,
  );

  const healthLabel =
    health.data !== undefined
      ? `后端健康：${health.data.status}（v${health.data.version}）`
      : health.isError
        ? '后端不可用'
        : '正在检查后端…';

  const sessionId = selectedSandboxId !== null ? `${selectedSandboxId}:0` : null;

  return (
    <WorkbenchShellView
      groups={groups}
      waitingInputCount={waitingInputCount}
      healthLabel={healthLabel}
      selectedTaskId={selectedSandboxId}
      onSelectTask={(taskId) => setSelectedSandboxId(taskId)}
      terminalSlot={
        <TerminalContainer
          sessionId={sessionId}
          sandboxId={selectedSandboxId}
          wsUrl={`${WS_BASE_URL}/terminal`}
        />
      }
    />
  );
}
