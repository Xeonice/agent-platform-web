// WS runtime-auth.status_changed → Query patch（15 §2.3）：失效 runtime 聚合 + 该 provider 状态。
import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { patchRuntimeAuthOnChange } from '@/hooks/useRuntimeAuthSync';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/useRuntimes';

describe('patchRuntimeAuthOnChange', () => {
  it('失效 runtimeKeys.list() + runtimeAuthKeys.status(provider)（两处同源）', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    patchRuntimeAuthOnChange(client, 'codex');
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeKeys.list() });
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeAuthKeys.status('codex') });
  });
});
