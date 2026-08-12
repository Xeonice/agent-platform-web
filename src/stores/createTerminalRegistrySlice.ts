// 终端实例注册表（15 §3.2 / 08 §5.1）：键为 sessionId（会话粒度），持有非可序列化对象。
// store 只做记账 action，不做业务判断（LRU 决策在 hooks/useTerminalInstance）。绝不 persist。
import type { StateCreator } from 'zustand';
import type { ConnState, RendererKind } from '@/types/terminal';

export type { ConnState, RendererKind };

/** 不 import `@xterm/*`（唯一 import 点是 useTerminalInstance）；此处用不透明句柄描述实例。 */
export interface TerminalHandle {
  dispose(): void;
  write(data: string): void;
}
export interface SocketHandle {
  close(): void;
}

export interface TerminalEntry {
  sessionId: string;
  sandboxId: string;
  socketSessionKey?: string; // 后端下发的重连凭据（08 §3）；不 persist
  terminal: TerminalHandle;
  socket: SocketHandle;
  container?: HTMLDivElement;
  renderer: RendererKind;
  connState: ConnState;
  lastActiveAt: number;
}

export interface TerminalRegistrySlice {
  entries: Map<string, TerminalEntry>;
  bySandbox: Map<string, string[]>;
  activeSessionOf: Map<string, string>;
  register: (entry: TerminalEntry) => void;
  dispose: (sessionId: string) => void;
  touch: (sessionId: string) => void;
  patchConnState: (sessionId: string, connState: ConnState) => void;
  patchRenderer: (sessionId: string, renderer: RendererKind) => void;
  setActiveSession: (sandboxId: string, sessionId: string) => void;
}

export const createTerminalRegistrySlice: StateCreator<
  TerminalRegistrySlice,
  [],
  [],
  TerminalRegistrySlice
> = (set) => ({
  entries: new Map(),
  bySandbox: new Map(),
  activeSessionOf: new Map(),

  register: (entry): void => {
    set((s) => {
      const entries = new Map(s.entries);
      entries.set(entry.sessionId, entry);
      const bySandbox = new Map(s.bySandbox);
      const list = bySandbox.get(entry.sandboxId) ?? [];
      if (!list.includes(entry.sessionId)) {
        bySandbox.set(entry.sandboxId, [...list, entry.sessionId]);
      }
      return { entries, bySandbox };
    });
  },

  dispose: (sessionId): void => {
    set((s) => {
      const entry = s.entries.get(sessionId);
      if (!entry) return {};
      const entries = new Map(s.entries);
      entries.delete(sessionId);
      const bySandbox = new Map(s.bySandbox);
      const list = (bySandbox.get(entry.sandboxId) ?? []).filter((id) => id !== sessionId);
      if (list.length > 0) bySandbox.set(entry.sandboxId, list);
      else bySandbox.delete(entry.sandboxId);
      const activeSessionOf = new Map(s.activeSessionOf);
      if (activeSessionOf.get(entry.sandboxId) === sessionId) {
        activeSessionOf.delete(entry.sandboxId);
      }
      return { entries, bySandbox, activeSessionOf };
    });
  },

  touch: (sessionId): void => {
    set((s) => {
      const entry = s.entries.get(sessionId);
      if (!entry) return {};
      const entries = new Map(s.entries);
      entries.set(sessionId, { ...entry, lastActiveAt: Date.now() });
      return { entries };
    });
  },

  patchConnState: (sessionId, connState): void => {
    set((s) => {
      const entry = s.entries.get(sessionId);
      if (!entry) return {};
      const entries = new Map(s.entries);
      entries.set(sessionId, { ...entry, connState });
      return { entries };
    });
  },

  patchRenderer: (sessionId, renderer): void => {
    set((s) => {
      const entry = s.entries.get(sessionId);
      if (!entry) return {};
      const entries = new Map(s.entries);
      entries.set(sessionId, { ...entry, renderer });
      return { entries };
    });
  },

  setActiveSession: (sandboxId, sessionId): void => {
    set((s) => {
      const activeSessionOf = new Map(s.activeSessionOf);
      activeSessionOf.set(sandboxId, sessionId);
      return { activeSessionOf };
    });
  },
});
