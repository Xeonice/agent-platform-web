// 无头 Task REST 层（12 §3.2 services）。openapi 已同步 ⇒ 形状由生成类型在编译期保证，
// 本文件只验**运行时**那部分：路径拼装（含 encode）、请求体透传、错误信封归一化、二进制流取法。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  cancelAgentTask,
  fetchTaskArtifact,
  listAgentTasks,
  runAgentTask,
} from '@/services/api/task.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** AgentTaskDto fixture（POST/cancel/list 三处响应同形）。 */
function taskDto(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-9',
    sandboxId: 'sb-1',
    runtime: 'codex',
    status: 'running',
    timeoutMinutes: 120,
    lastSeq: 0,
    artifacts: [],
    startedAt: '2026-08-22T00:00:00Z',
    ...overrides,
  };
}

describe('runAgentTask', () => {
  it('POST 到 /api/sandboxes/{id}/runtimes/{rt}/tasks，请求体原样发出，202 回**整个 DTO**', async () => {
    let path = '';
    let body: unknown;
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/runtimes/:rt/tasks`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json(taskDto(), { status: 202 });
      }),
    );

    const result = await runAgentTask('sb 1', 'claude-code', {
      prompt: '跑一轮',
      timeoutMinutes: 30,
      extraArgs: ['--verbose'],
    });

    // 202 回的是完整 AgentTaskDto（不是 { taskId }）——id 从 DTO 上取。
    expect(result.id).toBe('task-9');
    expect(result.status).toBe('running');
    expect(result.timeoutMinutes).toBe(120);
    // id/rt 都经 encodeURIComponent（沙箱 id 里出现特殊字符不会拼坏路径）。
    expect(path).toBe('/api/sandboxes/sb%201/runtimes/claude-code/tasks');
    expect(body).toEqual({ prompt: '跑一轮', timeoutMinutes: 30, extraArgs: ['--verbose'] });
  });

  it('非 2xx ⇒ 抛 ApiErrorException（信封 + HTTP 状态原样带出）', async () => {
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/runtimes/:rt/tasks`, () =>
        HttpResponse.json(
          { code: 'UNSUPPORTED_CAPABILITY', message: '不支持无头任务', retryable: false },
          { status: 409 },
        ),
      ),
    );

    await expect(runAgentTask('sb-1', 'codex', { prompt: 'x' })).rejects.toMatchObject({
      name: 'ApiErrorException',
      httpStatus: 409,
      envelope: { code: 'UNSUPPORTED_CAPABILITY' },
    });
  });
});

describe('listAgentTasks', () => {
  it('GET /api/sandboxes/{id}/tasks → 数组原样返回（后端按 startedAt 倒序，前端不再排一遍）', async () => {
    let path = '';
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json([
          taskDto({ id: 'newest', status: 'running' }),
          taskDto({ id: 'older', status: 'succeeded', exitCode: 0 }),
        ]);
      }),
    );

    const tasks = await listAgentTasks('sb-1');
    expect(tasks.map((t) => t.id)).toEqual(['newest', 'older']);
    expect(path).toBe('/api/sandboxes/sb-1/tasks');
  });

  it('exitCode / sessionRef 可缺席（终态才有；timeoutMinutes 契约里必填）', async () => {
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks`, () =>
        HttpResponse.json([
          {
            id: 'task-1',
            sandboxId: 'sb-1',
            runtime: 'codex',
            status: 'killed',
            timeoutMinutes: 30,
            lastSeq: 12,
            artifacts: [{ name: 'a.txt', size: 3, modifiedAt: '2026-08-22T00:00:00Z' }],
            startedAt: '2026-08-22T00:00:00Z',
          },
        ]),
      ),
    );

    const [task] = await listAgentTasks('sb-1');
    expect(task?.status).toBe('killed');
    expect(task?.exitCode).toBeUndefined();
    expect(task?.timeoutMinutes).toBe(30);
    expect(task?.artifacts).toHaveLength(1);
  });
});

describe('cancelAgentTask', () => {
  it('POST 到 .../cancel（202 回 DTO；真正的终态等 WS exit 帧）', async () => {
    let method = '';
    let path = '';
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, ({ request }) => {
        method = request.method;
        path = new URL(request.url).pathname;
        return HttpResponse.json(taskDto({ status: 'running' }), { status: 202 });
      }),
    );

    const task = await cancelAgentTask('sb-1', 'task-9');
    expect(method).toBe('POST');
    expect(path).toBe('/api/sandboxes/sb-1/tasks/task-9/cancel');
    expect(task.id).toBe('task-9');
  });

  it('409（任务已结束）⇒ ApiErrorException，供上层渲染人话', async () => {
    server.use(
      http.post(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/cancel`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '任务已结束', retryable: false },
          { status: 409 },
        ),
      ),
    );
    await expect(cancelAgentTask('sb-1', 'task-9')).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('fetchTaskArtifact', () => {
  it('取**原始 Response**（产物名经 encode，走同一套 cookie 鉴权而不是裸 href 直链）', async () => {
    let path = '';
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.text('hello');
      }),
    );

    const response = await fetchTaskArtifact('sb-1', 'task-1', 'reports/summary.md');
    expect(await response.text()).toBe('hello');
    expect(path).toBe('/api/sandboxes/sb-1/tasks/task-1/artifacts/reports%2Fsummary.md');
  });

  it('⚠️ **不在本层 .blob()**：body 流原样交出去，hook 才能流式落盘而不是全量入内存', async () => {
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, () =>
        HttpResponse.text('chunky'),
      ),
    );

    const response = await fetchTaskArtifact('sb-1', 'task-1', 'big.bin');

    // 还没被消费过 ⇒ 调用方拿到的是一条可读流，而不是一坨已经躺在堆里的字节。
    expect(response.bodyUsed).toBe(false);
    expect(response.body).not.toBeNull();
  });

  it('content-length 原样透出（后端带就有，不带也不报错——进度是可选信息）', async () => {
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, () =>
        HttpResponse.text('12345', { headers: { 'content-length': '5' } }),
      ),
    );

    const response = await fetchTaskArtifact('sb-1', 'task-1', 'a.txt');
    expect(response.headers.get('content-length')).toBe('5');
  });

  it('非 2xx ⇒ 抛 ApiErrorException（下载失败要能显示人话，不是静默空文件）', async () => {
    server.use(
      http.get(`${API_BASE}/api/sandboxes/:id/tasks/:taskId/artifacts/:name`, () =>
        HttpResponse.json(
          { code: 'NOT_FOUND', message: '产物已被清理', retryable: false },
          { status: 404 },
        ),
      ),
    );

    await expect(fetchTaskArtifact('sb-1', 'task-1', 'a.txt')).rejects.toBeInstanceOf(
      ApiErrorException,
    );
  });
});
