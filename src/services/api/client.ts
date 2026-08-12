// openapi-fetch 实例（07 §2）：services 是唯一允许读 API 地址 env 与发 fetch 的层（07 §3 规则 5）。
import createClient from 'openapi-fetch';
import type { paths } from '@/types/generated/openapi';

/** 后端 REST 基址；仅此层读取（noPropertyAccessFromIndexSignature 要求 env 用下标访问）。 */
const API_BASE_URL = process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * 全站唯一的 typed API client。所有 *.service.ts 经此调用，拿到的路径/参数/响应
 * 均来自生成的 openapi.d.ts（改后端契约 → 重新 generate:api → 这里立刻编译期报红）。
 */
export const apiClient = createClient<paths>({
  baseUrl: `${API_BASE_URL}/api`,
  // 惰性解析全局 fetch（调用时读取），使 MSW（测试/dev）在 client 创建之后打的补丁也能生效。
  fetch: (request) => fetch(request),
});

export type ApiClient = typeof apiClient;
