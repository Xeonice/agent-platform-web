// /tasks 传输层的最小 socket 契约。
// 放 types/ 的理由与 types/terminal.ts 的 `TerminalSocketConfig` 相同：service（TaskSocket）、
// hook（useTaskStream）、container（测试注入 mock 工厂）三层都要引用它，
// 而 container 不许 import service（07 §4.1 boundaries）。
//
// 依赖注入替代模块级 mock 是本仓既有测试策略（12 §3.1.1）——把注入点的**类型**放在
// 三层都够得着的地方，才不用为了测试破坏分层。
import type { TaskClientFrame } from '@/types/ws-protocol';

export interface TaskSocketLike {
  onConnect(cb: () => void): void;
  onDisconnect(cb: () => void): void;
  onConnectError(cb: (err?: unknown) => void): void;
  /** 服务端 `frame` 事件（携带一条 TaskServerFrame，尚未 zod 校验）。 */
  onFrame(cb: (raw: unknown) => void): void;
  emitFrame(frame: TaskClientFrame): void;
  disconnect(): void;
}

export interface TaskSocketFactoryArgs {
  uri: string;
  query: Record<string, string>;
}

export type TaskSocketFactory = (args: TaskSocketFactoryArgs) => TaskSocketLike;
