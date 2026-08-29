// Provider 状态卡的视图模型（F21-5 §6 / P21-5 §3：>1% ⚠️ · >10% ❌）。
//
// ⚠️ **「无样本」是第四档，不是 0%。** 后端在 `sampleSize === 0` 时**刻意让
// `recentFailureRate` 缺席**（0/0 不是 0%，`system-providers.service.ts` 写明了）。
// 前端要是把缺席 `?? 0` 掉，一台刚装好、这一小时没人用过的机器会显示「失败率 0% ✅」
// ——一个看起来是实测结论、实际上一个样本都没有的绿灯。这条与 `imageStaged`
// 「不知道不是 false」同源。
//
// ⚠️ **`healthy` 与阈值分档是两件事，都要用。** `healthy` 是后端按 ❌ 线（10%）给的布尔，
// 分档还要区分 ⚠️（>1%）；只看 `healthy` 会把 5% 失败率画成全绿。
import type {
  ProviderHealthDto,
  ProviderHealthLevel,
  ProviderRowModel,
  ProviderStatusCardModel,
  RuntimeRowModel,
  SystemProvidersDto,
} from '@/types/system';

/** ⚠️ 线与 ❌ 线（P21-5 §3）。取的是**比率**不是百分数：契约里 `recentFailureRate` 是 0–1。 */
const WARN_RATE = 0.01;
const ERROR_RATE = 0.1;

/**
 * 一个 provider 的健康档。
 *
 * 边界口径按产品原文「>1% ⚠️ · >10% ❌」——**严格大于**。0.9% 是 ok、1.1% 是 warning、
 * 10.1% 是 error；恰好 1% / 10% 落在下一档的"不越线"侧（与后端 `rate <= 0.1 ⇒ healthy`
 * 同向，两边不会在 10.0% 这个点上给出相反结论）。
 */
export function providerHealthLevel(p: ProviderHealthDto): ProviderHealthLevel {
  if (p.recentFailureRate === undefined) return 'no-sample';
  if (p.recentFailureRate > ERROR_RATE) return 'error';
  if (p.recentFailureRate > WARN_RATE) return 'warning';
  return 'ok';
}

function percentText(rate: number): string {
  return `${String(Math.round(rate * 1000) / 10)}%`;
}

/** `'最近 1h 失败率 5%（2/40）'` / `'无样本（最近 1h 没有沙箱创建记录）'`。 */
export function providerFailureText(p: ProviderHealthDto): string {
  if (p.recentFailureRate === undefined) {
    // ⛔ 这句里不许出现任何数字：一旦写成「失败率 0%（0/0）」，读者会把它当成一次实测。
    return '无样本（最近 1h 没有沙箱创建记录）';
  }
  return `最近 1h 失败率 ${percentText(p.recentFailureRate)}（${String(p.failureCount)}/${String(p.sampleSize)}）`;
}

/** 只列**已开启**的能力位——把 7 个位全列出来（含一串 false）没人读得下去。 */
export function capabilityText(capabilities: ProviderHealthDto['capabilities']): string {
  const enabled = Object.entries(capabilities)
    .filter(([, on]) => on)
    .map(([name]) => name);
  return enabled.length === 0 ? '无声明能力' : enabled.join(' · ');
}

function providerRow(p: ProviderHealthDto): ProviderRowModel {
  return {
    id: p.id,
    isDefault: p.isDefault,
    level: providerHealthLevel(p),
    failureText: providerFailureText(p),
    capabilityText: capabilityText(p.capabilities),
  };
}

function runtimeRow(r: SystemProvidersDto['runtimes'][number]): RuntimeRowModel {
  return {
    id: r.id,
    displayName: r.displayName,
    vendor: r.vendor,
    credentialConfigured: r.credentialConfigured,
    credentialText: r.credentialConfigured ? '凭证已配置' : '凭证未配置',
    authMethodsText: r.authMethods.length === 0 ? '—' : r.authMethods.join(' · '),
  };
}

/** `3600000 → '最近 1 小时'`。窗口由后端下发（`healthWindowMs`），前端不写死 1h。 */
export function healthWindowText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `最近 ${String(minutes)} 分钟`;
  const hours = Math.round(minutes / 6) / 10;
  return `最近 ${String(hours)} 小时`;
}

export function providerStatusModel(dto: SystemProvidersDto): ProviderStatusCardModel {
  return {
    providers: dto.providers.map(providerRow),
    runtimes: dto.runtimes.map(runtimeRow),
    imageSpecs: dto.imageSpecs.map((s) => ({ id: s.id, isDefault: s.isDefault })),
    windowText: healthWindowText(dto.healthWindowMs),
  };
}
