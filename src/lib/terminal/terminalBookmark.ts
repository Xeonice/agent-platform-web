import type { TerminalBookmark } from '@/types/terminal';
export const TERMINAL_BOOKMARK_PREFIX = 'ap.terminal-bookmark.v1:';
export function terminalBookmarkKey(
  instanceId: string,
  userScope: string,
  sandboxId: string,
): string {
  return `${TERMINAL_BOOKMARK_PREFIX}${encodeURIComponent(instanceId)}:${encodeURIComponent(userScope)}:${encodeURIComponent(sandboxId)}`;
}
export function readTerminalBookmark(raw: string | null): TerminalBookmark | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('terminalIdentity' in value) ||
      typeof value.terminalIdentity !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.terminalIdentity,
      ) ||
      !('kind' in value) ||
      !['agent', 'shell', 'runtime'].includes(String(value.kind)) ||
      !('ordinal' in value) ||
      typeof value.ordinal !== 'number' ||
      !Number.isSafeInteger(value.ordinal) ||
      value.ordinal < 0 ||
      Object.keys(value).some(
        (key) => !['version', 'terminalIdentity', 'kind', 'ordinal', 'runtimeId'].includes(key),
      )
    )
      return null;
    if (value.kind !== 'agent' && value.kind !== 'shell' && value.kind !== 'runtime') return null;
    if (
      'runtimeId' in value &&
      (typeof value.runtimeId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value.runtimeId))
    )
      return null;
    const bookmark: TerminalBookmark = {
      version: 1,
      terminalIdentity: value.terminalIdentity,
      kind: value.kind,
      ordinal: value.ordinal,
    };
    if ('runtimeId' in value && typeof value.runtimeId === 'string')
      bookmark.runtimeId = value.runtimeId;
    return bookmark;
  } catch {
    return null;
  }
}
