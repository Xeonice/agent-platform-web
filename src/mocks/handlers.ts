// MSW REST handlers（供 Storybook / 单测 / dev 复用，12 §2.2）。
import { http, HttpResponse } from 'msw';

const API_BASE = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

export const handlers = [
  http.get(`${API_BASE}/api/health`, () =>
    HttpResponse.json({ status: 'ok', version: '0.0.0-mock', schemaHash: 'mock-hash' }),
  ),
];
