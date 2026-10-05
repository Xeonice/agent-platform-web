// openapi-fetch 实例（07 §2）：services 是唯一允许读 API 地址 env 与发 fetch 的层（07 §3 规则 5）。
import createClient from 'openapi-fetch';
import type { paths } from '@/types/generated/openapi';

/**
 * 后端 REST 基址（origin，不含 /api）；仅此层读取（noPropertyAccessFromIndexSignature 要求 env 用下标访问）。
 * 后端 NestJS `setGlobalPrefix('api')`，故生成的 openapi.json 路径键已自带 `/api` 前缀（如 `/api/health`），
 * baseUrl 只放 origin，避免与路径里的前缀重复。
 *
 * 空串使用同源 `/api/*`，由 next.config.mjs 的 rewrites 转发，供本地开发与 Docker 使用。
 * Vercel 前端连接独立 API 时配置 HTTPS origin，并将 NEXT_PUBLIC_WS_BASE_URL 配成同一
 * API origin，让解锁 cookie、REST/SSE 与 WebSocket 属于同一个 API host。
 * 后端必须允许前端 origin 的 credentialed CORS。NEXT_PUBLIC_* 在 build 时写入浏览器产物，
 * 调整部署环境的值后需要重新 build；单独 promote 旧产物不会替换其中的地址。
 *
 * ⚠️ 测试与 Storybook **不跑在 Next 下**，没有 rewrites，而 node 的 `fetch` 不接受相对路径。
 * 它们由 `src/acceptance/setup.ts` 显式把这个 env 设成绝对地址，让 MSW 有个确定的 origin 可拦。
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
