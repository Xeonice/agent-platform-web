// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
import { http, HttpResponse } from 'msw';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

export const handlers = [
  // liveness probe：真实契约 GET /api/health 无响应体 schema，getHealth 只读 response.ok/status。
  // 返回空 JSON（openapi-fetch 默认按 json 解析，须是合法 JSON），body 内容不被读取。
  http.get(`${API_BASE}/api/health`, () => HttpResponse.json({}, { status: 200 })),
];
