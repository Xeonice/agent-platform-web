import type { TaskClientFrame, TerminalClientFrame } from '@/types/ws-protocol';
// The transport boundary is scripted; production decoding, sequence reducer and retry policy run.
export class Connection {
  connected: () => void = () => undefined;
  disconnected: () => void = () => undefined;
  failed: (error?: unknown) => void = () => undefined;
  received: (frame: unknown) => void = () => undefined;
  sent: (TaskClientFrame | TerminalClientFrame)[] = [];
  closed = false;
  onConnect(callback: () => void) {
    this.connected = callback;
  }
  onDisconnect(callback: () => void) {
    this.disconnected = callback;
  }
  onConnectError(callback: (error?: unknown) => void) {
    this.failed = callback;
  }
  onFrame(callback: (frame: unknown) => void) {
    this.received = callback;
  }
  emitFrame(frame: TaskClientFrame | TerminalClientFrame) {
    this.sent.push(frame);
  }
  disconnect() {
    this.closed = true;
  }
}
export const first = <T>(rows: T[]): T => {
  const item = rows[0];
  if (item === undefined) throw new Error('Connection was not created');
  return item;
};
