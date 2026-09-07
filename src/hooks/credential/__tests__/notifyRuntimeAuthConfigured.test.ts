// 授权成功后必须做的两件事 —— 2026-09-07 实测缺陷：向导那份只收起了面板。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { notifyRuntimeAuthConfigured } from '@/hooks/credential/useRuntimeAuthMutations';
import { runtimeKeys, runtimeAuthKeys } from '@/hooks/credential/useRuntimes';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * ── 它守的是什么 ────────────────────────────────────────────────────────────
 * 设备码授权成功、凭证已落库（后端 `CredentialStored`），而**界面上面板无声无息地
 * 关掉了**：既没刷新状态、也没有任何「配置完成」的提示。用户唯一能确认自己成功了的
 * 办法是刷新整个页面。
 *
 * ⚠️ 根因是「怎么算授权成功」在**两处宿主各写一遍**，其中向导那份漏了这两件事 ——
 * 而且还带着一句「状态由 invalidate 驱动刷新」的注释，**描述的是它没做的事**。
 *
 * ⚠️ 参照实现（设置页）此前只被测到 invalidate，**toast 一直没人钉** —— 所以
 * 「少一件事」这个缺陷在两处都是隐形的。本文件把两件都钉上。
 */
describe('notifyRuntimeAuthConfigured：授权成功必须做的两件事', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear();
  });

  it('⭐ ① 刷新 runtime 两族 —— 不刷新,行会一直停在「未配置」', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(client, 'invalidateQueries');
    notifyRuntimeAuthConfigured(client);
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeKeys.list() });
    expect(spy).toHaveBeenCalledWith({ queryKey: runtimeAuthKeys.all() });
  });

  it('⭐ ② 给用户一个看得见的提示 —— 缺了它,成功与失败在界面上长得一模一样', () => {
    // MUTATION: 删掉 `toast.success(message)` ⇒ 本条红。
    //           这正是向导那份漏掉、而旧测试没能发现的那一件。
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    notifyRuntimeAuthConfigured(client);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe('凭证已更新');
  });

  it('宿主可以给自己的措辞（向导是首次配置,不是「更新」）', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    notifyRuntimeAuthConfigured(client, '凭证已配置');
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe('凭证已配置');
  });
});
