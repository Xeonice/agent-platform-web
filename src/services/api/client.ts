// openapi-fetch 实例（07 §2）：services 是唯一允许读 API 地址 env 与发 fetch 的层（07 §3 规则 5）。
import createClient from 'openapi-fetch';
import type { paths } from '@/types/generated/openapi';

/**
 * 后端 REST 基址（origin，不含 /api）；仅此层读取（noPropertyAccessFromIndexSignature 要求 env 用下标访问）。
 * 后端 NestJS `setGlobalPrefix('api')`，故生成的 openapi.json 路径键已自带 `/api` 前缀（如 `/api/health`），
 * baseUrl 只放 origin，避免与路径里的前缀重复。
 *
 * ⚠️ **兜底是空串 —— 空串就是「同源相对路径」，而那是唯一在真浏览器里跑得通的默认。**
 * 后端没有 CORS（preflight 404、响应无 `Access-Control-*`），任何跨源 origin 都会被浏览器
 * 拦下，连请求都发不出去；`/api/*` 由 `next.config.mjs` 的 rewrites 转给后端（见那里的长注释）。
 * 兜底值曾经是 `http://localhost:3001`，于是**没配 env 的人拿到的是一条必然失败的默认路**
 * ——「默认值的作用是让『没配』这件事被看见」在这里正好反了：它让没配**看起来像配好了**。
 *
 * ⚠️ 测试与 Storybook **不跑在 Next 下**，没有 rewrites，而 node 的 `fetch` 不接受相对路径。
 * 它们由 `vitest.setup.ts` 显式把这个 env 设成绝对地址，让 MSW 有个确定的 origin 可拦。
 */
export const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';

/**
 * 全站唯一的 typed API client。所有 *.service.ts 经此调用，拿到的路径/参数/响应
 * 均来自生成的 openapi.d.ts（改后端契约 → 重新 generate:api → 这里立刻编译期报红）。
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  // 携带 HttpOnly `ap_session` cookie（口令门 11 §3.1）：跨源请求须显式带凭据，
  // 否则启用 ACCESS_PASSCODE 后 REST 会全部 401。cookie 由后端 set、前端不读（HttpOnly）。
  credentials: 'include',
  // 惰性解析全局 fetch（调用时读取），使 MSW（测试/dev）在 client 创建之后打的补丁也能生效。
  fetch: (request) => fetch(request),
});

export type ApiClient = typeof apiClient;
