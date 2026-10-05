import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(root, 'docs/design-v2/gap/drafts');
export const frames = readdirSync(directory)
  .filter((name) => /^f-(img|sys|aut)-.*\.html$/.test(name))
  .sort()
  .map((file) => {
    const html = readFileSync(resolve(directory, file), 'utf8');
    const id = file.slice(0, -5);
    const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? id;
    return {
      id,
      group: id.replace(/-\d+$/, ''),
      state: Number(id.slice(-2)),
      title,
      source: `docs/design-v2/gap/drafts/${file}`,
      route: id.startsWith('f-img')
        ? '/settings/images'
        : id.startsWith('f-sys')
          ? '/settings/system'
          : '/',
    };
  });
export const now = '2026-10-05T00:00:00.000Z';
export const oldDigest = `sha256:${'a'.repeat(64)}`;
export const newDigest = `sha256:${'b'.repeat(64)}`;
export const capabilities = {
  spawnTty: true,
  volumeMount: true,
  updateResources: true,
  pauseResume: false,
  snapshot: false,
  watchEvents: true,
  headlessTask: true,
};
export const project = {
  id: 'project-a',
  name: 'acme-web',
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: now,
  updatedAt: now,
};
export const runtime = {
  id: 'codex',
  displayName: 'Codex',
  vendor: 'OpenAI',
  authMethods: ['api-key'],
  credentialStatus: 'active',
  credentials: [],
};
export const manifest = (extra = {}) => ({
  id: 'custom-current',
  imageId: 'custom',
  imageName: 'docker.io/acme/ml-agent',
  isBuiltin: false,
  ref: 'docker.io/acme/ml-agent:v1.0',
  version: 'v1.0',
  baseImage: 'debian',
  digest: oldDigest,
  entrypointContract: { workdir: '/', entrypoint: ['/bin/sh'] },
  supportedRuntimes: ['codex'],
  resourceDefaults: { cores: 1, ramMb: 512, diskMb: 1024 },
  labelsRequired: [],
  validationStatus: 'valid',
  validationErrors: [],
  isActive: true,
  imageConfig: {
    env: [
      { key: 'LOG_LEVEL', value: 'info', secret: false },
      { key: 'API_KEY', value: '', secret: true },
      { key: 'NODE_ENV', value: 'production', secret: false },
    ],
  },
  derivedFromDigest: newDigest,
  registeredAt: now,
  resolvedAt: now,
  ...extra,
});
export const rule = (extra = {}) => ({
  id: 'rule-nightly',
  projectId: project.id,
  name: '每天凌晨跑一遍回归',
  runtime: 'codex',
  prompt: '运行回归测试并汇总结果',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  timezone: 'Asia/Shanghai',
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  triggerOn: 'failure',
  enabled: true,
  degraded: false,
  consecutiveFailures: 0,
  createdAt: now,
  updatedAt: now,
  ...extra,
});
export const checks = [
  'container-runtime',
  'dev-kvm',
  'disk-space',
  'port-conflict',
  'outbound-network',
  'ws-loopback',
  'data-root-fs',
  'preset-image',
  'auth-helper',
].map((id, index) => ({
  id,
  label: [
    '容器运行时可达',
    '虚拟化支持',
    '数据目录磁盘空间',
    '端口占用',
    '出网连通性',
    '实时通道回环',
    '数据目录可读写',
    '预制镜像就绪',
    '帐号登录环境',
  ][index],
}));
export const frameText = (frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`;
export function configure(id) {
  const frame = frames.find((item) => item.id === id);
  if (!frame) throw new Error(`Unknown frame ${id}`);
  const { group, state } = frame;
  const gb = 1024 ** 3;
  const resources = {
    cpu: { cores: 8, loadAvg1m: 1.2, usedPercent: 15, level: 'ok' },
    ram: { totalBytes: 16 * gb, usedBytes: 4 * gb, usedPercent: 25, level: 'ok' },
    disk: {
      path: '/srv/platform/data',
      totalBytes: 200 * gb,
      usedBytes: 100 * gb,
      availableBytes: 100 * gb,
      usedPercent: 50,
      level: 'ok',
      reservedPercent: 15,
    },
    retainedVolumes: {
      count: 3,
      totalBytes: 2 * gb,
      percentOfDisk: 1,
      level: 'ok',
      truncated: false,
    },
    activeTasks: 2,
    capacity: { remainingTasks: 3, registeredTasks: 8, maxTasks: 11, basis: 'provider-ledger' },
  };
  if (group === 'f-sys-resource' && state === 2) {
    resources.cpu = { ...resources.cpu, usedPercent: 85, level: 'warn' };
    resources.capacity = {
      remainingTasks: 1,
      registeredTasks: 10,
      maxTasks: 11,
      basis: 'provider-ledger',
    };
  }
  if (group === 'f-sys-resource' && state === 3) {
    resources.disk = {
      ...resources.disk,
      usedBytes: 192 * gb,
      availableBytes: 8 * gb,
      usedPercent: 96,
      level: 'critical',
    };
    resources.capacity = {
      remainingTasks: 0,
      registeredTasks: 8,
      maxTasks: 11,
      basis: '磁盘已用96%',
    };
  }
  if (group === 'f-sys-resource' && state === 4)
    resources.retainedVolumes = {
      count: 18,
      totalBytes: 164 * gb,
      percentOfDisk: 82,
      level: 'critical',
      truncated: false,
    };
  let images = [
    manifest(),
    manifest({
      id: 'custom-history',
      digest: newDigest,
      isActive: false,
      registeredAt: '2026-09-23T00:00:00Z',
    }),
    manifest({
      id: 'builtin',
      imageId: 'preset',
      imageName: 'ghcr.io/agent-infra/sandbox',
      ref: 'ghcr.io/agent-infra/sandbox:latest',
      version: 'latest',
      isBuiltin: true,
      derivedFromDigest: null,
      imageConfig: null,
    }),
  ];
  if (group === 'f-img-page') images = [];
  if (group === 'f-img-state' && state === 1) images[0].isActive = false;
  if (group === 'f-img-env' && state === 3)
    images[0].imageConfig.env = Array.from({ length: 50 }, (_, index) => ({
      key: `FIELD_${index}`,
      value: 'value',
      secret: false,
    }));
  let rules = [
    rule(),
    rule({ id: 'rule-paused', name: '每周整理', enabled: false }),
    rule({
      id: 'rule-disabled',
      name: '已自动关闭的回归',
      enabled: false,
      degraded: true,
      consecutiveFailures: 10,
    }),
  ];
  if (group === 'f-aut-rules' && state === 2)
    rules = Array.from({ length: 20 }, (_, index) =>
      rule({ id: `rule-${index}`, name: `回归 ${index + 1}` }),
    );
  if (group === 'f-aut-rules' && state === 3) rules = [];
  const runs = [
    {
      id: 'run-failed',
      automationId: 'rule-nightly',
      status: 'failed',
      retryCount: 2,
      triggeredAt: now,
      startedAt: now,
      completedAt: now,
      sandboxId: 'finished-task',
      errorMessage: 'regression failed: expected 42',
      outputSummary: '1 regression check failed',
      webhookStatus: 'failed',
    },
    {
      id: 'run-success',
      automationId: 'rule-nightly',
      status: 'success',
      retryCount: 0,
      triggeredAt: now,
      startedAt: now,
      completedAt: now,
      sandboxId: 'success-task',
    },
  ];
  const settings = {
    initialized: true,
    accessPasscodeEnabled: false,
    version: { platform: '0.2.4', node: '22' },
    proxyConfig: { httpProxy: '', httpsProxy: '', noProxy: 'localhost' },
  };
  const auditEvent = (seq, extra = {}) => ({
    seq,
    at: now,
    category: 'sandbox',
    type: 'sandbox.state_changed',
    severity: 'warn',
    actor: 'provider-event',
    summary: '任务状态 启动中 → 运行中',
    subjectType: 'sandbox',
    subjectId: 'review-task',
    detail: { from: 'starting', to: 'running', name: '迁移构建脚本' },
    ...extra,
  });
  return {
    frame,
    resources,
    images,
    rules,
    mutations: [],
    stream(kind) {
      if (kind === 'provision')
        return {
          frames: [
            {
              event: 'stage',
              stage: state === 3 ? 'verify' : 'fetch',
              status: 'running',
              message: state === 3 ? '正在校验镜像包（约 320 MB）…' : '正在获取镜像',
              progress: state === 1 ? 0.37 : null,
            },
            ...(state === 3
              ? [
                  {
                    event: 'done',
                    ok: false,
                    error: '校验 sha256 对不上：已停在校验这一步，没有装载。',
                  },
                ]
              : []),
          ],
          hold: state !== 3,
        };
      if (group !== 'f-sys-diag')
        return {
          frames: [
            { event: 'start', checks: [checks[7]], timeoutMs: 10000 },
            {
              event: 'check',
              ...checks[7],
              status: 'info',
              step: 'staged',
              headline: '镜像还没下载到本机',
              durationMs: 1,
              detail: {
                ref: 'ghcr.io/agent-infra/sandbox:latest',
                provision: {
                  provisionable: true,
                  from: 'ghcr.io/agent-infra/sandbox:latest',
                  to: '本机镜像库',
                  sizeBytes: 320 * 1024 ** 2,
                  why: '首个任务会先下载',
                },
              },
            },
            { event: 'done', okCount: 0, infoCount: 1, warnCount: 0, failCount: 0, totalMs: 10 },
          ],
          hold: false,
        };
      if (state === 1) return { frames: [], hold: true };
      const count = state === 2 ? 4 : state === 3 ? 5 : 9;
      const result = checks.slice(0, count).map((check, index) => ({
        event: 'check',
        ...check,
        status:
          state === 4
            ? index === 3
              ? 'fail'
              : index === 4
                ? 'warn'
                : index === 5
                  ? 'timeout'
                  : index === 7
                    ? 'info'
                    : 'ok'
            : state === 5 && index === 1
              ? 'info'
              : 'ok',
        headline: state === 4 && index === 5 ? '10 秒内没有结果' : `${check.label}已返回`,
        durationMs: state === 4 && index === 5 ? 10000 : 20,
        ...(state === 4 && index === 3
          ? { command: 'lsof -nP -iTCP:3000 -sTCP:LISTEN', detailText: '端口被其他进程占用' }
          : {}),
        ...(state === 4 && index === 7
          ? {
              step: 'staged',
              detail: {
                ref: 'ghcr.io/agent-infra/sandbox:latest',
                provision: {
                  provisionable: true,
                  from: 'ghcr.io/agent-infra/sandbox:latest',
                  to: '本机镜像库',
                  sizeBytes: null,
                  why: '首次任务需下载',
                },
              },
            }
          : {}),
      }));
      const counters = {
        okCount: result.filter((x) => x.status === 'ok').length,
        infoCount: result.filter((x) => x.status === 'info').length,
        warnCount: result.filter((x) => x.status === 'warn').length,
        failCount: result.filter((x) => x.status === 'fail' || x.status === 'timeout').length,
        totalMs: 10000,
      };
      return {
        frames: [
          { event: 'start', checks, timeoutMs: 10000 },
          ...result,
          ...(state >= 4 ? [{ event: 'done', ...counters }] : []),
        ],
        hold: state === 2,
      };
    },
    get(path, query) {
      if (path === '/api/system/init-status')
        return {
          initialized: true,
          initializedAt: now,
          lastConnectivityCheck: [
            {
              target: 'api.openai.com',
              ok: group !== 'f-sys-conn' || state !== 2,
              latencyMs: 100,
              modelApi: true,
            },
          ],
          lastConnectivityCheckAt: now,
        };
      if (path === '/api/health') return { status: 'ok' };
      if (path === '/api/projects') return [project];
      if (path === '/api/runtimes') return [runtime];
      if (path === '/api/providers') return [{ name: 'aio', isDefault: true, capabilities }];
      if (path === '/api/sandboxes') return [];
      if (path === '/api/automations/attention') return [];
      if (path === '/api/images') {
        if (group === 'f-img-page' && state === 2) return { delay: true };
        if (group === 'f-img-page' && state === 3) return { error: 503 };
        return images;
      }
      if (path === '/api/system/resources') {
        if (group === 'f-sys-resource' && state === 1) return { delay: true };
        if (group === 'f-sys-conn' && state === 3) return { error: 503 };
        return resources;
      }
      if (path === '/api/system/providers') {
        if (group === 'f-sys-resource' && state === 1) return { delay: true };
        if (group === 'f-sys-conn' && state === 3) return { error: 503 };
        return {
          providers: [
            {
              id: 'aio',
              isDefault: true,
              healthy: group !== 'f-sys-conn' || state !== 1,
              recentFailureRate: group === 'f-sys-conn' && state === 1 ? 0.12 : 0.005,
              sampleSize: 200,
              failureCount: 1,
              capabilities,
            },
          ],
          runtimes: [
            {
              id: 'codex',
              displayName: 'Codex',
              vendor: 'OpenAI',
              authMethods: ['api-key'],
              credentialConfigured: false,
            },
          ],
          imageSpecs: [{ id: 'oci', isDefault: true }],
          healthWindowMs: 3600000,
          healthWarnRate: 0.01,
          healthErrorRate: 0.1,
        };
      }
      if (path === '/api/system/settings')
        return group === 'f-sys-conn' && state === 3 ? { error: 503 } : settings;
      if (path === '/api/system/version')
        return { version: '0.2.4', commit: 'design-fixture', builtAt: now };
      if (path.includes('/providers/') && path.endsWith('/logs'))
        return {
          lines: ['aio create container failed', 'aio retry failed'],
          unavailableReason: undefined,
        };
      if (path.endsWith('/automations'))
        return group === 'f-aut-rules' && state === 13 ? { error: 503 } : rules;
      if (path.endsWith('/runs'))
        return state === 11 ? { error: 503 } : { items: state === 10 ? [] : runs, hasMore: false };
      if (path.endsWith('/deletion-preview'))
        return path.includes('/images/')
          ? {
              canDelete: state !== 3,
              tasks:
                state === 3
                  ? [
                      {
                        id: 'task-wait',
                        name: '补 e2e 用例',
                        projectId: project.id,
                        projectName: project.name,
                        status: 'waiting_input',
                      },
                      {
                        id: 'task-stopped',
                        name: '跑一遍示例测试',
                        projectId: 'project-other',
                        projectName: '示例项目',
                        status: 'stopped',
                      },
                    ]
                  : [],
              versions: images
                .filter((x) => x.imageId === 'custom')
                .map(({ id, version, digest, isActive }) => ({ id, version, digest, isActive })),
            }
          : {
              runCount: 42,
              artifactCount: 1,
              runningTasks: [{ id: 'live-task', name: '每天凌晨跑一遍回归 #12' }],
              pendingTeardownCount: 0,
            };
      if (path === '/api/retained-volumes')
        return [
          {
            id: 'retained',
            projectId: project.id,
            sandboxId: 'finished-task',
            sandboxName: '每天凌晨跑一遍回归 #12',
            sourceAutomationId: 'rule-nightly',
            sourceAutomationName: rule().name,
            source: 'automation-artifact',
            retainedAt: now,
            retainUntil: '2026-10-12T00:00:00Z',
            diskBytes: gb,
            downloadBytes: gb / 2,
          },
        ];
      if (path === '/api/system/audit') {
        if (group === 'f-sys-conn' && state === 3) return { error: 503 };
        if (group === 'f-sys-audit' && state === 4 && query.has('since')) return { error: 503 };
        return {
          items:
            group === 'f-sys-audit' && [1, 2, 3, 5].includes(state)
              ? []
              : [auditEvent(100), auditEvent(99, { severity: 'info' })],
          hasMore: false,
        };
      }
      if (path.includes('/sandboxes/')) return { id: 'review-task', name: '迁移构建脚本' };
      return [];
    },
    mutate(method, path, input) {
      this.mutations.push({ method, path, input });
      if (path === '/api/images/validate')
        return state === 6
          ? { error: 502, code: 'REGISTRY_UNREACHABLE' }
          : {
              status: state === 2 ? 'invalid' : 'warning',
              digest: newDigest,
              errors:
                state === 2
                  ? [
                      { code: 'IMAGE_BASE_REQUIRED', message: 'raw lineage finding' },
                      { code: 'IMAGE_ENTRYPOINT_INVALID', message: 'raw entrypoint finding' },
                    ]
                  : [],
              warnings:
                state === 2
                  ? []
                  : [
                      {
                        code: 'RUNTIME_NOT_PREINSTALLED',
                        message: "not preinstalled 'claude-code'",
                      },
                    ],
            };
      if (path === '/api/images' && method === 'POST')
        return {
          manifest: images[0],
          validation: { status: 'valid', errors: [], warnings: [] },
          created: false,
        };
      if (path.endsWith('/check-update'))
        return {
          current: { digest: oldDigest, resolvedAt: now },
          upstream: {
            digest: newDigest,
            validation: { status: 'valid', errors: [], warnings: [] },
          },
          changed: true,
        };
      if (path.includes('/images/') && path.endsWith('/validate'))
        return state === 2
          ? { delay: true }
          : {
              sameDigest: true,
              validation: { status: 'valid', errors: [], warnings: [] },
              checkedAt: now,
            };
      if (path.includes('/images/') && path.endsWith('/activate')) {
        images[0].isActive = false;
        images[1].isActive = true;
        return images[1];
      }
      if (path.includes('/images/') && method === 'PATCH') {
        images[0] = { ...images[0], ...input };
        return images[0];
      }
      if (path === '/api/system/settings') {
        if (group === 'f-sys-conn' && state === 2)
          return {
            error: 400,
            code: 'VALIDATION_FAILED',
            details: [
              { path: 'proxyConfig.httpsProxy', code: 'custom', message: 'invalid HTTPS proxy' },
            ],
          };
        Object.assign(settings, input);
        return settings;
      }
      if (path.endsWith('/webhook-test'))
        return { ok: false, message: '通知目标拒绝接收', errorCode: 'UPSTREAM_UNAVAILABLE' };
      if (path.endsWith('/automations') || path.includes('/automations/'))
        return state === 6 ? { error: 500 } : rule();
      return { error: 405, code: 'UNSUPPORTED_REVIEW_MUTATION' };
    },
  };
}
