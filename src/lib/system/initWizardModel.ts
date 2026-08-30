// 向导骨架（四步指示）与 Step4「资源池确认」的视图模型（F21-8 §2/§6 · P21-8 §2/§7）。
//
// ⚠️ **三条纪律：**
//
//  ① **「资源偏低」不是门。** CPU<2 核 / RAM<4GB / 可用磁盘<50GB 命中时给黄色 ⚠️ 与一句
//     建议，**仍可继续**（P21-8 §2）。把它做成 disabled 会让一台小机器根本装不起来，
//     而产品明确说了它只是提醒。
//
//  ② **磁盘按真实构成说，不能只报总量**（P21-8 §2，2026-08 实测）：预制镜像约 13GB、
//     boxlite 的 rootfs 缓存实测 31GB、每个 Task 还有一份工作区副本。「磁盘 200G ✅」
//     会让人以为宽裕，而这三项是持续增长的。
//     ⇒ 判定用 **`availableBytes`（可用）** 而不是 `totalBytes`：一块 926GB、已用 96.8% 的
//     盘只剩 29GB，报「926 GB ✅」正是文档点名要避免的那种谎。两个数都显示出来。
//
//  ③ **每维度的水位档次取后端 `level`，前端不重算**（与 F21-5 `resourceModel.ts` 同一条）：
//     CPU/RAM 用 80/95、磁盘用 75/90 是后端的两套阈值，抄第二份必然抄错。
//     本文件只加**向导独有**的那一档「偏低」（是容量判定，不是水位判定，两者正交）。
import { formatBytes } from '@/lib/system/resourceModel';
import type {
  InitStepKey,
  InitStepModel,
  ProxyFormValues,
  ResourceConfirmModel,
  ResourceConfirmRowModel,
} from '@/types/init';
import type { SystemResourcesDto, UpdateSystemSettingsDto } from '@/types/system';

// ————————————————————————————————————————————————————————————————
// 四步指示
// ————————————————————————————————————————————————————————————————

const STEP_ORDER: readonly InitStepKey[] = ['connectivity', 'proxy', 'preset-image', 'resource'];

const STEP_LABEL: Readonly<Record<InitStepKey, string>> = {
  connectivity: '出网检测',
  proxy: '代理配置',
  // ⚠️ 镜像排在资源之前是刻意的（P21-8 §2）：它依赖出网/代理（要拉镜像），而它的体积
  //    （约 13GB）又是资源池那一步的主要输入 —— 顺序反过来，磁盘评估就少算了最大的一块。
  'preset-image': '沙箱镜像',
  resource: '资源确认',
};

/**
 * Step2 只在**检测有失败项**时进入流程（P21-8 §2「检测失败时展开，否则可跳过」）。
 * `proxyActive` 为 false 时它仍然显示在指示条上（用户要看得到总共几步），但标成"可跳过"。
 */
export function initSteps(current: InitStepKey, proxyActive: boolean): InitStepModel[] {
  const currentIndex = STEP_ORDER.indexOf(current);
  return STEP_ORDER.map((key, i) => ({
    key,
    ordinal: i + 1,
    label: STEP_LABEL[key],
    active: key === 'proxy' ? proxyActive : true,
    // ⚠️ **被跳过的步不打 ✅**（实测发现的）：出网全通过时代理那一步根本没被走到，
    //    给它一个「✅ 已完成」是句小谎——用户会以为自己配过代理了。
    done: i < currentIndex && (key !== 'proxy' || proxyActive),
    current: key === current,
  }));
}

/** 下一步是谁。⚠️ 出网全通过时**跳过代理**（否则每台正常机器都要多点一次"跳过"）。 */
export function nextStep(current: InitStepKey, proxyActive: boolean): InitStepKey | undefined {
  const i = STEP_ORDER.indexOf(current);
  for (let n = i + 1; n < STEP_ORDER.length; n += 1) {
    const key = STEP_ORDER[n];
    if (key === undefined) return undefined;
    if (key === 'proxy' && !proxyActive) continue;
    return key;
  }
  return undefined;
}

/**
 * 上一步是谁（同样跳过不进流程的代理步）。`undefined` = 已在第一步。
 *
 * ⚠️ 与 `nextStep` 共用同一份 `STEP_ORDER`：在 hook 里再写一遍顺序数组，两份迟早会分叉
 * （典型是加第 5 步时只改了一处），而分叉的样子是 [上一步] 把人送到一个不该回去的地方。
 */
export function previousStep(current: InitStepKey, proxyActive: boolean): InitStepKey | undefined {
  const i = STEP_ORDER.indexOf(current);
  for (let n = i - 1; n >= 0; n -= 1) {
    const key = STEP_ORDER[n];
    if (key === undefined) return undefined;
    if (key === 'proxy' && !proxyActive) continue;
    return key;
  }
  return undefined;
}

// ————————————————————————————————————————————————————————————————
// Step2 · 代理表单 → `PUT /api/system/settings` 的三态请求体
// ————————————————————————————————————————————————————————————————

/**
 * `UpdateSystemSettingsDto.proxyConfig` 是**三态**：`null` = 清空、缺席 = 不改、有值 = 改成这个。
 *
 * ⚠️ `system.service.ts` 上那条警告说的是「⛔ 不许把『用户没动它』翻译成 `null`」——
 * 这里之所以**可以**在三个字段都空时发 `null`，是因为向导的表单是**从已存配置回填的**：
 * 用户看到的是当前值，把它清空就是"我要清掉代理"这个明确意图。
 * ⛔ 但单个字段的空串一律**不发**（而不是发 `''`）：那会把一个没填的字段存成空代理串，
 * 后端拿它去 `new URL('')` 只会得到一次莫名其妙的探测失败。
 */
export function toProxyUpdate(values: ProxyFormValues): UpdateSystemSettingsDto {
  const httpProxy = values.httpProxy.trim();
  const httpsProxy = values.httpsProxy.trim();
  const noProxy = values.noProxy.trim();
  if (httpProxy === '' && httpsProxy === '' && noProxy === '') return { proxyConfig: null };
  return {
    proxyConfig: {
      ...(httpProxy === '' ? {} : { httpProxy }),
      ...(httpsProxy === '' ? {} : { httpsProxy }),
      ...(noProxy === '' ? {} : { noProxy }),
    },
  };
}

// ————————————————————————————————————————————————————————————————
// Step4 · 资源池确认
// ————————————————————————————————————————————————————————————————

/** P21-8 §2 的三条偏低阈值。⚠️ 命中只给黄字，**不阻断**（①）。 */
export const LOW_CPU_CORES = 2;
export const LOW_RAM_BYTES = 4 * 1024 ** 3;
export const LOW_DISK_AVAILABLE_BYTES = 50 * 1024 ** 3;

/** P21-8 §7：可调度上限 = 总容量 × (1 − 预留)；进度条分母不变，仍是总容量。 */
export function schedulableBytes(totalBytes: number, reservedPercent: number): number {
  return totalBytes * (1 - reservedPercent / 100);
}

const DISK_COMPOSITION_TEXT =
  '磁盘会被三样东西持续吃掉：预制镜像约 13GB · boxlite 的 rootfs 缓存实测约 31GB · 每个 Task 一份工作区副本。所以这里看的是**可用容量**，不是总量。';

export function resourceConfirmModel(
  dto: SystemResourcesDto | undefined,
): ResourceConfirmModel | undefined {
  if (dto === undefined) return undefined;

  const cpuLow = dto.cpu.cores < LOW_CPU_CORES;
  const ramLow = dto.ram.totalBytes < LOW_RAM_BYTES;
  const diskLow = dto.disk.availableBytes < LOW_DISK_AVAILABLE_BYTES;

  const rows: ResourceConfirmRowModel[] = [
    {
      id: 'cpu',
      label: 'CPU',
      valueText: `${String(dto.cpu.cores)} 核 · 当前负载 ${String(dto.cpu.usedPercent)}%`,
      level: dto.cpu.level,
      low: cpuLow,
    },
    {
      id: 'ram',
      label: '内存',
      valueText: `${formatBytes(dto.ram.totalBytes)}（已用 ${String(dto.ram.usedPercent)}%）`,
      level: dto.ram.level,
      low: ramLow,
    },
    {
      id: 'disk',
      label: '磁盘',
      // ② 可用与总量**都给**：只给总量会让人以为宽裕，只给可用又对不上系统里看到的数字。
      valueText: `可用 ${formatBytes(dto.disk.availableBytes)} / 总 ${formatBytes(dto.disk.totalBytes)}（已用 ${String(dto.disk.usedPercent)}%，${dto.disk.path}）`,
      level: dto.disk.level,
      low: diskLow,
      noteText: DISK_COMPOSITION_TEXT,
    },
  ];

  const low = cpuLow || ramLow || diskLow;
  const lowParts: string[] = [];
  if (cpuLow)
    lowParts.push(`CPU ${String(dto.cpu.cores)} 核（建议 ≥ ${String(LOW_CPU_CORES)} 核）`);
  if (ramLow) lowParts.push(`内存 ${formatBytes(dto.ram.totalBytes)}（建议 ≥ 4 GB）`);
  if (diskLow) lowParts.push(`可用磁盘 ${formatBytes(dto.disk.availableBytes)}（建议 ≥ 50 GB）`);

  return {
    rows,
    low,
    // ⚠️ 「仍可继续」四个字不许省（①）：不写出来，用户会以为自己被卡住了。
    ...(low
      ? {
          lowText: `当前资源配置较低（${lowParts.join('、')}），建议增加后再投入使用 —— 仍可继续，只是任务并发与镜像铺开会更慢。`,
        }
      : {}),
    // ⚠️ **磁盘那一半必须跟一句「与当前可用取小」**（真机实测发现的）：预留是按**总容量**
    //    算的（P21-8 §7 的公式如此），于是一块 926GB、只剩 28.9GB 的盘会得到
    //    「磁盘可调度上限 787.4 GB」—— 它就写在「可用 28.9 GB ⚠️」的下一行，
    //    两个数字直接打架，而大的那个更醒目。公式不改（它是产品定的），把边界说出来。
    reservedText:
      `调度时预留总容量的 ${String(dto.disk.reservedPercent)}%（进度条分母仍是总容量，P21-8 §7）：` +
      `内存可调度上限 ${formatBytes(schedulableBytes(dto.ram.totalBytes, dto.disk.reservedPercent))}、` +
      `磁盘 ${formatBytes(schedulableBytes(dto.disk.totalBytes, dto.disk.reservedPercent))} —— ` +
      `磁盘还要与当前可用的 ${formatBytes(dto.disk.availableBytes)} 取小。`,
    diskCompositionText: DISK_COMPOSITION_TEXT,
  };
}
