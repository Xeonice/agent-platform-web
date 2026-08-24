import { describe, it, expect } from 'vitest';
import {
  buildTerminalSocketConfig,
  WS_SCHEMA_HASH,
  TERMINAL_NAMESPACE,
} from '@/lib/terminal/terminalSocket';

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
    expect(
      buildTerminalSocketConfig('http://h:1', 'x', { cols: 80, rows: 24 }, 'abc123').query[
        'xSchemaHash'
      ],
    ).toBe('abc123');
  });

  /**
   * 建连 query 里的 cols/rows = 容器里 **PTY 的出生尺寸**。agent CLI 一启动就按它画
   * 欢迎横幅，而终端不会回流已输出的字节 ⇒ 事后补 resize 救不回第一屏。
   *
   * MUTATION：把 query 改回写死的 `cols:'80', rows:'24'` → 本条红。
   */
  it('真实尺寸进 query（不是写死 80x24）', () => {
    const q = buildTerminalSocketConfig('http://h:1', 'x', { cols: 213, rows: 51 }).query;
    expect(q['cols']).toBe('213');
    expect(q['rows']).toBe('51');
  });

  it('不传尺寸才回落 80x24——调用方应当先 fit 再连', () => {
    const q = buildTerminalSocketConfig('http://h:1', 'x').query;
    expect(q['cols']).toBe('80');
    expect(q['rows']).toBe('24');
  });
});
