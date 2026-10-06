# agent-platform-web

云 Agent 管理平台前端。技术栈：**Next.js App Router (15) · TypeScript strict · TanStack Query v5 · Zustand · shadcn/ui · @xterm/xterm 5.5.x · pnpm**。

目录结构与视图/逻辑分层铁律以 [`docs/frontend/07`](../docs/frontend/07-前端目录结构与视图逻辑分离.md) 为准；本仓从第一个 commit 起即接入全套 harness 强制机制。

## 快速开始

```bash
pnpm install
pnpm generate:api        # 从 openapi.json 生成 src/types/generated/openapi.d.ts（后端权威生成物）
cp .env.example .env      # 填占位即可；.env 已 gitignore，禁止提交真实值
pnpm dev                 # http://localhost:3000（默认经 Next 同源代理连接真后端）
NEXT_PUBLIC_API_MOCK=1 pnpm dev   # 需要浏览器 mock 时才开（此前 dev 无条件起 MSW 且关不掉）
pnpm storybook           # http://localhost:6006 看全部视图的形态与交互
```

首次或 CI 首拉需 `pnpm exec msw init public/`（生成 MSW worker 文件，dev 浏览器 mock 用）。

## Vercel 前端与 Mac mini Docker API

Vercel 项目使用仓库根目录、Next.js preset、Node `22.x`、`pnpm@9.15.0`，安装命令 `pnpm install --frozen-lockfile`，构建命令 `pnpm build`，输出目录使用 Next 默认值。`ENABLE_EXPERIMENTAL_COREPACK=1` 使安装版本遵循 `packageManager`。

Production 配置：

| 环境变量                   | 值                                  |
| -------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://agent-api.douglasdong.com` |
| `NEXT_PUBLIC_WS_BASE_URL`  | `https://agent-api.douglasdong.com` |
| `API_ORIGIN`               | `https://agent-api.douglasdong.com` |
| `NEXT_PUBLIC_API_MOCK`     | `0`                                 |

Web 使用 `https://agent.douglasdong.com`。浏览器的 REST、解锁、诊断/镜像 SSE、下载与三个 Socket.IO 通道均直接连接 API；请求携带凭证，`ap_session` 为 API 域的 HttpOnly cookie。API 必须精确允许 Web origin 的 credentialed CORS 与 WebSocket Origin，并启用 Secure cookie。前端不保存或读取会话 cookie。

本地开发和 Docker 仍可把两个 public base 留空，经 Next rewrites 同源代理；API_ORIGIN 指向可达后端。不要混合“Web 域解锁 / REST 代理”和“API 域 WebSocket”，否则 host-only cookie 的归属不同。

`NEXT_PUBLIC_*` 在构建时写入浏览器产物；改变环境变量需要重新构建。将已构建的 STAGED Production 产物提升到生产域名不会重新写入这些值。仓库 `vercel.json` 的 `git.deploymentEnabled=false` 暂停 Git 自动部署，发布由部署流程显式控制；`gitProviderOptions.createDeployments` 只控制 GitHub 部署通知。

Preview 暂时关闭。准备隔离后端后，使用同站点的 `agent-preview.douglasdong.com` 与 `agent-api-preview.douglasdong.com`，Preview 的 REST/WS/rewrite 三项均指向 Preview API。默认 `*.vercel.app` 预览域不加入生产 Origin 白名单。

## 目录怎么找东西

```
src/
├── app/          路由层（只做布局编排）
├── containers/   ┐
├── hooks/        ├─ 三层都按**功能**分子目录：
├── lib/          ┘  access / project / sandbox / task / terminal / credential / workbench / _shared
├── views/        纯展示组件（早就是按功能分的）+ 每个功能下 __stories__/
├── services/  stores/  types/  components/ui/
```

- **找某个功能的全部代码**：在 `containers/ hooks/ lib/ views/` 下找同名子目录。
- **`_shared/` 的判据**：删掉某个功能，它是否还该留下。是 → `_shared/`。
- **验收**：`src/acceptance/`；**story**：与 view 同级的 `__stories__/`。
- **分层纪律**（谁能 import 谁）由 `eslint-plugin-boundaries` 强制，见 [07](../docs/frontend/07-前端目录结构与视图逻辑分离.md)。
  `view` 连 `hook` 都不能碰——这条护栏比目录整洁重要得多，重构时一个字没动。

## 常用命令

| 命令                                      | 作用                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm typecheck`                          | `tsc --noEmit`（strict + noUncheckedIndexedAccess 等，14 §5）            |
| `pnpm lint`                               | ESLint（boundaries + 防绕过类型），`--max-warnings=0`                    |
| `pnpm build`                              | `next build`                                                             |
| `pnpm test`                               | 新版 REQ/AC 组件验收（真实 container/hook、HTTP/WS 边界与副作用）        |
| `pnpm storybook`                          | **组件总览**：全部 view 的形态（含失败态/空态/边界值），改 UI 前先看这里 |
| `pnpm test:storybook`                     | Storybook 交互测试（Vitest browser，需 `playwright install chromium`）   |
| `pnpm check:stories`                      | 每个 `*.view.tsx` 必须有配套 story，否则 fail                            |
| `pnpm check:api-drift`                    | 重新生成类型并 `git diff --exit-code`（契约漂移门禁）                    |
| `pnpm storybook` / `pnpm build-storybook` | Storybook 9                                                              |
| `pnpm e2e`                                | 主仓 e2e-contract：真实 Nest + SQLite + 浏览器，不拦截 HTTP/WS           |

## Harness 门禁逐项落点

| 机制                                                                      | 落点                                                                                                    | 文档            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------- |
| 分层铁律（view/container/hook/service/store/type/app/lib/component/mock） | `eslint.config.js` → `boundaries/element-types`                                                         | 07 §3/§4        |
| view 禁 `useEffect/useLayoutEffect/fetch/new WebSocket`                   | `eslint.config.js` → view 层 `no-restricted-syntax`                                                     | 07 §4.2         |
| service 是唯一 fetch/WS 层                                                | 全局禁 fetch/WebSocket，仅 `src/services/**` 白名单                                                     | 07 §3 规则 5    |
| `@xterm/*` 唯一 import 点                                                 | `no-restricted-imports` 仅放行 `hooks/useTerminalInstance.ts`                                           | 08 §2.1         |
| 禁 `as unknown as` / `ts-ignore` / 裸 any / 非空断言                      | `no-restricted-syntax` + `@typescript-eslint` 规则                                                      | 14 §4           |
| 生成的 `openapi.d.ts` 禁手改                                              | ESLint ignore + `generate:api` 唯一维护                                                                 | 14 §2.1         |
| 契约 codegen + 漂移门禁                                                   | `pnpm generate:api` + CI `git diff --exit-code`                                                         | 10 §2.1         |
| 每个 view 必有 story                                                      | `scripts/check-story-coverage.ts`（CI fail）                                                            | 12 §2.5         |
| partialize 白名单（`initialPrompt`/凭证绝不落盘）                         | `stores/index.ts#partializeAppState` + `acceptance/realtime-session-boundaries.test.tsx` 实际持久化边界 | 15 §3.5         |
| pre-commit（eslint --fix + prettier）+ commitlint                         | `.husky/` + `.lintstagedrc.json` + `commitlint.config.js`                                               | 09              |
| CI 与跨仓浏览器验收                                                       | Jenkins `agent-platform-web` 与其 `agent-platform-contract` 子任务，见 [CI 说明](.github/JENKINS_CI.md) | 12 §5 / 09 §1.3 |

## 目录结构（详见 docs/frontend/07 §2）

```
src/
  app/          路由层：只做布局编排（page/layout/providers）
  views/        纯展示，props 驱动；每个 *.view.tsx 配套 *.view.stories.tsx
  containers/   唯一 view↔hooks 粘合点（含 TerminalContainer 的 next/dynamic 装配）
  hooks/        逻辑层：useEffect/业务流程只在这里（useTerminalInstance 是唯一 import @xterm/* 处）
  services/     唯一允许 fetch/WebSocket 的层（api/ + ws/ptySocket）
  stores/       Zustand 单 store + slices（uiSlice + terminalRegistrySlice）+ persist 白名单
  types/        ws-protocol（zod）· domain · terminal · generated/openapi.d.ts（勿手改）
  lib/          纯函数（writeBatcher · terminalTheme · selectProjectTaskTree · validateEnvVar）
  mocks/        MSW handlers（REST + WS echo）
  components/   shadcn/ui
```

## 当前验收范围

验收按 REQ/AC 场景编写，默认 `pnpm test` 运行 `vitest.acceptance.config.ts`。真实 container/hook 消费显式 HTTP 夹具；事件与终端用例在资源边界注入通道，验证 REST/事件竞态、重连、序号去重、会话身份和隐私白名单。

`pnpm e2e` 在主仓启动完整 Nest、隔离 SQLite 和独立生产 Web 构建，经同源代理驱动浏览器。HTTP、WS、仓库 facade 与业务持久化不替换；仅外部 provider、模型、registry、Git 与 PTY 资源使用确定性 fixture。执行后退出独立进程，避免覆盖普通开发构建。

Storybook 提供当前组件的空态、失败态、边界值和交互回归；跨仓浏览器验收覆盖页面与真实 API 的完整链路。Jenkins 归档各项执行报告与构建产物，见 [CI 说明](.github/JENKINS_CI.md)。Storybook 的状态与交互通过不等于完整容器链路或全站无障碍扫描。
