// 全局横幅栈（07 §8.4「BannerStack + useGlobalBanner」/ P21-1 §9）的视图模型。
//
// ⚠️ **只有 `blocking` 一档，`warning`/`info` 没有写进这个联合类型** —— 07 §8.4 定义了三档
// （🔴 阻断 / ⚠️ 治理 / ℹ️ 提示），但今天只有阻断类有生产方。加另外两个取值的代价不是
// "多两行"，而是**它让人以为治理类横幅接好了**：`createUiSlice` 里那对
// `bannerDismissedToday` / `dismissBannerToday`（"关闭后当天不再弹"，专属治理类）至今
// 一个写入方都没有，正是这种"只在类型里存在"的东西。与 `currentModal` 删掉 `'wizard'`
// 是同一条纪律：**取值与它的生产方、消费方必须同一轮落地**。
//
// ⛔ 同理没有实现的：「⚠️ 最多堆叠 2 条 + 『还有 N 条』折叠」。今天最多同时 2 条，
//    折叠计数**恒为 0** —— 一个永远是 0 的 `collapsedCount` 与一个接好了的折叠 UI
//    在界面上长得一模一样，而后者不存在。等第三个生产方出现时连着它一起加。
import type { ConnectivityCheckModel } from '@/types/init';

/**
 * 横幅等级。07 §8.4：🔴 阻断类**不自动收起，须显式关闭**。
 *
 * ⚠️ 阻断类的"关闭"是**会话级**的，⛔ 不写 `bannerDismissedToday`（那是治理类的
 * "当天不再弹"）。差别在一台真的离线的机器上：关一次就当天不再提示，等于让
 * 「[+ 新任务] 为什么是灰的」永久失去解释，而它恰恰是最需要解释的时刻。
 */
export type BannerSeverity = 'blocking';

/** 今天的两个生产方。**新增一个就在这里加一个字面量**（穷尽性由 `BANNER_RANK` 兜住）。 */
export type BannerId = 'platform-state-unknown' | 'offline';

export interface GlobalBannerModel {
  id: BannerId;
  severity: BannerSeverity;
  /** 一行主文案，直接上 UI。 */
  title: string;
  /** 补充说明（第二行）。**离线那条必须说清"哪一半还好着"**。 */
  description: string;
  /** 动作按钮文案；缺席 = 这条横幅没有动作。 */
  actionLabel?: string;
}

export interface BannerStackModel {
  /** 已排好序、已剔除被关闭项。空数组 = 一条都不渲染（view 返回 null）。 */
  banners: GlobalBannerModel[];
}

/** `lib/system/globalBanner.ts` 的入参：判定所需的**全部**事实，一个不多。 */
export interface GlobalBannerInput {
  /**
   * 出网快照的视图模型（与向导 Step1 同一个工厂产出，**文案因此只有一份**）。
   *
   * ⚠️ `hasResult === false` 是**第三态**：「这台机器从没测过 / 快照读不到」。
   * 把它当成"通"（不出横幅）与当成"不通"（出横幅）都是编造 —— 见 `globalBanner.ts` ②。
   */
  connectivity: ConnectivityCheckModel;
  /**
   * `GET /api/system/init-status` 读失败时的那句人话；`undefined` = 读到了。
   *
   * ⚠️ 它**不是**"离线"的同义词，见 `globalBanner.ts` ①。
   */
  statusUnavailableReason?: string;
}
