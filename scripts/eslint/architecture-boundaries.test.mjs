import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
const eslint = new ESLint({ cwd });
const VIEW = 'src/views/access/UnlockForm.view.tsx';
const HOOK = 'src/hooks/system/useInstanceUpgrade.ts';
const SERVICE = 'src/services/api/upgrade.service.ts';
const EFFECT = 'architecture/no-view-effects';
const NETWORK = 'architecture/no-network-capabilities';

async function messages(code, filePath = VIEW) {
  const [result] = await eslint.lintText(code, { filePath });
  assert.ok(result);
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages;
}

for (const [name, code] of Object.entries({
  named: "import { useEffect } from 'react'; useEffect(() => {}, []);",
  alias: "import { useEffect as effect } from 'react'; effect(() => {}, []);",
  layoutAlias: "import { useLayoutEffect as effect } from 'react'; effect(() => {}, []);",
  namespace: "import * as React from 'react'; React.useEffect(() => {}, []);",
  default: "import React from 'react'; React.useLayoutEffect(() => {}, []);",
  computed: "import * as React from 'react'; React['useEffect'](() => {}, []);",
  namespaceAlias: "import React from 'react'; const R = React; R.useLayoutEffect(() => {}, []);",
  destructured:
    "import * as React from 'react'; const { useEffect: effect } = React; effect(() => {}, []);",
  bound:
    "import { useEffect as effect } from 'react'; const invoke = effect.bind(null); invoke(() => {}, []);",
  call: "import React from 'react'; React.useEffect.call(null, () => {}, []);",
  optional: "import React from 'react'; React?.['useEffect'](() => {}, []);",
})) {
  test(`real view config rejects React effect: ${name}`, async () => {
    assert.ok((await messages(code)).some((message) => message.ruleId === EFFECT));
  });
}

for (const [name, code] of Object.entries({
  fetch: "void fetch('/api/sandboxes');",
  socket: "new WebSocket('ws://localhost');",
  global: "void globalThis.fetch('/api/sandboxes');",
  window: "void window.fetch('/api/sandboxes');",
  self: "new self.WebSocket('ws://localhost');",
  computed: "void globalThis['fetch']('/api/sandboxes');",
  constructorAlias: "const Socket = window['WebSocket']; new Socket('ws://localhost');",
  functionAlias: "const request = fetch; void request('/api/sandboxes');",
  destructured: "const { fetch: request } = globalThis; void request('/api/sandboxes');",
  destructuredComputed: "const { ['WebSocket']: Socket } = window; new Socket('ws://localhost');",
  destructuredAssignment: 'let request = () => {}; ({ fetch: request } = globalThis); request();',
  namespaceAlias: "const root = window; void root.fetch('/api/sandboxes');",
  nestedNamespace: "const { window: root } = globalThis; void root.fetch('/api/sandboxes');",
  bind: "const request = globalThis.fetch.bind(globalThis); void request('/api/sandboxes');",
  call: "void window.fetch.call(window, '/api/sandboxes');",
  apply: "void fetch.apply(globalThis, ['/api/sandboxes']);",
  optional: "void globalThis?.['fetch']('/api/sandboxes');",
})) {
  test(`real hook config rejects network capability: ${name}`, async () => {
    assert.ok((await messages(code, HOOK)).some((message) => message.ruleId === NETWORK));
  });
}

for (const [name, code] of Object.entries({
  namedFunction: 'export function useEffect() {} useEffect();',
  shadowedReact:
    "import * as React from 'react'; export function view(React: { useEffect: () => void }) { React.useEffect(); } void React.version;",
  shadowedImport:
    "import { useEffect as effect } from 'react'; export function view(effect: () => void) { effect(); } export type Effect = typeof effect;",
  shadowedFetch: 'export function run(fetch: () => void) { fetch(); }',
  shadowedConstructor:
    'export function run(WebSocket: new () => object) { return new WebSocket(); }',
  shadowedWindow:
    'export function run(window: { fetch: () => void }) { const { fetch: request } = window; request(); }',
  shadowedGlobal: 'export function run(globalThis: { fetch: () => void }) { globalThis.fetch(); }',
  client:
    'const client = { fetch() {} }; export function run() { const request = client.fetch.bind(client); request.call(client); }',
  reassignedNamespace:
    'let root: { fetch: () => void } = window; root = { fetch() {} }; export function run() { root.fetch(); }',
  typeOnly: 'export type Fetch = typeof fetch; export type Socket = typeof window.WebSocket;',
  mockWrite: 'globalThis.fetch = () => Promise.resolve(new Response());',
})) {
  test(`real config accepts legitimate local binding: ${name}`, async () => {
    assert.deepEqual(
      (await messages(code)).filter((message) => message.ruleId?.startsWith('architecture/')),
      [],
    );
  });
}

test('service layer retains its network boundary', async () => {
  assert.deepEqual(
    (
      await messages(
        "void fetch('/api/sandboxes'); new window.WebSocket('ws://localhost');",
        SERVICE,
      )
    ).filter((message) => message.ruleId?.startsWith('architecture/')),
    [],
  );
});

test('hook layer can use effects', async () => {
  assert.deepEqual(
    (
      await messages("import { useEffect as effect } from 'react'; effect(() => {}, []);", HOOK)
    ).filter((message) => message.ruleId === EFFECT),
    [],
  );
});

test('view async and container DOM gates remain active', async () => {
  assert.ok(
    (await messages('export async function view() { await Promise.resolve(); }')).some(
      (message) => message.ruleId === 'no-restricted-syntax',
    ),
  );
  assert.ok(
    (
      await messages(
        'document.createElement("div");',
        'src/containers/access/AccessGateContainer.tsx',
      )
    ).some((message) => message.ruleId === 'no-restricted-syntax'),
  );
});

test('story async exception retains effect and network gates', async () => {
  const diagnostics = await messages(
    "import React from 'react'; export async function play() { React.useEffect(() => {}, []); await globalThis.fetch('/api/sandboxes'); }",
    'src/views/access/__stories__/UnlockForm.view.stories.tsx',
  );
  assert.ok(diagnostics.some((message) => message.ruleId === EFFECT));
  assert.ok(diagnostics.some((message) => message.ruleId === NETWORK));
  assert.ok(!diagnostics.some((message) => message.message.startsWith('views/ 禁止 async')));
});
