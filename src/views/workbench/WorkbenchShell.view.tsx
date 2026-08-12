// 工作台骨架 view（P21-1）：顶栏 + 左侧任务树占位 + 右侧终端区。纯展示，props 驱动。
import type { ReactNode } from 'react';
import type { ProjectGroup } from '@/types/domain';
import { Button } from '@/components/ui/button';

export interface WorkbenchShellProps {
  groups: ProjectGroup[];
  waitingInputCount: number;
  healthLabel: string;
  terminalSlot: ReactNode;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  onNewProject?: () => void;
}

export function WorkbenchShellView({
  groups,
  waitingInputCount,
  healthLabel,
  terminalSlot,
  selectedTaskId = null,
  onSelectTask,
  onNewProject,
}: WorkbenchShellProps) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-3 border-b border-border px-4">
        <span className="font-semibold">Agent 管理平台</span>
        <span className="text-xs text-muted-foreground" data-testid="health-label">
          {healthLabel}
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-72 flex-col border-r border-border">
          {waitingInputCount > 0 && (
            <div className="border-b border-border px-3 py-2 text-xs text-yellow-300">
              ⚡ {waitingInputCount} 个任务等待你输入
            </div>
          )}
          <nav className="flex-1 overflow-auto p-2" aria-label="项目分组任务树">
            {groups.map((group) => (
              <section key={group.projectId} className="mb-2">
                <h2 className="px-1 py-1 text-xs font-medium text-muted-foreground">
                  {group.projectName} · {group.tasks.length}
                </h2>
                {!group.collapsed &&
                  (group.tasks.length === 0 ? (
                    <p className="px-1 py-1 text-xs text-muted-foreground">
                      在 {group.projectName} 中发起第一个任务 →
                    </p>
                  ) : (
                    <ul>
                      {group.tasks.map((task) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            aria-current={selectedTaskId === task.id}
                            className={
                              'w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ' +
                              (selectedTaskId === task.id ? 'bg-muted' : '')
                            }
                            onClick={() => onSelectTask?.(task.id)}
                          >
                            {task.waitingInput ? '🔵 ' : ''}
                            {task.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </section>
            ))}
          </nav>
          <div className="border-t border-border p-2">
            <Button variant="outline" size="sm" className="w-full" onClick={onNewProject}>
              ＋ 新建项目
            </Button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">{terminalSlot}</main>
      </div>
    </div>
  );
}
