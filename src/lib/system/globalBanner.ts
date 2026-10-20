import { formatVolumeBytes } from '@/lib/project/retainedVolumeModel';
// 出网检查只描述声明目标的快照；不作为任何任务或 runtime 的准入条件。
// 平台状态读取失败和目标探测失败分别展示，不能相互替代。
import type {
  BannerId,
  BannerStackModel,
  GlobalBannerInput,
  GlobalBannerModel,
} from '@/types/banner';

/** 阻断提示先显示；治理提示由宿主记录的首次出现顺序稳定排序（REQ-WB-011）。 */
const BANNER_RANK: Readonly<Record<string, number>> = {
  'platform-state-unknown': 0,
  offline: 2,
  'disk-pressure': 2,
  'retained-pressure': 2,
  'automation-needs-attention': 2,
};

/** 没有数据 / 没有生产方时的兜底（`GlobalBannerInput.automation` 缺席即视为这个）。 */
const NO_AUTOMATION_ATTENTION: NonNullable<GlobalBannerInput['automation']> = {
  hasData: false,
  autoDisabledCount: 0,
  degradedCount: 0,
  needsAttention: false,
};

/** 判定 → 横幅清单（未排序、未剔除已关闭项）。纯函数，无 `Date.now()`。 */
export function globalBanners(input: GlobalBannerInput): GlobalBannerModel[] {
  const out: GlobalBannerModel[] = [];

  if (input.statusUnavailableReason !== undefined) {
    out.push({
      id: 'platform-state-unknown',
      severity: 'blocking',
      // ⚠️ 标题里**没有"离线"两个字**，理由见文件头 ①。
      title: '无法确认平台状态',
      description:
        `读取平台初始化状态失败（${input.statusUnavailableReason}）。` +
        '当前平台状态待确认；已有联网检查记录只反映其探测目标，不代表当前任务的连通性。',
      actionLabel: '查看系统状态',
    });
  }

  const { connectivity } = input;
  // ② `hasResult` 不可省：没有快照时我们不知道，而"不知道"不该报红，也不该被写成"通"。
  if (connectivity.hasResult && connectivity.verdict === 'offline') {
    out.push({
      id: 'offline',
      severity: 'warning',
      title: '联网检查未通过',
      // ③ 判定与这句话都来自 `connectivityCheckModel`，本文件不复制一份。
      description:
        connectivity.verdictText +
        (connectivity.checkedAtText ?? '检测时刻未提供，无法判断结果新旧。') +
        (connectivity.fromHistory ? '（上次检查记录）' : '（诊断检查记录）'),
      actionLabel: '重新检测',
    });
  }

  // ⚠️ 治理类（`lib/automation/automationAttention.ts` 是唯一的生产方，见该文件文末的
  // 接线记录）。文案**直接取它产出的三个字段**，不在这里另写一份——两份文案迟早分叉。
  const automation = input.automation ?? NO_AUTOMATION_ATTENTION;
  if (
    automation.needsAttention &&
    automation.title !== undefined &&
    automation.description !== undefined
  ) {
    out.push({
      id: 'automation-needs-attention',
      severity: 'warning',
      title: automation.title,
      description: automation.description,
      ...(automation.actionLabel === undefined ? {} : { actionLabel: automation.actionLabel }),
    });
  }

  const resources = input.resources;
  if (resources !== undefined && resources.disk.level !== 'ok')
    out.push({
      id: 'disk-pressure',
      severity: 'warning',
      title: resources.disk.level === 'critical' ? '磁盘已满' : '磁盘快满了',
      description: `已用 ${String(resources.disk.usedPercent)}%，还剩 ${formatVolumeBytes(resources.disk.availableBytes)}`,
      actionLabel: '去清理',
    });
  if (resources !== undefined && resources.retainedVolumes.level !== 'ok')
    out.push({
      id: 'retained-pressure',
      severity: 'warning',
      title: `保留下来的成果占了数据目录的 ${String(resources.retainedVolumes.percentOfDisk)}%`,
      description: `共 ${String(resources.retainedVolumes.count)} 份，占用 ${formatVolumeBytes(resources.retainedVolumes.totalBytes)}。下载需要的成果，再清理腾出空间。`,
      actionLabel: '去清理',
    });
  for (const runtime of input.runtimes ?? []) {
    if (runtime.credentialStatus !== 'expiring' && runtime.credentialStatus !== 'expired') continue;
    const expires = runtime.expiresAt === undefined ? undefined : Date.parse(runtime.expiresAt);
    const days =
      expires === undefined || Number.isNaN(expires) || input.now === undefined
        ? undefined
        : Math.max(0, Math.floor((expires - input.now) / 86_400_000));
    out.push({
      id: `credential-login:${runtime.id}`,
      severity: 'warning',
      title: `${runtime.displayName} 的帐号登录${runtime.credentialStatus === 'expired' ? '已过期' : days === undefined ? '即将过期' : ` ${String(days)} 天后过期`}`,
      description: '重新登录后，新发起的任务会使用更新后的帐号凭证。',
      actionLabel: '重新登录',
    });
  }
  return out;
}

/** `'YYYY-MM-DD'`（本机时区）。治理类横幅「关闭后当天不再弹」拿它当比对键。 */
export function todayKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${String(y)}-${m}-${d}`;
}

/**
 * 治理类「今天关过」判定：记录的日期字符串等于**今天**才算数。
 *
 * ⚠️ 与 `pruneDismissed`（阻断类的"判定不再命中就回收关闭记录"）是**两套不同的失效机制**，
 * 不要互相借用：阻断类的关闭要在"这次离线过去、又重新离线"时重新出现，靠的是"判定消失
 * 就回收"；治理类的关闭要撑到**这一天结束**，哪怕期间规则状态抖动（先恢复又再次触发）
 * 也不重新弹——这正是"当天不再弹"字面的意思。所以这里**不需要**也不做任何回收：日期一变，
 * 字符串比对自然不再相等，记录留在 store 里不会造成任何错误判定，只是不再生效的旧数据。
 */
export function isDismissedToday(
  id: BannerId,
  dismissedToday: Readonly<Record<string, string>>,
  now: Date,
): boolean {
  return dismissedToday[id] === todayKey(now);
}

/**
 * 排序 + 剔除已关闭项。**view 拿到的就是最终要渲染的那几条**，自身不做任何优先级判断
 * （07 §8.4「BannerStack.view 只接收已排好序的数组」/ 分层铁律 §3 规则 1–2）。
 */
export function bannerStackModel(
  banners: readonly GlobalBannerModel[],
  dismissedIds: readonly BannerId[],
  appearanceOrder: readonly BannerId[] = banners.map((banner) => banner.id),
): BannerStackModel {
  return {
    banners: banners
      .filter((b) => !dismissedIds.includes(b.id))
      .slice()
      .sort(
        (a, b) =>
          (BANNER_RANK[a.id] ?? 2) - (BANNER_RANK[b.id] ?? 2) ||
          appearanceOrder.indexOf(a.id) - appearanceOrder.indexOf(b.id),
      ),
  };
}

/**
 * 已关闭集合的**回收**：某条横幅这一轮不再产出时，把它的关闭记录一并丢掉。
 *
 * ⚠️ 没有这一步，"关闭"就变成了**永久**的：离线 → 用户关掉 → 网络修好（横幅本就该消失）
 * → 网络又断了 —— 此时横幅不会再出现，因为那条关闭记录还在。而这一次它比第一次更该出现。
 */
export function pruneDismissed<Id extends BannerId>(
  dismissedIds: readonly Id[],
  banners: readonly GlobalBannerModel[],
): Id[] {
  const live = new Set<BannerId>(banners.map((b) => b.id));
  return dismissedIds.filter((id) => live.has(id));
}
