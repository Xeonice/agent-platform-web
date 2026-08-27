import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 仓库外层存在其它 lockfile，显式锁定本仓为 tracing root，消除 Next 的多 lockfile 警告。
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  reactStrictMode: true,
  typescript: {
    // 类型检查由独立 `pnpm typecheck` / CI 的 static-checks 门禁负责，不在 build 内重复
    ignoreBuildErrors: false,
  },
  /**
   * ★ 把 `/api/*` 转给后端，让浏览器**只跟 Next 同源通信**。
   *
   * ── 它修的是什么 ─────────────────────────────────────────────────────────
   * 后端**完全没有 CORS**：带 `Origin` 的响应里一个 `Access-Control-*` 头都没有，
   * preflight `OPTIONS /api/projects` 直接 404。而 `ap_session` 是 HttpOnly cookie，
   * 跨源必须 `credentials: 'include'` + 精确 origin 白名单——两样后端都没有。
   * 于是「前端 :3000 直连后端 :3001」这条路**在真浏览器里从来跑不通**，
   * 表现是建项目时一句「网络错误，请稍后重试」（fetch 被浏览器拦下，请求都没发出去）。
   *
   * ⚠️ 而 773 条单测全绿：MSW 替身让前端与它自己的替身完全自洽，
   * **真浏览器打真后端这条路没人走过**（LIVE-RUN-FINDINGS 共性 2 的又一例）。
   * 上一轮撞见时是拿一个临时 `proxy.mjs` 糊过去的——那是脚手架，进程一没就复发。
   *
   * ── 为什么是这条路而不是后端开 CORS ────────────────────────────────────
   * 后端一行不改，继续 loopback-only、不放开任何跨源（shared/11 §3）。
   * 开 CORS 等于允许指定的本机页面直接打后端，那是**放宽**攻击面来换开发便利。
   *
   * ⚠️ **WebSocket 不走这里**：rewrites 只处理 HTTP，不代理 upgrade，所以
   * `NEXT_PUBLIC_WS_BASE_URL` 仍是直连后端的绝对地址。
   *
   * ⚠️ 但「不受同源策略约束」**不等于**「随便填哪个 host 都行**：`ap_session` 是
   * host-only cookie（`Set-Cookie` 不带 `Domain`），而 **cookie 只认 host、不区分端口**。
   * 所以 WS 的 host 必须与浏览器地址栏的 host **逐字一致**，端口可以不同：
   *   浏览器在 `localhost:3200` → WS 必须写 `ws://localhost:3100`；
   *   写成 `ws://127.0.0.1:3100` 就是**另一个 host**，cookie 带不过去，
   *   握手被 `EventsGateway` 拒（日志：`events handshake rejected: missing/invalid
   *   access passcode`），然后前端指数退避无限重连。
   * `localhost` 与 `127.0.0.1` 解析到同一个地址，但对 cookie 而言是两个 host——
   * 这一条实测踩过，不是理论推演。
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'}/api/:path*`,
      },
    ];
  },
  eslint: {
    // Lint 由独立 `pnpm lint`（--max-warnings=0）门禁负责，不在 build 内重复跑
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
