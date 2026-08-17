// @vitest-environment node
// 项目 REST 集成测试（node 环境，MSW/undici 拦截最稳，对齐 sandbox.service.test）。
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import {
  listProjects,
  createProject,
  retryClone,
  convertToEmpty,
} from '@/services/api/project.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('project.service（10 §7）', () => {
  it('GET /api/projects → 生成类型约束的 ProjectResponseDto[]（cloneStatus 词汇含 ready）', async () => {
    const list = await listProjects();
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toMatchObject({ id: expect.any(String), taskCount: expect.any(Number) });
    expect(['cloning', 'ready', 'failed']).toContain(list[0]?.cloneStatus);
    // DTO 不含 repoUrl（产品红线）
    expect(list[0]).not.toHaveProperty('repoUrl');
  });

  it('POST /api/projects（git）→ 202 ProjectDto cloning，且请求带 credentials + 不回读 repoUrl', async () => {
    let seenBody: unknown;
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.post(`${API_BASE}/api/projects`, async ({ request }) => {
        seenBody = await request.json();
        seenCredentials = request.credentials;
        return HttpResponse.json(
          {
            id: 'p-new',
            name: 'acme',
            sourceType: 'git',
            cloneStatus: 'cloning',
            cloneErrorCode: null,
            taskCount: 0,
            createdAt: new Date().toISOString(),
          },
          { status: 202 },
        );
      }),
    );

    const project = await createProject({
      name: 'acme',
      sourceType: 'git',
      repoUrl: 'https://github.com/acme/web.git',
    });
    expect(project.cloneStatus).toBe('cloning');
    expect(project).not.toHaveProperty('repoUrl');
    expect(seenCredentials).toBe('include');
    // repoUrl 只在请求体（创建用），不在响应回读
    expect(seenBody).toMatchObject({ repoUrl: 'https://github.com/acme/web.git' });
  });

  it('convert-to-empty 非 failed 态 → 409 抛 ApiErrorException', async () => {
    server.use(
      http.post(`${API_BASE}/api/projects/:id/convert-to-empty`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '仅失败态可转为空项目', retryable: false },
          { status: 409 },
        ),
      ),
    );
    await expect(convertToEmpty('p1')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('retry-clone 401 → 抛 ApiErrorException（承载信封，供解锁门）', async () => {
    server.use(
      http.post(`${API_BASE}/api/projects/:id/retry-clone`, () =>
        HttpResponse.json(
          { code: 'UNAUTHORIZED', message: '需要访问口令', retryable: false },
          { status: 401 },
        ),
      ),
    );
    await expect(retryClone('p1')).rejects.toMatchObject({ httpStatus: 401 });
  });
});
