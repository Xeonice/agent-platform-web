// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
import { http, HttpResponse } from 'msw';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/** 生成一个符合 ProjectResponseDto 必填形状的对象（id/name/sourceType/cloneStatus/cloneErrorCode/taskCount/createdAt）。 */
function projectDto(overrides: {
  id: string;
  name: string;
  sourceType?: 'git' | 'empty';
  cloneStatus: 'cloning' | 'ready' | 'failed';
  taskCount?: number;
}) {
  return {
    id: overrides.id,
    name: overrides.name,
    sourceType: overrides.sourceType ?? 'empty',
    cloneStatus: overrides.cloneStatus,
    cloneErrorCode: null,
    taskCount: overrides.taskCount ?? 0,
    createdAt: new Date().toISOString(),
  };
}

export const handlers = [
  // liveness probe：真实契约 GET /api/health 无响应体 schema，getHealth 只读 response.ok/status。
  // 返回空 JSON（openapi-fetch 默认按 json 解析，须是合法 JSON），body 内容不被读取。
  http.get(`${API_BASE}/api/health`, () => HttpResponse.json({}, { status: 200 })),

  // 口令解锁（11 §3.1）：dev 无口令门，直接 204 成功（真实 cookie 由后端 set）。
  http.post(`${API_BASE}/api/access/unlock`, () => new HttpResponse(null, { status: 204 })),

  // 项目列表（10 §7 ProjectResponseDto）：dev 打通「项目树 → 建沙箱」。DTO 不含 repoUrl。
  http.get(`${API_BASE}/api/projects`, () =>
    HttpResponse.json([projectDto({ id: 'proj-demo', name: '示例项目', cloneStatus: 'ready' })], {
      status: 200,
    }),
  ),

  // 新建项目（202 异步）：git → cloning，empty → ready（dev 无 /events，故 empty 秒就绪最省事）。
  http.post(`${API_BASE}/api/projects`, async ({ request }) => {
    const body: unknown = await request.json().catch(() => ({}));
    const sourceType =
      typeof body === 'object' && body !== null && 'sourceType' in body ? body.sourceType : 'empty';
    const name =
      typeof body === 'object' && body !== null && 'name' in body ? String(body.name) : '新项目';
    const isGit = sourceType === 'git';
    return HttpResponse.json(
      projectDto({
        id: `proj-${String(Date.now())}`,
        name,
        sourceType: isGit ? 'git' : 'empty',
        cloneStatus: isGit ? 'cloning' : 'ready',
      }),
      { status: 202 },
    );
  }),

  // retry-clone / convert-to-empty（仅 failed 态；dev 简化为成功）。
  http.post(`${API_BASE}/api/projects/:id/retry-clone`, ({ params }) =>
    HttpResponse.json(
      projectDto({
        id: String(params['id']),
        name: '重试克隆',
        sourceType: 'git',
        cloneStatus: 'cloning',
      }),
      { status: 202 },
    ),
  ),
  http.post(`${API_BASE}/api/projects/:id/convert-to-empty`, ({ params }) =>
    HttpResponse.json(
      projectDto({ id: String(params['id']), name: '转为空项目', cloneStatus: 'ready' }),
      {
        status: 200,
      },
    ),
  ),
  http.delete(`${API_BASE}/api/projects/:id`, () => new HttpResponse(null, { status: 204 })),

  // S1 建沙箱：回一个符合 SandboxResponseDto 形状的 201（dev 打通"新建沙箱→终端"链路）。
  http.post(`${API_BASE}/api/sandboxes`, () =>
    HttpResponse.json(
      {
        id: `mock-${String(Date.now())}`,
        projectId: 'default',
        runtime: 'shell',
        status: 'running',
        headless: false,
        timeoutMinutes: 120,
        idleTimeoutSec: 1800,
        waitingInput: false,
        version: 1,
      },
      { status: 201 },
    ),
  ),
];
