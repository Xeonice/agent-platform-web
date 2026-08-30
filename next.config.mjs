import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 仓库外层存在其它 lockfile，显式锁定本仓为 tracing root，消除 Next 的多 lockfile 警告。
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  reactStrictMode: true,
  /**
   * ⚠️ 为 socket.io 而开，**不是**风格偏好。socket.io 的握手路径带尾斜杠
   * （`/socket.io/?EIO=4&transport=polling`），而 Next 默认会把它 **308** 到
   * 无斜杠版本。308 对 `fetch` 无害，对 WebSocket 握手是致命的：客户端不会
   * 跟着重定向再发一次 upgrade，表现为连不上、然后无限重连。
   */
  skipTrailingSlashRedirect: true,
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
   * ── WebSocket 也走这里（2026-08-30 实测改） ──────────────────────────────
   * 此处**曾经**写着「rewrites 只处理 HTTP，不代理 upgrade，所以 WS 用绝对地址直连
   * 后端」。在 Next 15.5.23 上实测**不成立**：加上下面三条 `/socket.io` 规则后，
   * polling 与 websocket 两种 transport 都能经 Next 转到后端，浏览器里真终端的
   * 上下行数据流也通（从局域网 IP 打开验证，不是 localhost 巧合）。
   *
   * ⇒ `NEXT_PUBLIC_WS_BASE_URL` **留空走同源**。这消掉的不只是一行配置：
   *   · 绝对地址是**构建期**烤进 bundle 的，而它该填什么取决于**运行时**访问者用的
   *     host —— 一个构建期常量根本回答不了这个问题。烤 `ws://localhost:3100`，
   *     同事从局域网打开时它就去连**同事自己机器**的 3100。换 host = 重新 build。
   *   · `ap_session` 是 host-only cookie（`Set-Cookie` 不带 `Domain`），**只认 host、
   *     不区分端口**。同源之后 host 必然一致，这条约束自动消失 —— 此前它是靠人肉
   *     纪律维持的，填错的症状是握手被 `EventsGateway` 拒然后无限重连。
   *   · socket.io 从 `location.protocol` 推 ws/wss ⇒ https 部署自动对，而写死的
   *     `ws://` 在 https 页面下会被浏览器当 mixed content 拦掉。
   *
   * ⚠️ 三条规则不能合并成一条 `/socket.io/:path*`：`:path*` 匹配空串时，Next 拼
   * destination 会把尾斜杠**吃掉**，后端收到 `/socket.io?EIO=4…`（少一个 `/`）⇒ 404。
   * 空 path 那两条必须把尾斜杠写死在 destination 里。
   */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'}/api/:path*`,
      },
      // ⚠️ 尾斜杠写死，见上：`:path*` 匹配空串时 Next 会把它吃掉 ⇒ 后端 404。
      {
        source: '/socket.io',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'}/socket.io/`,
      },
      {
        source: '/socket.io/',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'}/socket.io/`,
      },
      {
        source: '/socket.io/:path+',
        destination: `${process.env.API_ORIGIN ?? 'http://127.0.0.1:3001'}/socket.io/:path+`,
      },
    ];
  },
  eslint: {
    // Lint 由独立 `pnpm lint`（--max-warnings=0）门禁负责，不在 build 内重复跑
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
