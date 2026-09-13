// 全局横幅的判定与文案（F21-8 §4「离线模式的跨页影响」/ 07 §8.4 / P21-8 §5 状态矩阵）。
//
// ⚠️ **三条纪律，每一条都对应一个"页面看起来完全正常"的写法：**
//
//  ① **「读不到平台状态」⛔ 不许渲染成「离线模式」。** 两者在界面上都是一条红条，代价却
//     完全相反：`init-status` 读失败的真正原因是**后端没起来**，而「离线模式：Agent 不可用
//     [重新检测]」把用户送去查网络、配代理 —— 他会在一个没有问题的地方找一个不存在的问题，
//     而真正的那句话（后端没起来）一个字都没出现。这与 `AppBootGate` 的 fail-open 注释
//     ④ 是同一条：**失败路径不许表现成一句更好看的谎**。⇒ 两条横幅、两句话、两个 id。
//
//  ② **「没测过」⛔ 不是「通」。** 一条快照都没有时不出离线横幅是对的（不能凭空报红），
//     但它成立的理由是"我们不知道"而不是"我们知道它是通的"。所以判据写成
//     `hasResult && verdict === 'offline'`，⛔ 不是 `verdict === 'offline'` —— 后者依赖
//     `connectivityVerdict` 对空数组兜底成 `'ok'` 这个**实现细节**，那份兜底一旦改口径
//     （比如改成 `'partial'`），这里会静默地开始对每一台新装机器报红。
//
//  ③ **离线的判据只有「模型 API 全不可达」，⛔ 不含镜像仓库。** 这条不在本文件里重写，
//     整个判定都借 `connectivityCheckModel` —— 连同它那句 `verdictText`。前端在这里抄
//     第二份文案的代价是：向导里说的和横幅里说的迟早会分叉，而它们说的是同一件事。
import type {
  BannerId,
  BannerStackModel,
  GlobalBannerInput,
  GlobalBannerModel,
} from '@/types/banner';

/**
 * 离线时 [+ 新任务] 等发起入口的置灰理由（P21-8 §7「离线模式入口置灰清单」的 tooltip 文案）。
 *
 * ⚠️ 它住在 `lib` 而不是 container：container 被 boundaries 禁止 import `lib`，所以这句话
 * 经 `useOfflineMode()` 交出去。**⛔ 不许在 container 里手打一遍** —— 那样横幅说的和
 * tooltip 说的会各自演化，而用户是把这两句连起来读的。
 */
export const OFFLINE_ACTION_DISABLED_REASON = '离线模式：需连接网络才能发起任务';

/**
 * 渲染顺序。**`platform-state-unknown` 在前**：它否定的是"这一屏的判定作不作数"，
 * 排在离线之下时，用户会先读到一个可能根本不成立的结论。
 *
 * ⚠️ 排序同时编码了**优先级分层**（design-notes.md §4 Phase 3 第 3 条：阻断 > 治理 > 提示）：
 * 两条 blocking（0、1）排在 `automation-needs-attention` 这条 warning（2）之前。今天只有
 * 三个生产方、每个 id 至多出现一条，靠这张表的先后顺序就足够表达"阻断压过治理"，不需要
 * 另起一个按 `severity` 分组再排序的通用比较器——等哪天同一档出现第二个生产方、需要按
 * 到达顺序或时间戳再决出同档内的先后时，再在这里升级排序逻辑（不要为了这一天还没到的
 * 需求先搭一个通用框架）。
 */
const BANNER_RANK: Readonly<Record<BannerId, number>> = {
  'platform-state-unknown': 0,
  offline: 1,
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
        '这多半是后端没起来或不可达 —— 在它恢复之前，「Agent 是否可用」无法判定：' +
        '既不表示网络正常，也不表示离线。',
      actionLabel: '查看系统状态',
    });
  }

  const { connectivity } = input;
  // ② `hasResult` 不可省：没有快照时我们不知道，而"不知道"不该报红，也不该被写成"通"。
  if (connectivity.hasResult && connectivity.verdict === 'offline') {
    out.push({
      id: 'offline',
      severity: 'blocking',
      title: '离线模式：Agent 不可用',
      // ③ 判定与这句话都来自 `connectivityCheckModel`，本文件不复制一份。
      description:
        connectivity.verdictText +
        (connectivity.checkedAtText === undefined ? '' : `（${connectivity.checkedAtText}）`),
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
): BannerStackModel {
  return {
    banners: banners
      .filter((b) => !dismissedIds.includes(b.id))
      .slice()
      .sort((a, b) => BANNER_RANK[a.id] - BANNER_RANK[b.id]),
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
