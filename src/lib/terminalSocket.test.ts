import { describe, it, expect } from 'vitest';
import {
  buildTerminalSocketConfig,
  WS_SCHEMA_HASH,
  TERMINAL_NAMESPACE,
} from '@/lib/terminalSocket';

describe('buildTerminalSocketConfig (socket.io /terminal)', () => {
  it('uri = origin + /terminal namespace，query 带 sandboxId/cols/rows/xSchemaHash', () => {
    const cfg = buildTerminalSocketConfig('http://localhost:3001', 'sb-1');
    expect(cfg.uri).toBe(`http://localhost:3001${TERMINAL_NAMESPACE}`);
    expect(cfg.query['sandboxId']).toBe('sb-1');
    expect(cfg.query['cols']).toBe('80');
    expect(cfg.query['rows']).toBe('24');
    // 键名对齐后端契约：xSchemaHash（不是 schemaHash）
    expect(cfg.query['xSchemaHash']).toBe(WS_SCHEMA_HASH);
    expect(cfg.query).not.toHaveProperty('schemaHash');
  });

  it('ws(s):// origin 归一化为 http(s)://（socket.io 内部自升级到 ws）', () => {
    expect(buildTerminalSocketConfig('ws://h:1', 'x').uri).toBe('http://h:1/terminal');
    expect(buildTerminalSocketConfig('wss://h:1/', 'x').uri).toBe('https://h:1/terminal');
  });

  it('支持自定义 schemaHash', () => {
    expect(buildTerminalSocketConfig('http://h:1', 'x', 'abc123').query['xSchemaHash']).toBe(
      'abc123',
    );
  });
});
