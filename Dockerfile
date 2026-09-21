# 前端容器化产物（docs/shared/11 §1 讲的部署形态里缺的那一块）。
# `docker compose up` 目前只起得来 api / docker-proxy / sandbox 三个 service——
# 127.0.0.1:3000 上只有 Swagger，初始化向导、镜像准备、订阅配置、工作台全部
# 没有界面。这个 Dockerfile 补的就是「web 这一侧被 compose 引用的东西」；
# service 定义本身在主仓根目录的 docker-compose.yml，不在这里。
#
# 两点先说清楚（呼应 api/Dockerfile 开头那两点的写法）：
#
#  ① **`next build` 会把 `rewrites()` 的解析结果冻进 `.next/routes-manifest.json`
#     ——这是构建期产物，`next start` / standalone `server.js` 运行时只读这份
#     manifest，不会重新执行 `next.config.mjs` 里的 `rewrites()`。**
#     本仓 `next.config.mjs` 的 `rewrites()` 读 `process.env.API_ORIGIN` 来决定
#     `/api/*` 与 `/socket.io/*` 转发去哪——这意味着 `API_ORIGIN` 必须在
#     **`pnpm build` 之前**（也就是这个 Dockerfile 的 builder 阶段）就确定,
#     `docker run -e API_ORIGIN=...` 在运行时设它**不会生效**（已用本机现有的
#     `.next/routes-manifest.json` 实测验证：`.env.local` 里 `API_ORIGIN=
#     http://127.0.0.1:3100` 被原样烤进了 manifest 的 destination 字段）。
#     ⇒ 下面用 ARG（而不是运行期 ENV）接住它,默认值对齐 compose 里 api 的
#     service 名 + 容器内端口。主仓 compose 若要换后端地址,得连这层镜像一起
#     重新 build,不能只改 `environment:`。
#
#  ② **`NEXT_PUBLIC_*` 前缀的变量会被 Next 在构建期原样内联进浏览器产物**——
#     哪怕代码里用的是 `process.env['NEXT_PUBLIC_WS_BASE_URL']` 这种下标写法
#     （也已实测确认：本机 `.next/static/chunks/app/page.js` 里能直接找到字面量
#     `ws://localhost:3100`）。这两个变量因此**不能**做成「部署时才知道」的
#     运行期配置——一旦真需要它，就已经错了方向。
#     ⇒ 这里**刻意不**把 `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_WS_BASE_URL`
#     声明成 ARG，就让它们落成源码里 `?? ''` 的空串默认值。空串 = 同源，
#     由 `next.config.mjs` 的 rewrites 转发——HTTP 和 WebSocket（socket.io）
#     都走这条路，且已注释在 next.config.mjs 里实测过 polling/websocket 两种
#     transport 都通。这样浏览器连的永远是「地址栏那个 host」，跟外部访问者用
#     什么域名/端口完全无关，不需要为每台机器单独重新 build。
#     ⛔ 别为了「让前端配置更灵活」把这两个 NEXT_PUBLIC_* 加回 ARG/build-arg——
#     那等于把「运行时才能确定的值」又焊回了构建期，会重新踩上面这条坑。

# ---------- deps ----------
# 单独一层只装依赖，让「改源码不改依赖」时这层能被 Docker 缓存命中。
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# 版本钉死到 package.json 的 packageManager 字段（9.15.0），不用 corepack 默认解析到的
# 「最新 9.x」——否则本地/CI/镜像三处的 pnpm 版本可能对不上，lockfile 解析行为随之漂移。
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# 只拷清单、锁文件与 patches/：依赖没变时这一层直接复用缓存，源码改动不触发重新
# install。patches/ 必须跟着来——package.json 的 `pnpm.patchedDependencies` 指向
# `patches/@storybook__addon-vitest@9.1.20.patch`，缺这个文件 `pnpm install` 直接
# ENOENT 报错（已实测踩过一次）。
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile

# ---------- builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 见文件头 ①：必须在 build 之前定,构建后不能再改。默认值对应主仓 compose 里
# 后端 service 名 `api` + 容器内监听端口 3000（api/Dockerfile 里 `EXPOSE 3000`）。
ARG API_ORIGIN=http://api:3000
ENV API_ORIGIN=$API_ORIGIN

# `next.config.mjs` 里 `typescript.ignoreBuildErrors: false`，`next build` 会话着
# tsc 一起做类型检查——这里没有单独再跑一次 `pnpm typecheck`，避免重复类型检查
# 白白多花一次构建时间。
RUN pnpm build

# ---------- runtime ----------
# standalone 输出（next.config.mjs 的 `output: 'standalone'`）只带被 next 追踪到的
# 依赖子集，用不着把 builder 阶段的整个 node_modules 和源码搬进来——运行镜像因此
# 能瘦下来。
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# ⚠️ 这里用非 root 是刻意的，跟 api/Dockerfile 用 root 的理由并不冲突：api 用 root
# 是因为它要在宿主 bind mount 里按特定权限建目录、且是唯一持有 docker-socket-proxy
# 访问权的进程；这个容器只是个 Next 服务器，不碰宿主路径、不管理任何兄弟容器，
# 没有理由不用非 root。`node` 用户（uid 1000）是 node 官方镜像自带的，不用自己建。
USER node

# standalone 产物不含 `public/` 和 `.next/static`——这是 Next 自己的约定
# （standalone 只追踪 server 运行所需的依赖与代码，静态资源要手动搬），漏了会导致
# 图标、mockServiceWorker.js 等静态文件 404。
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# standalone 的 server.js 模板默认读 `PORT`（缺省 3000）与 `HOSTNAME`（缺省 0.0.0.0）
# 这两个环境变量决定监听地址——这里显式写出来，因为主仓 compose 要按这个端口接
# service 之间的网络（web 与本 EXPOSE 保持一致，不要在 compose 里改端口映射的容器侧）。
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
