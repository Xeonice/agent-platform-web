import { describe, it, expect } from 'vitest';
import { runtimePreinstalled, selectableImages } from '../selectableImages';

/**
 * ★ 本文件取代 `filterImagesForRuntime.test.ts`。旧文件里有一条断言写着
 * 「runtime 不在 supportedRuntimes 里就不出现」——**那条断言守着的是一条错规则**。
 *
 * ⚠️ 这不是「改测试让它过」。旧规则是被**真机实测**否掉的：给平台预制镜像打上诚实标签
 * （上游预装 codex、没有 claude-code）之后，`?runtimeId=claude-code` 返回 0 张，
 * 而那是平台唯一的镜像 —— claude-code 任务建不出来，⚠️ 档那句「需现装 12.5 分钟」
 * 也永远没有出场机会。**旧断言绿着，而产品是坏的。**
 *
 * 新规则的依据是一条被保证的能力：自定义镜像必须基于带 node 的平台预制镜像
 * （血统由 `rootfs.diff_ids` 前缀校验，04 §7）⇒ 任何合规镜像一定装得上任何 runtime。
 */
interface Img {
  id: string;
  isActive: boolean;
  validationStatus: string;
  supportedRuntimes: readonly string[];
}
const img = (id: string, o: Partial<Img> = {}): Img => ({
  id,
  isActive: true,
  validationStatus: 'valid',
  supportedRuntimes: ['codex'],
  ...o,
});

describe('selectableImages：可选性与 runtime 无关', () => {
  it('⭐ 只预装 codex 的镜像，选 claude-code 时**仍然可选**（旧规则会把它踢掉）', () => {
    const all = [img('platform', { supportedRuntimes: ['codex'] })];
    // MUTATION: 在 selectableImages 里加回 `supportedRuntimes.includes(runtime)`
    // ⇒ 本条红。它钉的就是那条被实测否掉的规则不许长回来。
    expect(selectableImages(all).map((i) => i.id)).toEqual(['platform']);
  });

  it('⚠️ 警告级镜像仍可选（选项旁另给后果说明，不是把它踢出去）', () => {
    const all = [img('warn', { validationStatus: 'warning' })];
    expect(selectableImages(all)).toHaveLength(1);
  });

  it('❌ 无效镜像不可选', () => {
    expect(selectableImages([img('bad', { validationStatus: 'invalid' })])).toEqual([]);
  });

  it('禁用后可选集合少一个（「禁用后向导下拉自动移除」的纯函数那一半）', () => {
    const all = [img('a'), img('b', { isActive: false })];
    expect(selectableImages(all).map((i) => i.id)).toEqual(['a']);
  });

  it('按**白名单**放行而不是「≠ invalid」：13 §2.4 的 pending 默认值不许漏进下拉', () => {
    // MUTATION: 改成 `validationStatus !== 'invalid'` ⇒ 本条红。
    expect(selectableImages([img('p', { validationStatus: 'pending' })])).toEqual([]);
  });

  it('空数组不抛错', () => {
    expect(selectableImages([])).toEqual([]);
  });
});

describe('runtimePreinstalled：只标注后果，不决定可选性', () => {
  it('预装了 ⇒ true；没预装 ⇒ false（含义是「要现装」，不是「不能跑」）', () => {
    const platform = img('p', { supportedRuntimes: ['codex'] });
    expect(runtimePreinstalled(platform, 'codex')).toBe(true);
    expect(runtimePreinstalled(platform, 'claude-code')).toBe(false);
    // ⭐ 两个断言合起来才是本轮的产品形态：**没预装的那个仍然出现在可选集合里**，
    //    只是选项旁多一句「需现装约 12.5 分钟」。
    expect(selectableImages([platform])).toHaveLength(1);
  });
});
