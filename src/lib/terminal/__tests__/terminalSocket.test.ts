import { describe, it, expect } from 'vitest';
import {
  buildTerminalSocketConfig,
  withTerminalTarget,
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

describe('withTerminalTarget —— 这条连接连哪一个会话（06 §5）', () => {
  const base = buildTerminalSocketConfig('http://h:1', 'sb-1');

  it('⛔ agent 那一支**原样返回**，不加 `kind=agent`', () => {
    // 缺省就是 agent（后端对不带 kind 的旧客户端零影响）。多加一个参数只会多出
    // 一处"两边都得改对"的地方，还让新旧连接串不再逐字一致。
    expect(withTerminalTarget(base, { kind: 'agent' })).toBe(base);
  });

  it('⭐ shell 那一支带 `kind=shell`；还不知道 shellId 时**不带**它', () => {
    const cfg = withTerminalTarget(base, { kind: 'shell' });
    expect(cfg.query['kind']).toBe('shell');
    // 不带 ⇒ 后端现生成一个并随首帧回传。⛔ 前端绝不自造（它会进后端 `tmux -s` 的 argv）。
    expect(cfg.query).not.toHaveProperty('shellId');
    // 基础 query 一个都不许丢（少了 xSchemaHash 就是握手必被拒）。
    expect(cfg.query['sandboxId']).toBe('sb-1');
    expect(cfg.query['xSchemaHash']).toBe(WS_SCHEMA_HASH);
    // 不许就地改写入参（base 还要给别的标签用）。
    expect(base.query).not.toHaveProperty('kind');
  });

  it('已知 shellId ⇒ 带回去（重建时接回同一个会话，而不是又开一个）', () => {
    const cfg = withTerminalTarget(base, { kind: 'shell', shellId: 'a'.repeat(32) });
    expect(cfg.query['shellId']).toBe('a'.repeat(32));
  });

  it('空串的 shellId 当作"没有"处理（别把空值发上去让后端去猜）', () => {
    expect(withTerminalTarget(base, { kind: 'shell', shellId: '' }).query).not.toHaveProperty(
      'shellId',
    );
  });
});
