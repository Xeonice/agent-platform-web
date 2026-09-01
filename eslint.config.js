// —— 前端分层铁律 + 防绕过类型 harness（docs/frontend/07 §3/§4、docs/shared/14 第二部分）——
// 本文件是 CI `pnpm lint --max-warnings=0` 门禁的规则源。修改前先读 07 §4 的「同名规则整体覆盖」注意事项。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import storybook from 'eslint-plugin-storybook';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// ——— 复用的 no-restricted-syntax selector（避免同名规则覆盖导致丢条目，07 §4.2 注意事项）———
const AS_UNKNOWN_AS = {
  selector: 'TSAsExpression > TSAsExpression',
  message:
    '禁止双重类型断言（as unknown as X）；确需绕过请 eslint-disable + 理由注释并收敛到 types/shims（14 §4）',
};
const NO_FETCH = {
  selector: "CallExpression[callee.name='fetch']",
  message: 'fetch 只允许出现在 services/ 层（07 §3 规则 5）',
};
const NO_WEBSOCKET = {
  selector: "NewExpression[callee.name='WebSocket']",
  message: 'new WebSocket 只允许出现在 services/ 层（07 §3 规则 5）',
};
const NO_USEEFFECT = {
  selector: "CallExpression[callee.name='useEffect']",
  message: 'views/ 禁止 useEffect，副作用移至 hooks/ 层（07 §3 规则 2）',
};
const NO_USELAYOUTEFFECT = {
  selector: "CallExpression[callee.name='useLayoutEffect']",
  message: 'views/ 禁止 useLayoutEffect，副作用移至 hooks/ 层（07 §3 规则 2）',
};

// ——— 铁律 2 后半截「useState 仅限本地 UI 态」的可机检形态（07 §3 规则 2）———
// 文档原文要求「useState 需 eslint-disable + 理由」，实际落地改为 **不拦 useState 本身，
// 改拦「使 state 不再是本地 UI 态」的那些语法**：本地 UI 态的判据是「同步、由用户事件驱动、
// 不依赖宿主环境与外部系统」。凡是需要 await / 定时 / 读浏览器全局 / 订阅外部源的，都不是。
// 理由见 07 §3 表格下方的说明（10 处既有 useState 全部合规，逐个挂 disable 只会产出 10 条同义反复）。
const VIEW_NO_ASYNC_FN = {
  selector:
    ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)[async=true]',
  message:
    'views/ 禁止 async 函数：需要等待的状态不是本地 UI 态，异步编排移至 hooks/ 层（07 §3 规则 2）',
};
const VIEW_NO_AWAIT = {
  selector: 'AwaitExpression',
  message: 'views/ 禁止 await：需要等待的状态不是本地 UI 态，移至 hooks/ 层（07 §3 规则 2）',
};
const VIEW_NO_PROMISE_CHAIN = {
  selector: 'CallExpression[callee.property.name=/^(then|catch|finally)$/]',
  message:
    'views/ 禁止 Promise 链（.then/.catch/.finally）：异步结果不是本地 UI 态，移至 hooks/ 层（07 §3 规则 2）',
};
const VIEW_NO_TIMER = {
  selector:
    'CallExpression[callee.name=/^(setTimeout|setInterval|queueMicrotask|requestAnimationFrame|requestIdleCallback)$/]',
  message:
    'views/ 禁止定时器/调度回调：由时间驱动的状态不是本地 UI 态，移至 hooks/ 层（07 §3 规则 2）',
};
const VIEW_NO_BROWSER_GLOBAL = {
  selector:
    'MemberExpression[object.name=/^(window|document|localStorage|sessionStorage|navigator|history|location)$/]',
  message:
    'views/ 禁止读写浏览器全局（window/document/localStorage/…）：宿主环境态不是本地 UI 态，移至 hooks/ 层（07 §3 规则 2）',
};
const VIEW_NO_EXTERNAL_STATE = {
  selector: 'CallExpression[callee.name=/^(useReducer|useSyncExternalStore)$/]',
  message:
    'views/ 禁止 useReducer / useSyncExternalStore：状态机与外部源订阅属于 hooks/ 层，view 只留受控本地 UI 态（07 §3 规则 2）',
};

// ——— 铁律 3「containers/** 本身不写 DOM 操作」（07 §3 规则 3）———
// container 只做 view ↔ hooks 粘合：**可以**创建 ref 并把它传给 view / 传给 hook
// （useModalFocus / useEscapeKey / TerminalMount 挂 xterm 都是这条边），
// **不可以**自己去摸 document、改节点、或发命令式 DOM 调用——那些属于 hooks/ 层。
const CONTAINER_NO_DOCUMENT = {
  selector: "MemberExpression[object.name='document']",
  message:
    'containers/ 不写 DOM 操作：document.* 属于 hooks/ 层（如 _shared/useModalFocus、useEscapeKey）（07 §3 规则 3）',
};
const CONTAINER_NO_DOM_MUTATION = {
  selector:
    'MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML|classList|appendChild|removeChild|replaceChild|insertBefore|setAttribute|removeAttribute|createElement|createTextNode)$/]',
  message:
    'containers/ 不写 DOM 操作：节点增删改属于 hooks/ 层，container 只负责把 ref 传下去（07 §3 规则 3）',
};
const CONTAINER_NO_IMPERATIVE_DOM = {
  selector: 'CallExpression[callee.property.name=/^(focus|blur|scrollIntoView|click|select)$/]',
  message:
    'containers/ 不写 DOM 操作：命令式 DOM 调用（focus/blur/scrollIntoView/…）收在 hooks/ 层（07 §3 规则 3）',
};

// ——— @xterm/* 单一 import 点（08 §2.1）：只有 hooks/terminal/useTerminalInstance.ts 可 import ———
const XTERM_IMPORT = {
  group: ['@xterm/*'],
  message:
    '@xterm/* 只能在 hooks/terminal/useTerminalInstance.ts 内 import（08 §2.1 唯一 import 点）',
};
// 同时覆盖裸桶导入（@/services、@/stores → index.ts）与子路径（@/services/**、@/stores/**）。
const VIEW_FORBIDDEN_IMPORTS = [
  {
    group: ['**/services', '**/services/**'],
    message: '视图层禁止依赖 service，经 hooks/container 注入（07 §3 规则 1）',
  },
  {
    group: ['**/stores', '**/stores/**'],
    message: '视图层禁止读写全局 store，由 container 传 props（15 §3.4）',
  },
];
// hooks/ 不应反向依赖 views/（07 §4.2）——裸桶导入与子路径都拦。
const HOOKS_NO_VIEWS = {
  group: ['**/views', '**/views/**'],
  message: 'hooks/ 不应依赖 views/（07 §4.2 单向依赖）',
};

export default tseslint.config(
  // ——— 全局忽略 ———
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'storybook-static/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/types/generated/**', // 生成物，禁手改（14 §2.1）；由 generate:api 维护
      'public/**', // 含 MSW 生成的 mockServiceWorker.js
      'next.config.mjs',
      'postcss.config.mjs',
      'commitlint.config.js',
      'eslint.config.js',
    ],
  },

  // ——— 基线：strictTypeChecked + stylisticTypeChecked（shared/14 §4 要求 strict 预设）———
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  // ——— type-aware parser 设置（只对项目源码开 projectService）———
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
  },

  // ——— 防绕过类型（14 第二部分）：全库共用基线 ———
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
          minimumDescriptionLength: 10,
        },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // 8.15+，不在预设里，须手动开：禁"缩小类型"的偷懒断言（14 §4）。
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      'no-restricted-syntax': ['error', AS_UNKNOWN_AS],
    },
  },

  // ——— React Hooks 规则（07 §4.3）：rules-of-hooks 硬门禁 + exhaustive-deps ———
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // ——— boundaries：分层元素声明 + 依赖方向（07 §4.1）———
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // boundaries 经 eslint-module-utils 解析 import 目标 → 必须给 TS 路径别名（@/*）配 resolver，
      // 否则 `@/hooks/*` 等无法解析为文件，element-types 判不出目标层、静默放行（P0-1 根因）。
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
        node: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
      },
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'container', pattern: 'src/containers/**' },
        { type: 'view', pattern: 'src/views/**' },
        { type: 'hook', pattern: 'src/hooks/**' },
        { type: 'service', pattern: 'src/services/**' },
        { type: 'store', pattern: 'src/stores/**' },
        { type: 'type', pattern: 'src/types/**' },
        { type: 'lib', pattern: 'src/lib/**' },
        { type: 'component', pattern: 'src/components/**' },
        { type: 'mock', pattern: 'src/mocks/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            { from: 'app', allow: ['container', 'view', 'type', 'component'] },
            { from: 'container', allow: ['view', 'hook', 'type', 'store', 'component'] },
            { from: 'view', allow: ['view', 'type', 'component'] },
            { from: 'hook', allow: ['service', 'store', 'type', 'hook', 'lib'] },
            { from: 'service', allow: ['service', 'type', 'lib'] },
            { from: 'store', allow: ['store', 'type', 'lib'] },
            { from: 'lib', allow: ['lib', 'type'] },
            { from: 'component', allow: ['component', 'type', 'lib'] },
            { from: 'mock', allow: ['type', 'mock'] },
            { from: 'type', allow: ['type'] },
          ],
        },
      ],
      'boundaries/no-private-files': 'off',
      'boundaries/no-unknown-files': 'off',
    },
  },

  // ——— 唯一被许可的 app→mock 边：dev 专属 MSW 引导（providers.tsx，生产 tree-shaking 排除）———
  {
    files: ['src/app/providers.tsx'],
    plugins: { boundaries },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [{ from: 'app', allow: ['container', 'view', 'type', 'component', 'mock'] }],
        },
      ],
    },
  },

  // ——— @xterm/* 唯一 import 点：除 hooks/terminal/useTerminalInstance.ts 与 views(下方单独配) 外一律禁止 ———
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/hooks/terminal/useTerminalInstance.ts', 'src/views/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [XTERM_IMPORT] }],
    },
  },

  // ——— view 层副作用与依赖封禁（07 §4.2）。整份数组必须带上全局 AS_UNKNOWN_AS（07 §4.2 注意）———
  {
    files: ['src/views/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        AS_UNKNOWN_AS,
        NO_USEEFFECT,
        NO_USELAYOUTEFFECT,
        NO_FETCH,
        NO_WEBSOCKET,
      ],
      'no-restricted-imports': ['error', { patterns: [XTERM_IMPORT, ...VIEW_FORBIDDEN_IMPORTS] }],
    },
  },

  // ——— view 源码（不含 story）：铁律 2 后半截「useState 仅限本地 UI 态」的落点（07 §3 规则 2）———
  // ESLint 同名规则整体覆盖（07 §4.2 注意），故必须把上一块的 5 条一并带上。
  // 排除 __stories__：story 的 play 函数天然是 async，它测的是 view 而不是 view 本身。
  {
    files: ['src/views/**/*.{ts,tsx}'],
    ignores: ['src/views/**/__stories__/**', 'src/views/**/*.stories.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        AS_UNKNOWN_AS,
        NO_USEEFFECT,
        NO_USELAYOUTEFFECT,
        NO_FETCH,
        NO_WEBSOCKET,
        VIEW_NO_ASYNC_FN,
        VIEW_NO_AWAIT,
        VIEW_NO_PROMISE_CHAIN,
        VIEW_NO_TIMER,
        VIEW_NO_BROWSER_GLOBAL,
        VIEW_NO_EXTERNAL_STATE,
      ],
    },
  },

  // ——— hooks → views 反向依赖禁令（07 §4.2）。放 views 块之后覆盖 XTERM 块，故须把 XTERM_IMPORT 一并带上，
  //     避免丢掉 @xterm 单一 import 点约束；useTerminalInstance.ts 例外（它是唯一 @xterm import 点）———
  {
    files: ['src/hooks/**/*.ts'],
    ignores: ['src/hooks/terminal/useTerminalInstance.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [XTERM_IMPORT, HOOKS_NO_VIEWS] }],
    },
  },

  // ——— 非 service / 非 view：全局禁 fetch/new WebSocket（services 是唯一网络层，07 §3 规则 5）———
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/services/**/*.{ts,tsx}', 'src/views/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', AS_UNKNOWN_AS, NO_FETCH, NO_WEBSOCKET],
    },
  },

  // ——— container 层不写 DOM 操作（07 §3 规则 3）。同名规则整体覆盖 ⇒ 带上上一块的 3 条。
  //     排除 __tests__：测试要造真实 DOM（createElement / body.appendChild / innerHTML 断言）。———
  {
    files: ['src/containers/**/*.{ts,tsx}'],
    ignores: ['src/containers/**/__tests__/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        AS_UNKNOWN_AS,
        NO_FETCH,
        NO_WEBSOCKET,
        CONTAINER_NO_DOCUMENT,
        CONTAINER_NO_DOM_MUTATION,
        CONTAINER_NO_IMPERATIVE_DOM,
      ],
    },
  },

  // 说明：*.stories.tsx 位于 src/views/ 下，被 boundaries 归类为 `view` 元素，
  // 因此天然只能 import view/type/component（禁 service/store），与 12 §2.5 的 story 约束一致，无需单独配置。

  // ——— 测试 / 脚本 / mock：放宽 type-aware 噪声（外部 JSON/DOM 边界），保留结构约束 ———
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/mocks/**/*.ts', 'scripts/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  // ——— 测试文件不受分层依赖方向约束（boundaries 管的是生产依赖方向，测试可跨层 wire mock/fixture）———
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}'],
    plugins: { boundaries },
    rules: {
      'boundaries/element-types': 'off',
    },
  },

  // ——— Storybook 插件推荐规则 ———
  ...storybook.configs['flat/recommended'],

  // ——— 根配置文件 / mjs：关闭 type-aware（不在 tsconfig program 内）———
  {
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: { ...globals.node } },
  },
);
