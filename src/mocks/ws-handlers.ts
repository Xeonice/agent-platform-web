// MSW WebSocket handlers（本地 echo，12 §4.1 只在 Storybook/dev；e2e 用 Playwright routeWebSocket）。
// 模拟 PTY 网关：首帧下发 socketSessionKey，收到 input 帧后原样 echo 为 data 帧（08 §3）。
import { ws } from 'msw';

const WS_BASE = process.env['NEXT_PUBLIC_WS_BASE_URL'] ?? 'ws://localhost:3001';

const terminal = ws.link(`${WS_BASE}/terminal`);

export const wsHandlers = [
  terminal.addEventListener('connection', ({ client }) => {
    client.send(JSON.stringify({ type: 'session', socketSessionKey: `mock-${Date.now()}` }));
    client.addEventListener('message', (event) => {
      const raw = typeof event.data === 'string' ? event.data : '';
      let frame: { type?: string; data?: string };
      try {
        frame = JSON.parse(raw);
      } catch {
        return;
      }
      if (frame.type === 'input' && typeof frame.data === 'string') {
        client.send(JSON.stringify({ type: 'data', data: frame.data }));
      }
    });
  }),
];
