// 把 base + sandboxId 派生为 socket.io /terminal 连接描述（logic 归 hook/lib，container 不直接碰 lib，07 §3）。
import { useMemo } from 'react';
import { buildTerminalSocketConfig } from '@/lib/terminalSocket';
import type { TerminalSocketConfig } from '@/types/terminal';

export function useTerminalSocketConfig(
  base: string,
  sandboxId: string | null,
): TerminalSocketConfig | null {
  return useMemo(
    () => (sandboxId === null ? null : buildTerminalSocketConfig(base, sandboxId)),
    [base, sandboxId],
  );
}
