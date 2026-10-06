import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // 仓库外层存在其它 lockfile，显式锁定本仓为 tracing root，消除 Next 的多 lockfile 警告。
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  /**
   * ★ 容器化产物用（web/Dockerfile）。`standalone` 让 `next build` 额外产出
   * `.next/standalone/server.js` —— 一个只带**被追踪到的依赖**（而非整个
   * node_modules）的最小 Node 服务器，运行镜像因此能瘦到几十 MB 依赖而不是
   * 几百 MB。
   *
   * ⚠️ 只影响构建**产出物**，不影响本地 `pnpm build` / `pnpm dev` / `pnpm start`
   * 的正常路径：`next start` 与 `next dev` 走的是 `.next/` 本体，从不读
   * `.next/standalone`；CI（`.github/workflows/ci.yml` 的 `build (next build)`）
   * 只跑 `next build` 到成功为止，同样不关心这个目录存不存在。加这一行前已
   * 核对过——不会破坏任何现有流程。
   */
  output: 'standalone',
  reactStrictMode: true,
  /**
   * ⚠️ 为 socket.io 而开，**不是**风格偏好。socket.io 的握手路径带尾斜杠
   * （`/socket.io/?EIO=4&transport=polling`），而 Next 默认会把它 **308** 到
   * 无斜杠版本。308 对 `fetch` 无害，对 WebSocket 握手是致命的：客户端不会
   * 跟着重定向再发一次 upgrade，表现为连不上、然后无限重连。
   */
  skipTrailingSlashRedirect: true,
  typescript: {
    tsconfigPath: process.env.NEXT_TSCONFIG_PATH ?? 'tsconfig.json',
    // 类型检查由独立 `pnpm typecheck` / CI 的 static-checks 门禁负责，不在 build 内重复
    ignoreBuildErrors: false,
  },
  /**
   * 本地开发与 Docker 同源模式：浏览器的 API/WS public base 留空，
   * `/api/*` 和 `/socket.io` 由 Next 转发到 API_ORIGIN。
   *
   * Vercel + 外部 API 模式：NEXT_PUBLIC_API_BASE_URL 与 NEXT_PUBLIC_WS_BASE_URL
   * 同时设为同一个 HTTPS API origin。REST、SSE、解锁与 Socket.IO 全部直接访问 API，
   * API 负责精确的 Origin 白名单与 credentialed CORS；host-only ap_session 留在 API 域。
   * 两种模式的 cookie 归属必须一致，不能只将 WS 直连、却通过 Web 域解锁。
   *
   * 三条 `/socket.io` 规则保留本地 Next 的 upgrade 转发；Vercel 的外部 API 模式
   * 使用直连 WebSocket。空 path 必须写死尾斜杠，避免 Next 吃掉 `/socket.io/` 的 `/`。
   * API_ORIGIN 是构建时生成 rewrite 的目标，NEXT_PUBLIC_* 也在构建时写入浏览器产物。
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
