// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
import { http, HttpResponse } from 'msw';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

export const handlers = [
  // liveness probe：真实契约 GET /api/health 无响应体 schema，getHealth 只读 response.ok/status。
  // 返回空 JSON（openapi-fetch 默认按 json 解析，须是合法 JSON），body 内容不被读取。
  http.get(`${API_BASE}/api/health`, () => HttpResponse.json({}, { status: 200 })),

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
