# agent-platform-web

云 Agent 管理平台前端。技术栈：**Next.js App Router (15) · TypeScript strict · TanStack Query v5 · Zustand · shadcn/ui · @xterm/xterm 5.5.x · pnpm**。

目录结构与视图/逻辑分层铁律以 [`docs/frontend/07`](../docs/frontend/07-前端目录结构与视图逻辑分离.md) 为准；本仓从第一个 commit 起即接入全套 harness 强制机制。

## 快速开始

```bash
pnpm install
pnpm generate:api        # 从 openapi.json 生成 src/types/generated/openapi.d.ts（后端就绪前用占位 spec）
cp .env.example .env      # 填占位即可；.env 已 gitignore，禁止提交真实值
pnpm dev                 # http://localhost:3000（dev 下自动起 MSW，GET /api/health 与 /terminal echo 均被 mock）
```

首次或 CI 首拉需 `pnpm exec msw init public/`（生成 MSW worker 文件，dev 浏览器 mock 用）。

## 常用命令

| 命令                                      | 作用                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm typecheck`                          | `tsc --noEmit`（strict + noUncheckedIndexedAccess 等，14 §5）                |
| `pnpm lint`                               | ESLint（boundaries + 防绕过类型），`--max-warnings=0`                        |
| `pnpm build`                              | `next build`                                                                 |
| `pnpm test`                               | Vitest 单测（纯函数 / service+msw / partialize 快照 / ptySocket echo）       |
| `pnpm test:storybook`                     | Storybook 交互/a11y 测试（Vitest browser，需 `playwright install chromium`） |
| `pnpm check:stories`                      | 每个 `*.view.tsx` 必须有配套 story，否则 fail                                |
| `pnpm check:api-drift`                    | 重新生成类型并 `git diff --exit-code`（契约漂移门禁）                        |
| `pnpm storybook` / `pnpm build-storybook` | Storybook 9                                                                  |
| `pnpm e2e`                                | Playwright（REST 用 `page.route`、WS 用 `routeWebSocket`）                   |

## Harness 门禁逐项落点

| 机制                                                                      | 落点                                                                     | 文档            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------- |
| 分层铁律（view/container/hook/service/store/type/app/lib/component/mock） | `eslint.config.js` → `boundaries/element-types`                          | 07 §3/§4        |
| view 禁 `useEffect/useLayoutEffect/fetch/new WebSocket`                   | `eslint.config.js` → view 层 `no-restricted-syntax`                      | 07 §4.2         |
| service 是唯一 fetch/WS 层                                                | 全局禁 fetch/WebSocket，仅 `src/services/**` 白名单                      | 07 §3 规则 5    |
| `@xterm/*` 唯一 import 点                                                 | `no-restricted-imports` 仅放行 `hooks/useTerminalInstance.ts`            | 08 §2.1         |
| 禁 `as unknown as` / `ts-ignore` / 裸 any / 非空断言                      | `no-restricted-syntax` + `@typescript-eslint` 规则                       | 14 §4           |
| 生成的 `openapi.d.ts` 禁手改                                              | ESLint ignore + `generate:api` 唯一维护                                  | 14 §2.1         |
| 契约 codegen + 漂移门禁                                                   | `pnpm generate:api` + CI `git diff --exit-code`                          | 10 §2.1         |
| 每个 view 必有 story                                                      | `scripts/check-story-coverage.ts`（CI fail）                             | 12 §2.5         |
| partialize 白名单（`initialPrompt`/凭证绝不落盘）                         | `stores/index.ts#partializeAppState` + `stores/persist.test.ts` 快照断言 | 15 §3.5         |
| pre-commit（eslint --fix + prettier）+ commitlint                         | `.husky/` + `.lintstagedrc.json` + `commitlint.config.js`                | 09              |
| CI 四道门                                                                 | `.github/workflows/ci.yml`                                               | 12 §5 / 09 §1.3 |

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

## 冒烟切片

- 工作台页 `app/page.tsx` 渲染骨架（顶栏 + 分组任务树 + 终端区）。
- 一条 typed openapi-fetch service（`GET /api/health`）走 MSW，`health.service.test.ts` 验证。
- 终端子系统：`TerminalPane.view`（仅持 div ref）+ `useTerminalInstance`（唯一挂 xterm）+ `ptySocket`（DI WebSocket），echo 由 `ptySocket.test.ts` 与 dev MSW / e2e `routeWebSocket` 验证。
- 三个 view 的 story + partialize 快照断言 + boundaries 违规拦截（见 CI/lint）。

> 后端契约就绪后：`OPENAPI_URL=http://localhost:3001/openapi.json pnpm generate:api` 覆盖 `openapi.json` 占位并提交类型 diff。
