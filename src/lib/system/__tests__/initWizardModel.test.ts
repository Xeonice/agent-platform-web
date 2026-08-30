// 向导骨架与 Step4 资源确认（F21-8 §6 / P21-8 §2/§7）。
import { describe, it, expect } from 'vitest';
import {
  initSteps,
  nextStep,
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

describe('四步指示与步进', () => {
  it('出网全通过 ⇒ 从 Step1 直接跳到 Step3（代理那一步不进流程）', () => {
    expect(nextStep('connectivity', false)).toBe('preset-image');
  });

  it('出网有失败项 ⇒ Step1 → Step2 → Step3 → Step4', () => {
    expect(nextStep('connectivity', true)).toBe('proxy');
    expect(nextStep('proxy', true)).toBe('preset-image');
    expect(nextStep('preset-image', true)).toBe('resource');
    expect(nextStep('resource', true)).toBeUndefined();
  });

  it('⭐ 代理不进流程时它**仍然显示在指示条上**（标可跳过），只是不被走到', () => {
    // ⚠️ 隐藏它会让步数在检测结果变化时跳动（3 步变 4 步），用户不知道自己在第几步。
    const steps = initSteps('connectivity', false);
    expect(steps.map((s) => s.key)).toEqual(['connectivity', 'proxy', 'preset-image', 'resource']);
    expect(steps.find((s) => s.key === 'proxy')?.active).toBe(false);
  });

  it('⭐ 被跳过的代理步**不打 ✅**（它根本没被走到，标成"已完成"是句小谎）', () => {
    const steps = initSteps('preset-image', false);
    expect(steps.find((s) => s.key === 'connectivity')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'proxy')?.done).toBe(false);
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
  it('预留 15% 只影响调度上限（分母仍是总容量，P21-8 §7）', () => {
    expect(schedulableBytes(16 * GB, 15)).toBeCloseTo(13.6 * GB, 0);
    const model = resourceConfirmModel(resources());
    expect(model?.reservedText).toContain('预留总容量的 15%');
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

  it('磁盘那行带真实构成说明（预制镜像 / rootfs 缓存 / 每 Task 副本）', () => {
    const model = resourceConfirmModel(resources());
    const note = model?.rows.find((r) => r.id === 'disk')?.noteText ?? '';
    expect(note).toContain('13GB');
    expect(note).toContain('rootfs');
    expect(note).toContain('工作区副本');
  });

  it('没有资源数据 ⇒ undefined（view 据此渲染"正在读取"，⛔ 不是 0%）', () => {
    expect(resourceConfirmModel(undefined)).toBeUndefined();
  });
});
