import { useEffect, useState, type KeyboardEvent } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/stores';
import { selectWorkbenchTask } from '@/hooks/workbench/useWorkbenchRoute';
import { useOfflineMode } from '@/hooks/system/useGlobalBanner';
import { useReportUnauthorized } from '@/hooks/access/useAccessGate';
import { automationKeys } from '@/hooks/automation/useAutomations';
import { retainedVolumeKeys } from '@/hooks/project/useRetainedVolumes';
import { listAutomations } from '@/services/api/automation.service';
import { listRetainedVolumes } from '@/services/api/retainedVolume.service';
import { filterCommands } from '@/lib/workbench/filterCommands';
import type { AppCommand } from '@/types/command';
import type { ProjectDto } from '@/types/project';
import type { Sandbox } from '@/types/domain';

interface Args {
  projects: ProjectDto[];
  tasks: Sandbox[];
  pathname: string;
  onClose: () => void;
  deferFocusRestore: () => void;
}

export function useCommandPalette({ projects, tasks, pathname, onClose, deferFocusRestore }: Args) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const theme = useAppStore((s) => s.theme);
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedSandboxId = useAppStore((s) => s.selectedSandboxId);
  const visibleTerminal = useAppStore((s) => s.visibleTerminal);
  const offline = useOfflineMode();
  const { reportRestError } = useReportUnauthorized();
  const readyProjects = projects.filter((project) => project.cloneStatus === 'ready');
  const selectedProject =
    pathname === '/' ? projects.find((project) => project.id === selectedProjectId) : undefined;
  const currentProject =
    pathname === '/'
      ? readyProjects.find((project) => project.id === selectedProjectId)
      : undefined;
  const rules = useQueries({
    queries: readyProjects.map((project) => ({
      queryKey: automationKeys.list(project.id),
      queryFn: () => listAutomations(project.id),
      staleTime: 30_000,
    })),
  });
  const volumes = useQueries({
    queries: readyProjects.map((project) => ({
      queryKey: retainedVolumeKeys.list(project.id),
      queryFn: () => listRetainedVolumes(project.id),
      staleTime: 30_000,
    })),
  });
  useEffect(() => {
    for (const result of [...rules, ...volumes]) if (result.error) reportRestError(result.error);
  }, [rules, volumes, reportRestError]);

  const run =
    (action: () => void, opensDialog = false): (() => void) =>
    () => {
      if (opensDialog) deferFocusRestore();
      action();
      onClose();
    };
  const openPanel = (projectId: string, modal: 'automations' | 'retainedVolumes'): (() => void) =>
    run(() => {
      const state = useAppStore.getState();
      state.setSelectedProjectForMenu(projectId);
      state.setCurrentModal(modal);
      router.push('/');
    }, true);
  const goProject = (id: string): void => {
    const state = useAppStore.getState();
    state.setSelectedProjectId(id);
    state.setSelectedSandboxId(null);
    state.expandProject(id);
    router.push('/');
  };
  const goTask = (task: Sandbox): (() => void) =>
    run(() => {
      goProject(task.projectId);
      selectWorkbenchTask(task.id, task.projectId, task.name);
    });
  const hasTerminal =
    pathname === '/' &&
    selectedSandboxId !== null &&
    visibleTerminal?.sandboxId === selectedSandboxId;
  const taskDisabledReason =
    offline.disabledReason ??
    (selectedProject !== undefined && selectedProject.cloneStatus !== 'ready'
      ? selectedProject.cloneStatus === 'cloning'
        ? '项目还在克隆，克隆完成后可发起'
        : '克隆失败的项目不能发起任务：先重试克隆或改为空项目'
      : readyProjects.length === 0
        ? projects.length === 0
          ? '先新建一个项目'
          : '项目尚未就绪（克隆完成后可发起）'
        : undefined);
  const effectiveTheme =
    theme === 'system'
      ? typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
        ? 'dark'
        : 'light'
      : theme;
  const commands: AppCommand[] = [
    ...tasks
      .filter((task) => task.waitingInput || task.status === 'error' || task.stuck)
      .sort(
        (a, b) =>
          (a.status === 'error' ? 0 : a.stuck ? 1 : 2) -
          (b.status === 'error' ? 0 : b.stuck ? 1 : 2),
      )
      .map((task) => ({
        id: `attention-${task.id}`,
        name: task.name,
        description: task.status === 'error' ? '任务异常' : task.stuck ? '可能卡住' : '等待你输入',
        group: '需要你处理' as const,
        execute: goTask(task),
      })),
    ...tasks.map((task) => ({
      id: `task-${task.id}`,
      name: task.name,
      description: projects.find((project) => project.id === task.projectId)?.name ?? '任务',
      group: '任务' as const,
      execute: goTask(task),
    })),
    ...projects.map((project) => ({
      id: `project-${project.id}`,
      name: project.name,
      group: '项目' as const,
      description:
        project.cloneStatus === 'ready'
          ? `${String(project.taskCount)} 个任务`
          : project.cloneStatus === 'cloning'
            ? '克隆中'
            : '克隆失败',
      execute: run(() => {
        goProject(project.id);
      }),
    })),
    ...[
      ['overview', '项目总览', '/'],
      ['credentials', '凭证管理', '/settings/credentials'],
      ['images', '镜像管理', '/settings/images'],
      ['system', '系统状态', '/settings/system'],
    ].map(([id, name, href]) => ({
      id: `go-${id ?? ''}`,
      name: name ?? '',
      group: '前往' as const,
      execute: run(() => {
        if (href === '/') {
          useAppStore.getState().setSelectedProjectId(null);
          useAppStore.getState().setSelectedSandboxId(null);
        }
        router.push(href ?? '/');
      }),
    })),
    {
      id: 'new-task',
      name: '新任务…',
      synonyms: ['新建任务', '发起任务'],
      group: '动作',
      ...(taskDisabledReason === undefined ? {} : { disabledReason: taskDisabledReason }),
      execute: run(() => {
        if (currentProject === undefined) useAppStore.getState().setSelectedProjectId(null);
        useAppStore.getState().setCurrentModal('newTask');
        router.push('/');
      }, true),
    },
    {
      id: 'new-project',
      name: '新建项目…',
      synonyms: ['创建项目'],
      group: '动作',
      execute: run(() => {
        useAppStore.getState().setProjectCreateSource(null);
        useAppStore.getState().setCurrentModal('createProject');
        router.push('/');
      }, true),
    },
    {
      id: 'register-image',
      name: '注册新镜像…',
      description: '镜像管理',
      group: '动作',
      execute: run(() => {
        useAppStore.getState().setCurrentModal('registerImage');
        router.push('/settings/images');
      }, true),
    },
    {
      id: 'diagnose',
      name: '运行诊断',
      description: '系统状态',
      group: '动作',
      execute: run(() => {
        useAppStore.getState().requestDiagnoseAutorun();
        router.push('/settings/system');
      }),
    },
    {
      id: 'theme',
      name: effectiveTheme === 'dark' ? '切到亮色' : '切到暗色',
      description: `现在：${effectiveTheme === 'dark' ? '暗色' : '亮色'}`,
      synonyms: ['切换主题', '外观', '主题'],
      group: '动作',
      execute: run(() => {
        useAppStore.getState().setTheme(effectiveTheme === 'dark' ? 'light' : 'dark');
      }),
    },
    {
      id: 'sidebar',
      name: sidebarCollapsed ? '展开侧栏' : '收起侧栏',
      description: '⌘B',
      group: '动作',
      execute: run(() => {
        useAppStore.getState().toggleSidebar();
      }),
    },
    {
      id: 'clear',
      name: '清屏',
      description: hasTerminal ? '当前终端' : '当前没有终端',
      group: '动作',
      ...(hasTerminal ? {} : { disabledReason: '当前没有终端' }),
      execute: run(() => {
        if (selectedSandboxId !== null)
          useAppStore.getState().requestTerminalClear(selectedSandboxId);
      }),
    },
  ];
  const projectCommands: AppCommand[] = readyProjects.map((project, index) => {
    const ruleCount = rules[index]?.isError ? undefined : rules[index]?.data?.length;
    return {
      id: `rules-${project.id}`,
      name: `自动化规则 · ${project.name}`,
      description:
        ruleCount === undefined
          ? rules[index]?.isError
            ? '暂时读不到规则'
            : '正在读取规则…'
          : ruleCount === 0
            ? '还没有规则'
            : `${String(ruleCount)} 条`,
      group: '动作',
      execute: openPanel(project.id, 'automations'),
    };
  });
  const volumeCommands: AppCommand[] =
    currentProject !== undefined
      ? [
          {
            id: `volumes-${currentProject.id}`,
            name: '保留下来的成果…',
            description: currentProject.name,
            group: '动作',
            execute: openPanel(currentProject.id, 'retainedVolumes'),
          },
        ]
      : readyProjects.flatMap((project, index) => {
          const count = volumes[index]?.isError ? 0 : (volumes[index]?.data?.length ?? 0);
          return count > 0
            ? [
                {
                  id: `volumes-${project.id}`,
                  name: `保留下来的成果 · ${project.name}`,
                  description: `${String(count)} 份`,
                  group: '动作' as const,
                  execute: openPanel(project.id, 'retainedVolumes'),
                },
              ]
            : [];
        });
  commands.splice(
    commands.findIndex((command) => command.id === 'theme'),
    0,
    ...projectCommands,
    ...volumeCommands,
  );
  const sections = filterCommands(commands, query);
  const items = sections.flatMap((section) => section.items);
  const activeId = items.some((item) => item.id === selectedId)
    ? selectedId
    : (items[0]?.id ?? null);
  const execute = (id: string): void => {
    const item = items.find((command) => command.id === id);
    if (item !== undefined && item.disabledReason === undefined) item.execute();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const index = items.findIndex((item) => item.id === activeId);
      const next =
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      if (next) setSelectedId(next.id);
    } else if (event.key === 'Enter' && activeId !== null) {
      event.preventDefault();
      execute(activeId);
    }
  };
  useEffect(() => {
    if (activeId !== null)
      document.getElementById(`command-${activeId}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);
  return { query, setQuery, sections, activeId, setSelectedId, execute, onKeyDown };
}
