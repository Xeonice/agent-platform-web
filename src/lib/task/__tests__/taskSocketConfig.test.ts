// /tasks 连接描述（纯函数）。与 lib/terminalSocket.test.ts 同形：origin 归一化 + 握手 query 键名。
import { describe, it, expect } from 'vitest';
import {
  buildTasksSocketQuery,
  buildTasksSocketUri,
  WS_TASKS_SCHEMA_HASH,
} from '@/lib/task/taskSocketConfig';

describe('buildTasksSocketUri', () => {
  it('ws(s):// 归一化成 http(s):// 并挂上 /tasks namespace（socket.io 用 http origin）', () => {
    expect(buildTasksSocketUri('ws://localhost:3001')).toBe('http://localhost:3001/tasks');
    expect(buildTasksSocketUri('wss://example.com')).toBe('https://example.com/tasks');
    expect(buildTasksSocketUri('http://localhost:3001/')).toBe('http://localhost:3001/tasks');
  });

  // ★ 同源档（生产默认）。空 base 是**正常配置**不是缺失：socket.io 对 `/` 开头的 uri
  // 按相对路径解析，补上当前页面的 host 与协议 ⇒ 构建期不必知道运行时的 host。
  // ⚠️ 少了这条，把 WorkbenchContainer 的默认值改回 `ws://localhost:3001` 全绿。
  it('空 base ⇒ 同源相对路径', () => {
    expect(buildTasksSocketUri('')).toBe('/tasks');
  });
});

describe('buildTasksSocketQuery', () => {
  it('带上 sandboxId ⇒ 后端才做得了订阅归属校验（键名对齐后端 readQuery("sandboxId")）', () => {
    expect(buildTasksSocketQuery('sb-1')).toEqual({
      sandboxId: 'sb-1',
      xSchemaHash: WS_TASKS_SCHEMA_HASH,
    });
  });

  it('版本标识钉死字面量（跨仓漂移在握手期就被拒，而不是等某条帧被 zod 静默丢掉）', () => {
    expect(WS_TASKS_SCHEMA_HASH).toBe('sb-tasks-v1');
    expect(buildTasksSocketQuery('sb-1', 'sb-tasks-v0')['xSchemaHash']).toBe('sb-tasks-v0');
  });

  it('taskId **不**进握手 query：一条连接可换订阅目标，归属才是连接级属性', () => {
    expect(Object.keys(buildTasksSocketQuery('sb-1')).sort()).toEqual(['sandboxId', 'xSchemaHash']);
  });
});
