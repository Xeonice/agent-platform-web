// 向导骨架与 Step4 资源确认（F21-8 §6 / P21-8 §2/§7）。
import { describe, it, expect } from 'vitest';
import {
  initSteps,
  nextStep,
  previousStep,
  resourceConfirmModel,
  schedulableBytes,
  toProxyUpdate,
} from '@/lib/system/initWizardModel';
import type { SystemResourcesDto } from '@/types/system';

const GB = 1024 ** 3;

function resources(over: Partial<SystemResourcesDto> = {}): SystemResourcesDto {
  return {
    cpu: { cores: 10, loadAvg1m: 3.7, usedPercent: 37, level: 'ok' },
    ram: { totalBytes: 32 * GB, usedBytes: 24 * GB, usedPercent: 76.7, level: 'ok' },
    disk: {
      path: '/data',
      totalBytes: 200 * GB,
      usedBytes: 120 * GB,
      availableBytes: 80 * GB,
      usedPercent: 60,
      level: 'ok',
      reservedPercent: 15,
    },
    retainedVolumes: { count: 0, totalBytes: 0, percentOfDisk: 0, level: 'ok', truncated: false },
    activeTasks: 0,
    ...over,
  };
}

describe('五步指示与步进', () => {
  it('出网全通过 ⇒ 从 Step1 直接跳到 Step3（代理那一步不进流程）', () => {
    expect(nextStep('connectivity', false)).toBe('preset-image');
  });

  it('出网有失败项 ⇒ Step1 → Step2 → Step3 → Step4 → Step5', () => {
    expect(nextStep('connectivity', true)).toBe('proxy');
    expect(nextStep('proxy', true)).toBe('preset-image');
    // ⚠️ 订阅排在镜像之后、资源之前（P21-8 §2）：它是唯一要用户离开本页的一步，
    //    放在平台能自己搞定的事全部落定之后 —— 否则 15 分钟的设备码会跨过镜像拉取。
    expect(nextStep('preset-image', true)).toBe('subscription');
    expect(nextStep('subscription', true)).toBe('resource');
    expect(nextStep('resource', true)).toBeUndefined();
  });

  /**
   * ⭐ **[上一步] 永远回得去代理那一步 —— 它是那一步唯一的入口。**
   *
   * ⛔ 这条用例此前**完全不存在**（`previousStep` 一条都没有），于是"两个方向都跳过"
   * 这个缺陷能一直躺着：指示条上看得见代理步，却没有任何路径点得进去。
   *
   * ⚠️ 2026-09-14 真机撞上：连通性检查全绿（ghcr.io 1.4 秒应答）⇒ `proxyActive=false`
   * ⇒ 向导判定"不需要代理"；而机器的**带宽只有 200 KB/s**，320 MB 的镜像拉到 84% 断掉。
   * 唯一能救的配置项在界面上无法抵达。**可达 ≠ 够用**，而判据只看得见"可达"。
   *
   * ⇒ 刻意的不对称：`nextStep` 照旧跳过（正常机器不必多点一次"跳过"），
   *   `previousStep` **一步都不跳**。
   *
   * MUTATION：给 `previousStep` 加回 `if (key === 'proxy' && !proxyActive) continue;`
   * ⇒ 下面第一条红。
   */
  it('⭐ [上一步] ⛔ 不跳过代理步 —— 出网全通过时它是那一步唯一的入口', () => {
    // 出网全通过（proxyActive=false）：自动前进跳过它……
    expect(nextStep('connectivity', false)).toBe('preset-image');
    // ……但从第 3 步往回走，⛔ 必须落在代理那一步，不是直接回到第 1 步。
    expect(previousStep('preset-image', false)).toBe('proxy');
    // 再往回才是第 1 步。
    expect(previousStep('proxy', false)).toBe('connectivity');
  });

  it('[上一步] 在检测有失败项时同样逐步回退（与上一条同一条路径）', () => {
    expect(previousStep('preset-image', true)).toBe('proxy');
    expect(previousStep('proxy', true)).toBe('connectivity');
  });

  it('[上一步] 在第一步时回 undefined（没有更靠前的步）', () => {
    expect(previousStep('connectivity', false)).toBeUndefined();
    expect(previousStep('connectivity', true)).toBeUndefined();
  });

  it('⛔ 订阅**不因为出网跳过代理而被跳过** —— 只有代理那一格是条件性的', () => {
    expect(nextStep('preset-image', false)).toBe('subscription');
    expect(nextStep('subscription', false)).toBe('resource');
  });

  it('⭐ 代理不进流程时它**仍然显示在指示条上**（标可跳过），只是不被走到', () => {
    // ⚠️ 隐藏它会让步数在检测结果变化时跳动（3 步变 4 步），用户不知道自己在第几步。
    const steps = initSteps('connectivity', false);
    expect(steps.map((s) => s.key)).toEqual([
      'connectivity',
      'proxy',
      'preset-image',
      'subscription',
      'resource',
    ]);
    expect(steps.find((s) => s.key === 'proxy')?.active).toBe(false);
  });

  it('⭐ 被跳过的代理步**不打 ✅**（它根本没被走到，标成"已完成"是句小谎）', () => {
    const steps = initSteps('preset-image', false);
    expect(steps.find((s) => s.key === 'connectivity')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'proxy')?.done).toBe(false);
  });

  /**
   * ⭐ **走过 ≠ 达成**（2026-09-09 真机发现）。
   *
   * ⛔ 上一版 `done: i < currentIndex` 是纯位置判定：镜像那一步只要点了
   * [稍后配置，下一步] 就被打上 ✅ —— 而同一屏上那张卡片正写着「尚未在本机铺开」。
   * **指示条与卡片矛盾时，用户信的是那个更醒目的 ✅**，于是他以为镜像备好了，
   * 直到第一个任务卡在拉镜像上才发现。
   *
   * MUTATION: 把 `achieved[key] !== false` 去掉 ⇒ 第一条红。
   */
  it('⭐ 有判据的步：没达成就不许打 ✅，且要标成「走过没达成」', () => {
    const image = initSteps('subscription', false, { 'preset-image': false }).find(
      (s) => s.key === 'preset-image',
    );
    expect(image?.done).toBe(false);
    expect(image?.skipped).toBe(true);
  });

  it('有判据的步达成了 ⇒ 照常 ✅', () => {
    const image = initSteps('subscription', false, { 'preset-image': true }).find(
      (s) => s.key === 'preset-image',
    );
    expect(image?.done).toBe(true);
    expect(image?.skipped).toBe(false);
  });

  it('没判据的步（缺席）⇒ 仍按位置算 —— ⛔ 不要逼调用方为它编一个布尔值', () => {
    const steps = initSteps('subscription', false, {});
    expect(steps.find((s) => s.key === 'connectivity')?.done).toBe(true);
  });

  it('⛔ 还没走到的步既不是 done 也不是 skipped（混在一起就看不出跳过了什么）', () => {
    const image = initSteps('connectivity', false, { 'preset-image': false }).find(
      (s) => s.key === 'preset-image',
    );
    expect(image?.done).toBe(false);
    expect(image?.skipped).toBe(false);
  });

  it('已走过的步标 done、当前步标 current', () => {
    const steps = initSteps('preset-image', true);
    expect(steps.filter((s) => s.done).map((s) => s.key)).toEqual(['connectivity', 'proxy']);
    expect(steps.find((s) => s.current)?.key).toBe('preset-image');
  });
});

describe('toProxyUpdate（`PUT /settings` 的三态请求体）', () => {
  it('有值 ⇒ 只带非空字段', () => {
    expect(
      toProxyUpdate({ httpProxy: 'http://127.0.0.1:7890', httpsProxy: '', noProxy: 'localhost' }),
    ).toEqual({ proxyConfig: { httpProxy: 'http://127.0.0.1:7890', noProxy: 'localhost' } });
  });

  it('⭐ 单个字段留空 ⇒ **不发这个键**（发空串会被后端当成一个空代理串去探测）', () => {
    const body = toProxyUpdate({ httpProxy: 'http://a', httpsProxy: '   ', noProxy: '' });
    expect(body.proxyConfig).not.toBeNull();
    expect(body.proxyConfig).not.toHaveProperty('httpsProxy');
    expect(body.proxyConfig).not.toHaveProperty('noProxy');
  });

  it('三个都留空 ⇒ `proxyConfig: null`（= 清空；表单从已存配置回填，清空是明确意图）', () => {
    expect(toProxyUpdate({ httpProxy: '', httpsProxy: '', noProxy: '' })).toEqual({
      proxyConfig: null,
    });
  });
});

describe('Step4 资源确认', () => {
  const noteOf = (m: ReturnType<typeof resourceConfirmModel>): string =>
    m?.rows.find((r) => r.id === 'disk')?.noteText ?? '';

  it('预留比例只影响可调度上限（分母仍是总容量），且比例取后端下发的值', () => {
    expect(schedulableBytes(16 * GB, 15)).toBeCloseTo(13.6 * GB, 0);
    const model = resourceConfirmModel(resources());
    expect(model?.reservedText).toContain('总容量的 15%');
    expect(model?.reservedText).toContain('进度条分母仍然是总容量');
  });

  /**
   * ⛔ **界面上任何一处出现的预留百分比都必须来自后端**（2026-09 修）。
   * 向导第 5 步的标题句此前硬编码「预留 15%」，而同一屏的 `reservedText` 取的是
   * `dto.disk.reservedPercent` —— 后端一改这个值，标题那句当场变假。
   * MUTATION：把 `reservedText` 里的 `${dto.disk.reservedPercent}` 换回字面量 15 ⇒ 本条红。
   */
  it('⭐ 预留百分比跟着后端走，不是写死的 15', () => {
    const model = resourceConfirmModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 200 * GB,
          usedBytes: 20 * GB,
          availableBytes: 180 * GB,
          usedPercent: 10,
          level: 'ok',
          reservedPercent: 25,
        },
      }),
    );
    expect(model?.reservedText).toContain('总容量的 25%');
    expect(model?.reservedText).not.toContain('15%');
  });

  it('⭐ 磁盘可调度上限必须跟一句「与当前可用取小」', () => {
    // ⚠️ 真机实测发现的：预留按**总容量**算（公式是产品定的），于是一块 926GB、只剩 28.9GB
    //    的盘会在「可用 28.9 GB ⚠️」下面紧跟着一句「磁盘可调度上限 787.4 GB」——
    //    两个数字直接打架，而大的那个更醒目。公式不改，把边界说出来。
    const model = resourceConfirmModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 926 * GB,
          usedBytes: 897 * GB,
          availableBytes: 29 * GB,
          usedPercent: 96.8,
          level: 'critical',
          reservedPercent: 15,
        },
      }),
    );
    expect(model?.reservedText).toContain('与当前可用的 29 GB 取小');
  });

  it('资源充足 ⇒ 不给偏低提示', () => {
    const model = resourceConfirmModel(resources());
    expect(model?.low).toBe(false);
    expect(model?.lowText).toBeUndefined();
  });

  it('CPU < 2 核 ⇒ 偏低（阈值 P21-8 §2）', () => {
    const model = resourceConfirmModel(
      resources({ cpu: { cores: 1, loadAvg1m: 0.2, usedPercent: 20, level: 'ok' } }),
    );
    expect(model?.rows.find((r) => r.id === 'cpu')?.low).toBe(true);
    expect(model?.low).toBe(true);
  });

  it('RAM < 4GB ⇒ 偏低', () => {
    const model = resourceConfirmModel(
      resources({
        ram: { totalBytes: 2 * GB, usedBytes: 1 * GB, usedPercent: 50, level: 'ok' },
      }),
    );
    expect(model?.rows.find((r) => r.id === 'ram')?.low).toBe(true);
  });

  it('⭐ 磁盘按**可用**判偏低，不是总量 —— 一块 926GB、只剩 29GB 的盘必须报偏低', () => {
    // ⚠️ 按 totalBytes 判的写法会把本机这台（实测 total 926GB / available 29GB）报成
    //    「磁盘 926 GB ✅」，正是 P21-8 §2 点名要避免的那种谎（"只说磁盘 200G ✅ 会让人
    //    以为宽裕，而预制镜像 13GB + rootfs 缓存 31GB + 每 Task 一份副本是持续增长的"）。
    const model = resourceConfirmModel(
      resources({
        disk: {
          path: '/data',
          totalBytes: 926 * GB,
          usedBytes: 897 * GB,
          availableBytes: 29 * GB,
          usedPercent: 96.8,
          level: 'critical',
          reservedPercent: 15,
        },
      }),
    );
    const disk = model?.rows.find((r) => r.id === 'disk');
    expect(disk?.low).toBe(true);
    // 两个数都要看得见：只给可用又对不上系统里看到的容量。
    expect(disk?.valueText).toContain('可用');
    expect(disk?.valueText).toContain('总');
  });

  it('⭐ 偏低只是黄字：文案必须写明「仍可继续」（做成门会让小机器装不起来）', () => {
    const model = resourceConfirmModel(
      resources({ cpu: { cores: 1, loadAvg1m: 0.2, usedPercent: 20, level: 'ok' } }),
    );
    expect(model?.lowText).toContain('仍可继续');
  });

  it('磁盘那行带真实构成说明（预制镜像 / 沙箱环境的镜像缓存 / 每个任务一份副本）', () => {
    const note = noteOf(resourceConfirmModel(resources(), 'boxlite'));
    expect(note).toContain('预制镜像');
    expect(note).toContain('镜像缓存');
    expect(note).toContain('工作区副本');
    // ⛔ `rootfs` / 「铺开」是内部词，不上屏（术语统一口径）。
    expect(note).not.toContain('rootfs');
    expect(note).not.toContain('铺开');
  });

  /**
   * ⭐ **「仍可继续」必须前置**（2026-09 修）。它排在句尾时，用户读到前半句
   * 「资源配置较低，建议增加后再投入使用」就已经以为自己被卡住了 —— 而这一档从来不是门。
   * MUTATION：把 `lowText` 的「仍可继续 ——」挪回句尾 ⇒ 本条红。
   */
  it('⭐「仍可继续」出现在句首，不是排在句尾', () => {
    const model = resourceConfirmModel(
      resources({ cpu: { cores: 1, loadAvg1m: 0.2, usedPercent: 20, level: 'ok' } }),
    );
    expect(model?.lowText?.startsWith('仍可继续')).toBe(true);
  });

  /**
   * ⭐ **磁盘构成的数字必须按档说**（2026-09-09 真机发现）。
   *
   * ⛔ 上一版恒为「预制镜像约 13GB · boxlite 的 rootfs 缓存实测约 31GB」，而这条用例
   * **钉的正是那个 13GB** —— 它把一个属于 aio 档的数字钉成了不变量。macOS 的默认档是
   * boxlite（镜像铺开后约 1.3GB），差一个数量级，而这句话的全部用途就是帮人判断磁盘够不够。
   *
   * ⚠️ 现在钉的是**行为**（按档分岔、未知档不点数字），不是某一个字面量。
   *
   * MUTATION: 把 `diskCompositionFor` 改回恒定字符串 ⇒ 前两条红。
   */
  it('⭐ boxlite 档：说自己那一档的量级，⛔ 不许出现 aio 档的 13GB', () => {
    const note = noteOf(resourceConfirmModel(resources(), 'boxlite'));
    expect(note).toContain('1.3GB');
    expect(note).not.toContain('13GB');
  });

  it('aio 档：给 13GB，且⛔ 不提「boxlite 的 rootfs 缓存」（那一档没有 boxlite）', () => {
    const note = noteOf(resourceConfirmModel(resources(), 'aio'));
    expect(note).toContain('13GB');
    expect(note).not.toContain('boxlite');
  });

  it('⭐ 档位未知（providers 还没回来）⇒ 说构成不说量级，⛔ 不许挑一档当默认', () => {
    const note = noteOf(resourceConfirmModel(resources()));
    expect(note).toContain('预制镜像');
    expect(note).not.toContain('GB');
  });

  it('两处用法同源：行内说明与 `diskCompositionText` 必须是同一句', () => {
    const model = resourceConfirmModel(resources(), 'boxlite');
    expect(model?.diskCompositionText).toBe(noteOf(model));
  });

  it('没有资源数据 ⇒ undefined（view 据此渲染"正在读取"，⛔ 不是 0%）', () => {
    expect(resourceConfirmModel(undefined)).toBeUndefined();
  });
});
