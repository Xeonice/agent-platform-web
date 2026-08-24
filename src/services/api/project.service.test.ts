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
  listProjectBranches,
  syncProject,
} from '@/services/api/project.service';
import { ApiErrorException } from '@/services/api/apiError';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

describe('project.service（10 §7）', () => {
  it('GET /api/projects → 生成类型约束的 ProjectResponseDto[]（cloneStatus 词汇含 ready）', async () => {
    const list = await listProjects();
    expect(Array.isArray(list)).toBe(true);
    expect(list[0]).toMatchObject({ id: expect.any(String), taskCount: expect.any(Number) });
    expect(['cloning', 'ready', 'failed']).toContain(list[0]?.cloneStatus);
    /**
     * ⚠️ 上一版断言的是 `not.toHaveProperty('repoUrl')`（10 §7「repoUrl 不入 DTO」的产品红线）。
     * **该定案已被 F21-6 §9.1 推翻**：完整克隆之后，远端地址 / 基线体积 / 最后同步是项目
     * 只读条的内容来源。断言据此翻面 —— 保留它只会把新契约当成回归。
     */
    expect(list[0]).toHaveProperty('repoUrl');
  });

  it('POST /api/projects（git）→ 202 ProjectDto cloning，且请求带 credentials + repoBranch 可选', async () => {
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
      // `repoBranch` **契约里一直有**，本轮表单才接上（留空 = 远端默认分支，见 F21-6 §9.4）。
      repoBranch: 'develop',
    });
    expect(project.cloneStatus).toBe('cloning');
    expect(seenCredentials).toBe('include');
    expect(seenBody).toMatchObject({
      repoUrl: 'https://github.com/acme/web.git',
      repoBranch: 'develop',
    });
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

/**
 * ⏳ 两个**尚未进生成 openapi.d.ts** 的端点（走手写 fetch，与 access.service 同一先例）。
 * 手写 fetch 最容易漏掉的两件事就在这里钉死：**带凭据**（口令门 11 §3.1）与**响应形状校验**。
 */
describe('project.service · 分支列表与基线同步', () => {
  it('GET /branches → string[]，且带 credentials（口令门下不会静默 401）', async () => {
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, ({ request }) => {
        seenCredentials = request.credentials;
        return HttpResponse.json(['main', 'develop']);
      }),
    );
    await expect(listProjectBranches('p1')).resolves.toEqual(['main', 'develop']);
    expect(seenCredentials).toBe('include');
  });

  /**
   * 响应形状不对 ⇒ **当异常抛**。不做这层校验的话，后端哪天改成 `{branches:[…]}`，
   * 选择器会安静地渲染一串空选项，而没有任何一处报错 —— 那才是"用类型蒙混"。
   * 变异：把校验删掉直接返回 body ⇒ 本例变红。
   */
  it('GET /branches 响应不是 string[] ⇒ 抛 ApiErrorException（不把坏形状交出去）', async () => {
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, () =>
        HttpResponse.json({ branches: ['main'] }),
      ),
    );
    await expect(listProjectBranches('p1')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('POST /sync → 204，带 credentials；非 2xx 归一化成 ApiErrorException', async () => {
    let seenCredentials: RequestCredentials | undefined;
    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, ({ request }) => {
        seenCredentials = request.credentials;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(syncProject('p1')).resolves.toBeUndefined();
    expect(seenCredentials).toBe('include');

    server.use(
      http.post(`${API_BASE}/api/projects/:id/sync`, () =>
        HttpResponse.json(
          { code: 'INVALID_STATE', message: '项目未就绪', retryable: false },
          { status: 409 },
        ),
      ),
    );
    await expect(syncProject('p1')).rejects.toBeInstanceOf(ApiErrorException);
  });

  it('路径参数被 encode（项目 id 里的特殊字符不会拼坏 URL）', async () => {
    let seenUrl = '';
    server.use(
      http.get(`${API_BASE}/api/projects/:id/branches`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    await listProjectBranches('a/b');
    expect(seenUrl).toContain('/api/projects/a%2Fb/branches');
  });
});
