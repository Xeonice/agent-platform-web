import type { ProjectDto } from '@/types/project';
import type { SandboxDto, SandboxProviderDto } from '@/types/sandbox';
import type { RuntimeDto } from '@/types/runtimeCredential';
import type { InitStatusDto, SystemResourcesDto } from '@/types/system';

export const API = 'http://localhost:3001';
export const NOW = '2026-10-05T00:00:00.000Z';
export const project = (extra: Partial<ProjectDto> = {}): ProjectDto => ({
  id: 'project-a',
  name: 'acme-web',
  sourceType: 'git',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  repoUrl: 'https://github.com/acme/web.git',
  repoBranch: 'main',
  baselineSizeBytes: 45 * 1024 ** 2,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});
export const sandbox = (extra: Partial<SandboxDto> = {}): SandboxDto => ({
  id: 'task-a',
  projectId: 'project-a',
  name: '修复首页',
  runtime: 'codex',
  availableRuntimes: ['codex'],
  provider: 'aio',
  status: 'running',
  headless: false,
  hasRun: true,
  waitingInput: false,
  timeoutMinutes: null,
  idleTimeoutSec: 1800,
  version: 1,
  image: 'ghcr.io/agent-infra/sandbox:latest',
  imageId: 'preset',
  imageIsBuiltin: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});
export const runtime = (extra: Partial<RuntimeDto> = {}): RuntimeDto => ({
  id: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  authMethods: ['oauth-device', 'api-key'],
  credentialStatus: 'active',
  maskedIdentifier: 'a***@example.com',
  credentials: [],
  ...extra,
});
export const provider: SandboxProviderDto = {
  name: 'aio',
  isDefault: true,
  capabilities: {
    spawnTty: true,
    volumeMount: true,
    updateResources: true,
    pauseResume: false,
    snapshot: false,
    watchEvents: true,
    headlessTask: true,
  },
};
export const online: NonNullable<InitStatusDto['lastConnectivityCheck']> = [
  { target: 'api.openai.com', ok: true, latencyMs: 150, modelApi: true },
  { target: 'api.anthropic.com', ok: true, latencyMs: 200, modelApi: true },
  { target: 'ghcr.io', ok: true, latencyMs: 90, modelApi: false },
];
export const resources: SystemResourcesDto = {
  cpu: { cores: 8, loadAvg1m: 1.2, usedPercent: 15, level: 'ok' },
  ram: { totalBytes: 32 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, usedPercent: 25, level: 'ok' },
  disk: {
    path: '/srv/agent-platform/data',
    totalBytes: 500 * 1024 ** 3,
    usedBytes: 200 * 1024 ** 3,
    availableBytes: 300 * 1024 ** 3,
    usedPercent: 40,
    reservedPercent: 25,
    level: 'ok',
  },
  retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
  activeTasks: 2,
  capacity: { registeredTasks: 8, maxTasks: 8, remainingTasks: 0, basis: 'provider-ledger' },
};
export function deferred() {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value))
    : {};
}
