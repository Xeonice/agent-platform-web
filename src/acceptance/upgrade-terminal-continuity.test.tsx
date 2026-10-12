import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PtySocket, type SocketLike, type SocketFactoryArgs } from '@/services/ws/ptySocket';
import { useSandboxTerminalSocket } from '@/hooks/terminal/useSandboxTerminalSocket';
import { useTerminalSessions } from '@/hooks/terminal/useTerminalSessions';
import { InstanceIdentityContext } from '@/hooks/system/useInstanceUpgrade';
import { readTerminalBookmark, terminalBookmarkKey } from '@/lib/terminal/terminalBookmark';
import { buildTerminalSocketConfig } from '@/lib/terminal/terminalSocket';
import { useAppStore, partializeAppState } from '@/stores';
import { TerminalServerFrameSchema } from '@/types/ws-protocol';
import type { ReactNode } from 'react';
import type { TerminalClientFrame } from '@/types/ws-protocol';
const ID = '00000000-0000-4000-8000-000000000021';
const ID2 = '00000000-0000-4000-8000-000000000022';
class Transport implements SocketLike {
  connected: () => void = () => undefined;
  disconnected: () => void = () => undefined;
  error: (error?: unknown) => void = () => undefined;
  frame: (frame: unknown) => void = () => undefined;
  sent: TerminalClientFrame[] = [];
  onConnect(callback: () => void) {
    this.connected = callback;
  }
  onDisconnect(callback: () => void) {
    this.disconnected = callback;
  }
  onConnectError(callback: (error?: unknown) => void) {
    this.error = callback;
  }
  onFrame(callback: (frame: unknown) => void) {
    this.frame = callback;
  }
  emitFrame(frame: TerminalClientFrame) {
    this.sent.push(frame);
  }
  disconnect() {
    this.disconnected();
  }
}
function connection() {
  const transports: Transport[] = [];
  const queries: SocketFactoryArgs[] = [];
  const factory = (args: SocketFactoryArgs) => {
    queries.push(args);
    const transport = new Transport();
    transports.push(transport);
    return transport;
  };
  return { transports, queries, factory };
}
const query = { sandboxId: 'sandbox-a', terminalIdentity: ID, protocolMin: '1', protocolMax: '2' };
const ready = {
  type: 'ready',
  sandboxId: 'sandbox-a',
  terminalIdentity: ID,
  runtimeIdentity: 'box-a:original-process',
  attachmentId: 'attachment-a',
  protocolRevision: 2,
  existingSession: true,
};
describe('UPG F05/C03 original attachment and no input replay', () => {
  it('requires a matching authenticated ready identity, preserves it across reconnect, and never queues input', () => {
    const wire = connection();
    const frames = vi.fn();
    const attachments = vi.fn();
    const socket = new PtySocket({
      uri: 'http://localhost:3001/terminal',
      query,
      socketFactory: wire.factory,
      onFrame: frames,
      onState: vi.fn(),
      onAttachment: attachments,
    });
    socket.connect();
    const first = wire.transports[0]!;
    first.connected();
    expect(socket.send({ type: 'input', data: 'not-replay' })).toBe(false);
    first.frame({ type: 'data', data: 'unconfirmed bytes' });
    expect(frames).not.toHaveBeenCalled();
    first.frame(TerminalServerFrameSchema.parse(ready));
    expect(attachments).toHaveBeenLastCalledWith({
      sandboxId: 'sandbox-a',
      terminalIdentity: ID,
      runtimeIdentity: 'box-a:original-process',
      attachmentId: 'attachment-a',
      protocolRevision: 2,
    });
    expect(socket.send({ type: 'input', data: 'once' })).toBe(true);
    first.disconnected();
    expect(socket.send({ type: 'input', data: 'lost input' })).toBe(false);
    socket.reconnect();
    const second = wire.transports[1]!;
    second.connected();
    expect(wire.queries[1]?.query['terminalIdentity']).toBe(ID);
    expect(second.sent).toEqual([]);
    second.frame({ ...ready, attachmentId: 'attachment-b' });
    expect(socket.send({ type: 'input', data: 'after attach' })).toBe(true);
    expect(second.sent).toEqual([{ type: 'input', data: 'after attach' }]);
    socket.close();
  });
  it.each([
    { ...ready, sandboxId: 'other-sandbox' },
    { ...ready, terminalIdentity: ID2 },
    { ...ready, runtimeIdentity: null },
    { ...ready, protocolRevision: 1 },
    { ...ready, existingSession: false },
  ])('rejects an identity mismatch without calling it a task exit: %j', (frame) => {
    const wire = connection();
    const errors = vi.fn();
    const received = vi.fn();
    const socket = new PtySocket({
      uri: 'http://localhost:3001/terminal',
      query,
      socketFactory: wire.factory,
      onFrame: received,
      onState: vi.fn(),
      onHandshakeError: errors,
    });
    socket.connect();
    wire.transports[0]!.connected();
    wire.transports[0]!.frame(frame);
    expect(errors).toHaveBeenCalledWith('RUNTIME_UNKNOWN');
    expect(received).not.toHaveBeenCalled();
    expect(socket.send({ type: 'input', data: 'blocked' })).toBe(false);
    socket.close();
  });
  it('ignores delayed frames from a retired transport and rejects a replacement runtime after valid attach', () => {
    const wire = connection();
    const errors = vi.fn();
    const received = vi.fn();
    const socket = new PtySocket({
      uri: 'http://localhost:3001/terminal',
      query,
      socketFactory: wire.factory,
      onFrame: received,
      onState: vi.fn(),
      onHandshakeError: errors,
    });
    socket.connect();
    const old = wire.transports[0]!;
    old.connected();
    old.frame(ready);
    socket.reconnect();
    const current = wire.transports[1]!;
    current.connected();
    received.mockClear();
    old.frame({ type: 'data', data: 'late bytes' });
    old.frame(ready);
    expect(received).not.toHaveBeenCalled();
    current.frame({ ...ready, runtimeIdentity: 'replacement-process' });
    expect(errors).toHaveBeenLastCalledWith('RUNTIME_UNKNOWN');
    expect(socket.send({ type: 'input', data: 'blocked' })).toBe(false);
    socket.close();
  });
  it('15 seconds is a lightweight retry observation, never a task terminal state', () => {
    vi.useFakeTimers();
    const wire = connection();
    const onFrame = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSandboxTerminalSocket({
        uri: 'http://localhost:3001/terminal',
        query,
        onFrame,
        socketFactory: wire.factory,
      }),
    );
    act(() => {
      wire.transports[0]!.connected();
    });
    expect(result.current.connState).toBe('open');
    expect(result.current.attachmentState).toBe('restoring');
    act(() => {
      vi.advanceTimersByTime(15_001);
    });
    expect(result.current.restoringSlow).toBe(true);
    expect(result.current.send({ type: 'input', data: 'not queued' })).toBe(false);
    expect(onFrame).not.toHaveBeenCalled();
    act(() => {
      wire.transports[0]!.frame(ready);
    });
    expect(result.current.attachmentState).toBe('attached');
    expect(result.current.restoringSlow).toBe(false);
    unmount();
  });
  it.each(['AUTH_EXPIRED', 'PROTOCOL_INCOMPATIBLE', 'RUNTIME_UNKNOWN', 'TERMINAL_GONE'] as const)(
    'keeps %s separate from task exit',
    (code) => {
      const wire = connection();
      const onFrame = vi.fn();
      const unauthorized = vi.fn();
      const { result, unmount } = renderHook(() =>
        useSandboxTerminalSocket({
          uri: 'http://localhost:3001/terminal',
          query,
          onFrame,
          socketFactory: wire.factory,
          onUnauthorized: unauthorized,
        }),
      );
      act(() => {
        wire.transports[0]!.connected();
        wire.transports[0]!.frame({ type: 'error', code, sandboxId: 'sandbox-a' });
      });
      expect(result.current.attachmentState).toBe(
        code === 'AUTH_EXPIRED'
          ? 'auth-expired'
          : code === 'TERMINAL_GONE'
            ? 'gone'
            : code === 'PROTOCOL_INCOMPATIBLE'
              ? 'incompatible'
              : 'unconfirmed',
      );
      expect(result.current.canRetry).toBe(code === 'AUTH_EXPIRED' || code === 'RUNTIME_UNKNOWN');
      expect(unauthorized.mock.calls.length).toBe(code === 'AUTH_EXPIRED' ? 1 : 0);
      expect(onFrame.mock.calls.every(([frame]) => frame.type !== 'exit')).toBe(true);
      unmount();
    },
  );
});
describe('UPG F06/C03 public terminal bookmark restoration', () => {
  const config = buildTerminalSocketConfig('http://localhost:3001', 'sandbox-a');
  const identity = { instanceId: 'instance-a', userScope: 'viewer-a' };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <InstanceIdentityContext.Provider value={identity}>{children}</InstanceIdentityContext.Provider>
  );
  it('restores the originally selected second terminal and merges authenticated inventory without a create operation', () => {
    const key = terminalBookmarkKey(identity.instanceId, identity.userScope, 'sandbox-a');
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, terminalIdentity: ID2, kind: 'shell', ordinal: 2 }),
    );
    const { result } = renderHook(() => useTerminalSessions('sandbox-a', config), { wrapper });
    expect(result.current.restorationReady).toBe(true);
    const selected = result.current.tabs.find(
      (tab) => tab.sessionId === result.current.activeSessionId,
    );
    expect(selected?.socketConfig.query['terminalIdentity']).toBe(ID2);
    expect(selected?.socketConfig.query['shellId']).toBeUndefined();
    act(() => {
      result.current.receiveShellInventory(null);
    });
    expect(result.current.inventoryUnavailable).toBe(true);
    expect(result.current.activeSessionId).toBe(selected?.sessionId);
    act(() => {
      result.current.receiveShellInventory([
        { shellId: 'credential-a', terminalIdentity: ID },
        { shellId: 'credential-b', terminalIdentity: ID2 },
      ]);
    });
    expect(result.current.tabs.filter((tab) => tab.terminalIdentity === ID2)).toHaveLength(1);
    expect(result.current.activeSessionId).toBe(selected?.sessionId);
    expect(localStorage.getItem(key)).not.toContain('credential');
    expect(localStorage.getItem(key)).not.toContain('shellId');
    expect(partializeAppState(useAppStore.getState())).not.toHaveProperty('shellTabsOf');
    expect(
      useAppStore
        .getState()
        .shellTabsOf.get('sandbox-a')
        ?.find((tab) => tab.terminalIdentity === ID2)?.shellId,
    ).toBe('credential-b');
  });
  it('an empty inventory preserves the original bookmark instead of switching or making another terminal', () => {
    localStorage.setItem(
      terminalBookmarkKey('instance-a', 'viewer-a', 'sandbox-a'),
      JSON.stringify({ version: 1, terminalIdentity: ID2, kind: 'shell', ordinal: 2 }),
    );
    const { result } = renderHook(() => useTerminalSessions('sandbox-a', config), { wrapper });
    const original = result.current.activeSessionId;
    act(() => {
      result.current.receiveShellInventory([]);
    });
    expect(result.current.activeSessionId).toBe(original);
    expect(
      result.current.tabs.find((tab) => tab.sessionId === original)?.socketConfig.query[
        'terminalIdentity'
      ],
    ).toBe(ID2);
    expect(useAppStore.getState().shellTabSeqOf.get('sandbox-a')).toBe(2);
  });
  it('rejects credential-shaped or overbroad persisted records and isolates scopes', () => {
    expect(
      readTerminalBookmark(
        JSON.stringify({ version: 1, terminalIdentity: 'a'.repeat(32), kind: 'shell', ordinal: 2 }),
      ),
    ).toBeNull();
    expect(
      readTerminalBookmark(
        JSON.stringify({
          version: 1,
          terminalIdentity: ID2,
          kind: 'shell',
          ordinal: 2,
          shellId: 'credential',
        }),
      ),
    ).toBeNull();
    localStorage.setItem(
      terminalBookmarkKey('other-instance', 'viewer-a', 'sandbox-a'),
      JSON.stringify({ version: 1, terminalIdentity: ID2, kind: 'shell', ordinal: 2 }),
    );
    const { result } = renderHook(() => useTerminalSessions('sandbox-a', config), { wrapper });
    expect(result.current.activeSessionId).toBe('sandbox-a:0');
    expect(result.current.tabs).toHaveLength(1);
  });
});
