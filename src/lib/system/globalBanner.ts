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
 */
const BANNER_RANK: Readonly<Record<BannerId, number>> = {
  'platform-state-unknown': 0,
  offline: 1,
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

  return out;
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
