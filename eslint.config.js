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
