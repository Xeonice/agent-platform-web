import { describe, expect, it, vi } from 'vitest';
import { openAuthPage, type OpenAuthPageDeps } from '../openAuthPage';

const URL = 'https://auth.openai.com/codex/device';
const CODE = 'ABCD-2WXYZ';

function deps(over: Partial<OpenAuthPageDeps> = {}): OpenAuthPageDeps {
  return {
    open: () => ({}),
    writeClipboard: () => Promise.resolve(),
    ...over,
  };
}

describe('openAuthPage', () => {
  it('开标签页 + 复制设备码', async () => {
    const open = vi.fn(() => ({}));
    const writeClipboard = vi.fn(() => Promise.resolve());
    const r = await openAuthPage(URL, CODE, deps({ open, writeClipboard }));
    expect(r).toEqual({ opened: true, copied: true });
    expect(open).toHaveBeenCalledWith(URL, '_blank', 'noopener,noreferrer');
    expect(writeClipboard).toHaveBeenCalledWith(CODE);
  });

  it('⛔ `noopener` 不能省 —— 不带它新标签页能把原页面导走（reverse tabnabbing）', async () => {
    const open: OpenAuthPageDeps['open'] = vi.fn(() => ({}));
    await openAuthPage(URL, CODE, deps({ open }));
    const features = vi.mocked(open).mock.calls[0]?.[2];
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
  });

  it('⛔ 返回 null = 被拦了，必须如实报 —— 静默当成开了，用户会盯着「等待授权中」等到码过期', async () => {
    const r = await openAuthPage(URL, CODE, deps({ open: () => null }));
    expect(r.opened).toBe(false);
  });

  it('⛔ 剪贴板抛了不影响标签页 —— 为一次锦上添花的复制中断主流程是本末倒置', async () => {
    const r = await openAuthPage(
      URL,
      CODE,
      deps({ writeClipboard: () => Promise.reject(new Error('NotAllowedError')) }),
    );
    expect(r).toEqual({ opened: true, copied: false });
  });

  it('⛔ 被拦了**照样复制** —— 用户接下来多半手动开，码在剪贴板里仍然有用', async () => {
    const writeClipboard = vi.fn(() => Promise.resolve());
    const r = await openAuthPage(URL, CODE, deps({ open: () => null, writeClipboard }));
    expect(writeClipboard).toHaveBeenCalledWith(CODE);
    expect(r).toEqual({ opened: false, copied: true });
  });

  it('⛔ **先开后复制**：反过来的话那一次 await 会让 window.open 失去用户手势', async () => {
    const order: string[] = [];
    await openAuthPage(
      URL,
      CODE,
      deps({
        open: () => {
          order.push('open');
          return {};
        },
        writeClipboard: () => {
          order.push('clipboard');
          return Promise.resolve();
        },
      }),
    );
    expect(order).toEqual(['open', 'clipboard']);
  });

  it('两种失败互相独立（四种组合都说得出）', async () => {
    const ok = () => Promise.resolve();
    const bad = () => Promise.reject(new Error('x'));
    expect(await openAuthPage(URL, CODE, deps({ writeClipboard: ok }))).toEqual({
      opened: true,
      copied: true,
    });
    expect(await openAuthPage(URL, CODE, deps({ writeClipboard: bad }))).toEqual({
      opened: true,
      copied: false,
    });
    expect(await openAuthPage(URL, CODE, deps({ open: () => null, writeClipboard: ok }))).toEqual({
      opened: false,
      copied: true,
    });
    expect(await openAuthPage(URL, CODE, deps({ open: () => null, writeClipboard: bad }))).toEqual({
      opened: false,
      copied: false,
    });
  });
});
