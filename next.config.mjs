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
  eslint: {
    // Lint 由独立 `pnpm lint`（--max-warnings=0）门禁负责，不在 build 内重复跑
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
