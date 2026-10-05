import assert from 'node:assert/strict';

export const NOW = '2026-10-05T00:00:00.000Z';
const GB = 1024 ** 3;
const digest = `sha256:${'a'.repeat(64)}`;
const image = 'ghcr.io/agent-infra/sandbox:latest';
export const connectivity = (mode = 'ok') =>
  ['api.openai.com', 'api.anthropic.com', 'ghcr.io'].map((target, index) => ({
    target,
    modelApi: index < 2,
    ok: mode === 'ok' || (mode === 'partial' && index < 2),
    latencyMs: 122 + index * 80,
    ...(mode === 'offline'
      ? { hint: 'DNS 解析不了：ENOTFOUND' }
      : mode === 'partial' && index === 2
        ? { timedOut: true, hint: '7 秒内没有完成 TLS 握手；超时不等于连不上。' }
        : {}),
  }));
const project = (id, name, extra = {}) => ({
  id,
  name,
  sourceType: 'empty',
  cloneStatus: 'ready',
  cloneErrorCode: null,
  taskCount: 0,
  createdAt: NOW,
  updatedAt: NOW,
  baselineSizeBytes: 12 * 1024 ** 2,
  ...extra,
});
const task = (id, name, extra = {}) => ({
  id,
  name,
  projectId: 'p-web',
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
  image,
  imageId: 'preset',
  imageDigest: digest,
  imageIsBuiltin: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});
export function fixtures(frame) {
  const f = {
    frame,
    writes: [],
    reads: [],
    sockets: [],
    namespaces: [],
    pending: new Map(),
    eventSockets: [],
    taskSockets: [],
    terminalSockets: [],
  };
  f.projects = [
    project('p-example', '示例项目', { taskCount: 3 }),
    project('p-web', 'acme-web', {
      sourceType: 'git',
      repoUrl: 'https://github.com/acme/web.git',
      repoBranch: 'main',
      baselineSizeBytes: 45 * 1024 ** 2,
      taskCount: 7,
    }),
    project('p-api', 'acme-api', {
      sourceType: 'git',
      repoUrl: 'https://github.com/acme/api.git',
      cloneStatus: 'failed',
      cloneErrorCode: 'CLONE_FAILED_NETWORK',
    }),
    project('p-docs', 'docs-site'),
    project('p-infra', 'infra-scripts', {
      sourceType: 'git',
      repoUrl: 'https://github.com/acme/infra.git',
      cloneStatus: 'cloning',
    }),
  ];
  f.tasks = [
    task('t-wait', '补 e2e 用例', { waitingInput: true }),
    task('t-wait2', '重构支付回调', { waitingInput: true }),
    task('t-running', '修一下登录态刷新'),
    task('t-headless', '整理发布说明', { headless: true }),
    task('t-auto', '每天凌晨跑一遍回归 #12', {
      headless: true,
      sourceAutomationId: 'rule-nightly',
      sourceAutomationName: '每天凌晨跑一遍回归',
    }),
    task('t-failed', '迁移构建脚本', {
      status: 'failed',
      failureCode: 'IMAGE_PULL_FAILED',
      failureMessage: '镜像下载源连接超时',
      failureOperation: 'provision',
      hasRun: false,
    }),
    task('t-timeout', '升级依赖到 Node 22', {
      status: 'failed',
      failureCode: 'TIMEOUT',
      failureOperation: 'provision',
    }),
    ...['跑一遍示例测试', '改一处示例代码', '补一份示例 README'].map((name, i) =>
      task(`t-stopped-${i}`, name, { projectId: 'p-example', status: 'stopped' }),
    ),
  ];
  f.provider = {
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
  f.runtimes = [
    {
      id: 'codex',
      displayName: 'Codex',
      vendor: 'OpenAI',
      authMethods: ['oauth-device', 'api-key'],
      credentialStatus: 'active',
      maskedIdentifier: 'a***@example.com',
      credentials: [],
    },
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      vendor: 'Anthropic',
      authMethods: ['setup-token'],
      credentialStatus: 'expired',
      maskedIdentifier: 'b***@example.com',
      credentials: [],
    },
  ];
  f.images = [
    {
      id: 'preset',
      imageId: 'preset-image',
      imageName: 'ghcr.io/agent-infra/sandbox',
      isBuiltin: true,
      ref: image,
      version: 'latest',
      digest,
      baseImage: 'alpine',
      entrypointContract: { workdir: '/workspace', entrypoint: ['/bin/sh'] },
      supportedRuntimes: ['codex'],
      resourceDefaults: { cores: 2, ramMb: 2048, diskMb: 10240 },
      labelsRequired: [],
      validationStatus: 'valid',
      validationErrors: [],
      isActive: true,
      imageConfig: null,
      derivedFromDigest: null,
      registeredAt: NOW,
      resolvedAt: NOW,
      providerCompatibility: { aio: true },
      isProviderDefault: true,
    },
    {
      id: 'custom',
      imageId: 'custom-image',
      imageName: 'docker.io/acme/ml-agent',
      isBuiltin: false,
      ref: 'docker.io/acme/ml-agent:v1.0',
      version: 'v1.0',
      digest,
      validationStatus: 'valid',
      isActive: true,
      supportedRuntimes: ['codex'],
      validationErrors: [],
      providerCompatibility: { aio: true },
    },
    {
      id: 'invalid',
      imageId: 'invalid-image',
      imageName: 'docker.io/acme/just-registered',
      ref: 'docker.io/acme/just-registered:v1',
      version: 'v1',
      validationStatus: 'invalid',
      isActive: true,
      isBuiltin: false,
      supportedRuntimes: [],
      validationErrors: [{ code: 'ENTRYPOINT_MISMATCH', message: '不符合平台约定' }],
      providerCompatibility: { aio: true },
    },
  ];
  f.resources = {
    cpu: { cores: 8, loadAvg1m: 1.4, usedPercent: 18, level: 'ok' },
    ram: { totalBytes: 32 * GB, usedBytes: 8 * GB, usedPercent: 25, level: 'ok' },
    disk: {
      path: '/srv/agent-platform/data',
      totalBytes: 500 * GB,
      usedBytes: 210 * GB,
      availableBytes: 290 * GB,
      usedPercent: 42,
      reservedPercent: 10,
      level: 'ok',
    },
    retainedVolumes: {
      count: 3,
      totalBytes: 5 * GB,
      percentOfDisk: 1,
      level: 'ok',
      truncated: false,
    },
    activeTasks: 5,
    capacity: { registeredTasks: 8, maxTasks: 8, remainingTasks: 0, basis: 'provider-ledger' },
  };
  f.retained = [
    {
      id: 'v-one',
      sandboxId: 'old-one',
      sandboxName: '改一处示例代码',
      source: 'manual-destroy',
      projectId: 'p-example',
      diskBytes: 1.6 * GB,
      downloadBytes: 0.4 * GB,
      retainedAt: '2026-09-05T00:00:00Z',
      retainUntil: '2026-10-05T12:00:00Z',
    },
    {
      id: 'v-two',
      sandboxId: 'old-two',
      sandboxName: '补一份示例 README',
      source: 'manual-destroy',
      projectId: 'p-example',
      diskBytes: 2.1 * GB,
      downloadBytes: 0.6 * GB,
      retainedAt: '2026-10-02T00:00:00Z',
      retainUntil: '2026-11-01T00:00:00Z',
    },
    {
      id: 'v-auto',
      sandboxId: 'old-auto',
      sandboxName: '每天凌晨跑一遍回归 #11',
      source: 'automation-artifact',
      sourceAutomationId: 'rule-nightly',
      sourceAutomationName: '每天凌晨跑一遍回归',
      projectId: 'p-web',
      diskBytes: GB,
      downloadBytes: 0.3 * GB,
      retainedAt: NOW,
      retainUntil: '2026-10-12T00:00:00Z',
    },
  ];
  f.agentTask = {
    id: 'agent-run',
    sandboxId: 't-headless',
    runtime: 'codex',
    status: 'running',
    sessionRef: '0199a6c3-4f2e',
    timeoutMinutes: 120,
    lastSeq: 7,
    startedAt: '2026-10-04T23:23:00Z',
    artifacts: [],
  };
  f.init = {
    initialized: !frame.startsWith('f-dep-'),
    initializedAt: NOW,
    lastConnectivityCheck: connectivity(),
    lastConnectivityCheckAt: NOW,
  };
  f.networkMode = 'ok';
  f.presetMode = 'ok';
  f.delay = (key) => new Promise((resolve) => f.pending.set(key, resolve));
  f.release = (key) => {
    f.pending.get(key)?.();
    f.pending.delete(key);
  };
  f.emit = (event) => {
    for (const socket of f.eventSockets)
      socket.send(`42/events,${JSON.stringify(['event', event])}`);
  };
  f.emitTask = (payload) => {
    for (const socket of f.taskSockets)
      socket.send(`42/tasks,${JSON.stringify(['frame', payload])}`);
  };
  return f;
}
const apiError = (code, message, retryable = true) => ({
  code,
  message,
  retryable,
  ...(code === 'BRANCH_NOT_FOUND' ? { sideEffectFree: true } : {}),
  traceId: 'review-trace',
});
export async function intercept(page, f, result) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const input = request.postData() ? request.postDataJSON() : undefined;
    if (method === 'GET') f.reads.push(path);
    else f.writes.push({ method, path, input });
    const fail = (status, code, message) =>
      route.fulfill({ status, json: apiError(code, message) });
    if (f.hold?.includes(path) || (method === 'POST' && f.holdPost?.includes(path)))
      await f.delay(path);
    if (f.failPaths?.includes(path)) return fail(500, 'NETWORK_ERROR', '网络请求失败。');
    if (path === '/api/system/diagnose') {
      if (f.holdDiagnose) await f.delay('diagnose');
      const preset =
        f.presetMode === 'registry'
          ? {
              status: 'fail',
              step: 'registry',
              headline: '镜像下载源里找不到这张镜像',
              detailText: '下载源返回 404',
              errorCode: 'PRESET_IMAGE_NOT_IN_REGISTRY',
              command: 'docker push ghcr.io/agent-infra/sandbox:latest',
            }
          : {
              status: f.presetMode === 'stage' ? 'info' : 'ok',
              step: 'staged',
              headline: f.presetMode === 'stage' ? '还没有下载到本机' : '预制镜像已就绪',
              ...(f.presetMode === 'stage'
                ? {
                    detail: {
                      provision: {
                        provisionable: true,
                        from: image,
                        to: '本机镜像库',
                        sizeBytes: 320 * 1024 ** 2,
                        why: '第一个任务之前先把镜像下载到本机。',
                      },
                    },
                  }
                : {}),
            };
      const frames = [
        {
          event: 'start',
          checks: [
            { id: 'outbound-network', label: '联网检查' },
            { id: 'preset-image', label: '预制镜像' },
          ],
          timeoutMs: 10000,
        },
        {
          event: 'check',
          id: 'outbound-network',
          label: '联网检查',
          status: f.networkMode === 'ok' ? 'ok' : 'warn',
          headline: '联网检查完成',
          durationMs: 170,
          detail: { results: connectivity(f.networkMode) },
        },
        { event: 'check', id: 'preset-image', label: '预制镜像', durationMs: 150, ...preset },
        { event: 'done', okCount: 2, infoCount: 0, warnCount: 0, failCount: 0, totalMs: 320 },
      ];
      return route.fulfill({
        contentType: 'text/event-stream',
        body: frames
          .map((frame) => `event: ${frame.event}\ndata: ${JSON.stringify(frame)}\n\n`)
          .join(''),
      });
    }
    if (method === 'GET') {
      let json = [];
      if (path === '/api/system/init-status') json = f.init;
      else if (path === '/api/health') json = { status: 'ok' };
      else if (path === '/api/projects') json = f.projects;
      else if (/\/projects\/[^/]+\/branches$/.test(path)) json = ['main', 'feat/login-refresh'];
      else if (/\/projects\/[^/]+\/deletion-preview$/.test(path)) {
        const id = path.split('/')[3];
        const tasks = f.tasks.filter((t) => t.projectId === id);
        json = {
          activeTasks: tasks
            .filter((t) => !['stopped', 'failed', 'destroyed'].includes(t.status))
            .map(({ id, name }) => ({ id, name })),
          retainedVolumeCount: f.retained.filter((v) => v.projectId === id).length,
          automationCount: 1,
          automationRunCount: 3,
          taskCount: tasks.length,
        };
      } else if (/\/projects\/[^/]+\/automations$/.test(path)) json = f.rules ?? [];
      else if (path === '/api/automations/attention') json = f.attention ?? [];
      else if (path === '/api/providers') json = [f.provider];
      else if (path === '/api/runtimes') json = f.runtimes;
      else if (path === '/api/images') json = f.images;
      else if (path === '/api/sandboxes')
        json = url.searchParams.has('projectId')
          ? f.tasks.filter((t) => t.projectId === url.searchParams.get('projectId'))
          : f.tasks;
      else if (/\/sandboxes\/[^/]+\/tasks$/.test(path)) json = [f.agentTask];
      else if (/\/sandboxes\/[^/]+$/.test(path)) {
        json = f.tasks.find((t) => t.id === path.split('/').at(-1));
        if (!json) return fail(404, 'NOT_FOUND', '任务不存在');
      } else if (path === '/api/retained-volumes')
        json = url.searchParams.has('projectId')
          ? f.retained.filter((v) => v.projectId === url.searchParams.get('projectId'))
          : f.retained;
      else if (/\/retained-volumes\/[^/]+\/archive$/.test(path))
        return route.fulfill({
          contentType: 'application/x-tar',
          headers: { 'content-length': '7' },
          body: 'fixture',
        });
      else if (path === '/api/system/resources') json = f.resources;
      else if (path === '/api/system/settings')
        json = {
          initialized: f.init.initialized,
          proxyConfig: {},
          accessPasscodeEnabled: false,
          version: { platform: '0.2.4', node: '22' },
        };
      else if (path === '/api/system/providers')
        json = {
          providers: [],
          runtimes: [],
          imageSpecs: [],
          healthWindowMs: 3600000,
          healthWarnRate: 0.2,
          healthErrorRate: 0.5,
        };
      else if (path === '/api/system/audit') json = { items: [], hasMore: false };
      else if (path === '/api/system/version')
        json = { version: '0.2.4', commit: 'review-fixture', builtAt: NOW };
      return route.fulfill({ json });
    }
    if (path === '/api/sandboxes' && method === 'POST') {
      if (f.launchError)
        return fail(
          f.launchError === 'RESOURCE_EXHAUSTED' ? 429 : 400,
          f.launchError,
          '门口拒绝：本次请求未创建任何任务',
        );
      const created = task('t-created', '修一下首页加载慢', {
        projectId: input.projectId,
        runtime: input.runtime,
        status: 'creating',
        hasRun: false,
      });
      f.tasks.unshift(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (path === '/api/projects' && method === 'POST') {
      if (f.createError) return fail(409, f.createError, '项目名已存在，请换一个名称。');
      const created = project('p-created', input.name, {
        ...input,
        cloneStatus: input.sourceType === 'git' ? 'cloning' : 'ready',
      });
      f.projects.push(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (/\/projects\/[^/]+\/(sync|cancel-clone|retry-clone|convert-to-empty)$/.test(path)) {
      const row = f.projects.find((p) => p.id === path.split('/')[3]);
      const action = path.split('/').at(-1);
      if (!row) return fail(404, 'NOT_FOUND', `Fixture project missing: ${path}`);
      if (action === 'sync' && f.syncError)
        return fail(403, 'CLONE_FAILED_PERMISSION', '远端拒绝了这次访问');
      Object.assign(
        row,
        action === 'sync'
          ? { updatedAt: NOW, baselineSizeBytes: 46 * 1024 ** 2 }
          : action === 'convert-to-empty'
            ? {
                cloneStatus: 'ready',
                sourceType: 'empty',
                cloneErrorCode: null,
                repoUrl: null,
                repoBranch: null,
              }
            : action === 'cancel-clone'
              ? { cloneStatus: 'failed', cloneErrorCode: 'INTERRUPTED' }
              : { cloneStatus: 'cloning', cloneErrorCode: null },
      );
      if (action === 'cancel-clone')
        f.emit({
          event: 'project.clone_progress',
          projectId: row.id,
          phase: 'failed',
          errorCode: 'INTERRUPTED',
        });
      return route.fulfill({ json: row });
    }
    if (method === 'DELETE' && /^\/api\/projects\/[^/]+$/.test(path)) {
      if (f.deleteError) return fail(500, 'NETWORK_ERROR', '网络不通');
      f.projects = f.projects.filter((p) => p.id !== path.split('/')[3]);
      return route.fulfill({ status: 204 });
    }
    if (/\/sandboxes\/[^/]+\/(stop|start)$/.test(path)) {
      const row = f.tasks.find((t) => t.id === path.split('/')[3]);
      Object.assign(row, { status: path.endsWith('/stop') ? 'stopped' : 'starting' });
      return route.fulfill({ json: row });
    }
    if (method === 'DELETE' && /^\/api\/sandboxes\/[^/]+$/.test(path)) {
      if (f.holdDeleteTask) await f.delay('task-delete');
      f.tasks = f.tasks.filter((t) => t.id !== path.split('/')[3]);
      return route.fulfill({ status: 204 });
    }
    if (method === 'DELETE' && path.startsWith('/api/retained-volumes/')) {
      f.retained = f.retained.filter((v) => v.id !== path.split('/').at(-1));
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/cancel') && path.includes('/tasks/'))
      return route.fulfill({ status: 202, json: f.agentTask });
    if (path.includes('/runtimes/') && path.endsWith('/tasks'))
      return route.fulfill({ status: 202, json: { ...f.agentTask, id: 'second-run' } });
    if (path === '/api/system/settings' && method === 'PUT') {
      if (f.proxyError) return fail(408, 'TIMEOUT', '请求超时');
      return route.fulfill({
        json: {
          initialized: false,
          proxyConfig: input.proxyConfig,
          accessPasscodeEnabled: false,
          version: { platform: '0.2.4', node: '22' },
        },
      });
    }
    if (path === '/api/system/init') {
      if (f.initError)
        return fail(
          500,
          'INTERNAL_ERROR',
          '写入失败：数据目录只读（/srv/agent-platform/data）。请检查挂载权限后重试。',
        );
      f.init.initialized = true;
      return route.fulfill({ status: 201, json: f.init });
    }
    if (path.includes('/images/') && path.endsWith('/stage'))
      return route.fulfill({ status: 202, json: { jobId: 'stage-job' } });
    result.unexpected.push(`${method} ${path}`);
    return fail(405, 'REVIEW_ONLY', '没有此写入夹具');
  });
  await page.routeWebSocket(/socket\.io/, (socket) => {
    f.sockets.push(socket);
    socket.send(
      `0${JSON.stringify({ sid: `fixture-${f.sockets.length}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000 })}`,
    );
    socket.onMessage((raw) => {
      const message = String(raw);
      if (message === '2') {
        socket.send('3');
        return;
      }
      if (message.startsWith('40/')) {
        const namespace = message.slice(2).split(',')[0];
        f.namespaces.push(namespace);
        socket.send(`40${namespace},${JSON.stringify({ sid: 'review-session' })}`);
        if (namespace === '/events') f.eventSockets.push(socket);
        if (namespace === '/tasks') f.taskSockets.push(socket);
        if (namespace === '/terminal') {
          f.terminalSockets.push(socket);
          socket.send(
            `42/terminal,${JSON.stringify(['frame', { type: 'session', socketSessionKey: 'review-session' }])}`,
          );
          socket.send(
            `42/terminal,${JSON.stringify(['frame', { type: 'shells', shells: [{ shellId: 'fixture-shell' }] }])}`,
          );
          socket.send(
            `42/terminal,${JSON.stringify(['frame', { type: 'data', data: 'Codex · 已保留的最后一屏输出\r\n正在整理任务…\r\n' }])}`,
          );
        }
        if (f.disconnectNamespace === namespace) setTimeout(() => socket.close(), 80);
      }
      if (message.startsWith('42/tasks,')) {
        const [, input] = JSON.parse(message.slice('42/tasks,'.length));
        if (input.type === 'subscribe') {
          const frames = [
            {
              type: 'event',
              taskId: input.taskId,
              seq: 1,
              event: { type: 'session-started', timestamp: NOW, data: { ref: '0199a6c3-4f2e' } },
            },
            {
              type: 'event',
              taskId: input.taskId,
              seq: 2,
              event: {
                type: 'agent-message',
                timestamp: NOW,
                data: { text: '我会先检查项目，再整理发布说明。' },
              },
            },
            {
              type: 'event',
              taskId: input.taskId,
              seq: 3,
              event: {
                type: 'tool-call',
                timestamp: NOW,
                data: { id: 'tool-1', name: 'shell', status: 'started', input: 'pnpm test' },
              },
            },
            {
              type: 'event',
              taskId: input.taskId,
              seq: 4,
              event: {
                type: 'tool-call',
                timestamp: NOW,
                data: {
                  id: 'tool-1',
                  name: 'shell',
                  status: 'completed',
                  output: '测试通过',
                  exitCode: 0,
                },
              },
            },
            {
              type: 'event',
              taskId: input.taskId,
              seq: 5,
              event: {
                type: 'tool-call',
                timestamp: NOW,
                data: { id: 'tool-2', name: 'shell', status: 'started', input: 'pnpm build' },
              },
            },
            {
              type: 'event',
              taskId: input.taskId,
              seq: 6,
              event: { type: 'stdout-chunk', timestamp: NOW, data: { text: '任务执行结束' } },
            },
            { type: 'caught_up', taskId: input.taskId, firstSeq: 1, seq: 6 },
          ];
          for (const frame of frames) socket.send(`42/tasks,${JSON.stringify(['frame', frame])}`);
          if (f.agentOutcome)
            socket.send(
              `42/tasks,${JSON.stringify(['frame', { type: 'exit', taskId: input.taskId, status: 'failed', exitCode: 1 }])}`,
            );
        }
      }
      if (message.startsWith('42/terminal,')) {
        const [, input] = JSON.parse(message.slice('42/terminal,'.length));
        if (input.type === 'resize')
          socket.send(
            `42/terminal,${JSON.stringify(['frame', { type: 'data', data: 'Codex · 已保留的最后一屏输出\r\n正在整理任务…\r\n' }])}`,
          );
      }
    });
  });
}
export function assertNoRealWrites(f, result) {
  assert.deepEqual(result.unexpected, [], 'Every mutation must have an explicit fixture');
  assert.ok(f.writes.every((row) => row.path.startsWith('/api/')));
}
