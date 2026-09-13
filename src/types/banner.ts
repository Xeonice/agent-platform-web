// 全局横幅栈（07 §8.4「BannerStack + useGlobalBanner」/ P21-1 §9）的视图模型。
//
// ⚠️ **只有 `blocking`/`warning` 两档，`info` 没有写进这个联合类型** —— 07 §8.4 定义了三档
// （🔴 阻断 / ⚠️ 治理 / ℹ️ 提示）。`warning`（治理）本轮随第一个真生产方
// （`lib/automation/automationAttention.ts`「定时规则自动停用/被放慢」，接线见
// `lib/system/globalBanner.ts`）一起落地——production 与 consumption 同一轮，`warning`
// 不是只在类型里存在的东西。`info` 仍然没有：今天没有任何一处判定要产出「提示」级别的
// 全局横幅，加这个取值只会重复 `currentModal` 删掉 `'wizard'` 那同一个教训
// （"只在类型里存在的取值比没有更坏"）——等第一个 info 生产方出现时再加。
//
// ⛔ 同理没有实现的：「⚠️ 最多堆叠 2 条 + 『还有 N 条』折叠」。今天最多同时 3 条，
//    折叠计数**恒为 0** —— 一个永远是 0 的 `collapsedCount` 与一个接好了的折叠 UI
//    在界面上长得一模一样，而后者不存在。等第四个生产方出现时连着它一起加。
import type { AutomationAttention } from '@/types/automation';
import type { ConnectivityCheckModel } from '@/types/init';

/**
 * 横幅等级。07 §8.4：优先级 🔴 阻断 > ⚠️ 治理 > ℹ️ 提示（`info` 暂无生产方，见文件头）。
 *
 * ⚠️ 两档的「关闭」语义不同，⛔ 不要混用：
 *   · `blocking` 是**会话级**——关一次这次会话内不再出现，⛔ 不写 `bannerDismissedToday`。
 *     差别在一台真的离线的机器上：如果按"当天"记，关一次就当天不再提示，等于让
 *     「[+ 新任务] 为什么是灰的」永久失去解释，而它恰恰是最需要解释的时刻。
 *   · `warning`（治理）是**当天级**——关闭写 `bannerDismissedToday`，同一天内即使判定
 *     再次命中也不重新弹出；跨天则自然失效（`lib/system/globalBanner.ts` 的
 *     `isDismissedToday` 按日期字符串比对，不需要额外的回收步骤）。
 */
export type BannerSeverity = 'blocking' | 'warning';

/** 今天的三个生产方。**新增一个就在这里加一个字面量**（穷尽性由 `BANNER_RANK` 兜住）。 */
export type BannerId = 'platform-state-unknown' | 'offline' | 'automation-needs-attention';

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
  /**
   * 自动化侧「需要用户知道的事」（`lib/automation/automationAttention.ts` 的产出）。
   * **可选**：省略等同「没有数据」（`hasData:false`），既有调用点不必逐个改。
   */
  automation?: AutomationAttention;
}
