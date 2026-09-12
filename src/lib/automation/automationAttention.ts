// 自动化侧「需要用户知道的事」的汇总判定（P21-7 §4「全局横幅同步提示」/ §5「横幅引导重新授权」
// / F21-7 §9.1 #20 #24）。**纯函数**，喂给横幅层的那一位事实由它产出。
//
// ★ **这个文件为什么存在：定时任务的价值就在「我不在的时候」。**
//   规则被连续失败推到自动停用、或因为凭证过期被跳过，这两件事今天**只在项目菜单
//   → ⚙️ 自动化规则那个侧弹层里可见**。用户不主动打开它，就永远不知道自己的夜间任务
//   已经停了两周 —— 而"我不在的时候它替我跑"正是他建这条规则的唯一理由。
//   全仓 grep `useGlobalBanner` 此前**没有任何 automation 来源**，上面三条验收全部落空。
//
// ⚠️ **本文件刻意不 import 横幅层的任何东西**（`lib/system/globalBanner` /
//   `hooks/system/useGlobalBanner` 有各自的负责人）。它只产出一个自足的判定结果；
//   横幅层要接的时候，把 `AutomationAttention` 塞进 `GlobalBannerInput` 即可。
//   接线所需的改动清单写在文件末尾的 `⏳ 待横幅层配合` 注释里。
//
// ⚠️ **「没打开过面板」≠「没有问题」。** 规则列表是按项目、按需拉的（面板打开才 enabled），
//   所以大多数时刻我们**根本没有数据**。那时 `hasData: false`，⛔ 调用方不许把它当成
//   "一切正常"渲染成静默 —— 这正是本仓「『不知道』不能说成『没有』」那条纪律。
import { automationLifecycle } from '@/lib/automation/automationStatus';
import {
  AUTO_DISABLE_AFTER_FAILURES,
  type AutomationAttention,
  type AutomationDto,
} from '@/types/automation';

// ⚠️ `AutomationAttention` 本身住在 `types/automation.ts`（不是这里）：横幅层要把它塞进
// `GlobalBannerInput`，而 boundaries 规则只许 `type → type`，`types/banner.ts` 够不到
// `lib/automation/*`。本文件只 re-export 类型给旧的引用点用，实现仍然全在这一份。
export type { AutomationAttention };

const NO_ATTENTION: AutomationAttention = {
  hasData: false,
  autoDisabledCount: 0,
  degradedCount: 0,
  needsAttention: false,
};

/**
 * 规则列表 → 需不需要在全局横幅上说一句。
 *
 * @param rules `undefined` ⇒ 还没拉到（面板没打开过 / 请求失败）⇒ `hasData:false`。
 *              ⛔ 与「拉到了、是空列表」不是一回事，两者的返回值必须分得开。
 */
export function automationAttention(
  rules: readonly AutomationDto[] | undefined,
): AutomationAttention {
  if (rules === undefined) return NO_ATTENTION;

  let autoDisabledCount = 0;
  let degradedCount = 0;
  for (const rule of rules) {
    // 判据复用 `automationLifecycle` —— ⛔ 不在这里重写一遍 `enabled && failures >= N`：
    // 那套判定的**顺序**是有讲究的（自动停用先判，否则会被归成手动关掉），
    // 抄第二份必然漂。
    const lifecycle = automationLifecycle({
      enabled: rule.enabled,
      degraded: rule.degraded,
      consecutiveFailures: rule.consecutiveFailures,
    });
    if (lifecycle === 'autoDisabled') autoDisabledCount += 1;
    else if (lifecycle === 'degraded') degradedCount += 1;
  }

  const needsAttention = autoDisabledCount > 0 || degradedCount > 0;
  if (!needsAttention) {
    return { hasData: true, autoDisabledCount, degradedCount, needsAttention: false };
  }

  return {
    hasData: true,
    autoDisabledCount,
    degradedCount,
    needsAttention: true,
    // ⚠️ 标题只说**最重的那一档**：一条横幅承载两种严重度会让用户先去分辨"这说的是哪个"。
    title:
      autoDisabledCount > 0
        ? `有 ${String(autoDisabledCount)} 条定时规则已自动停用`
        : `有 ${String(degradedCount)} 条定时规则被放慢了`,
    description: describe(autoDisabledCount, degradedCount),
    actionLabel: '查看这些规则',
  };
}

function describe(autoDisabled: number, degraded: number): string {
  const parts: string[] = [];
  if (autoDisabled > 0) {
    parts.push(
      `${String(autoDisabled)} 条连着失败 ${String(AUTO_DISABLE_AFTER_FAILURES)} 次后已经不再触发，` +
        '要重新开启才会继续跑',
    );
  }
  if (degraded > 0) {
    parts.push(`${String(degraded)} 条被放慢成每天只试一次`);
  }
  // ★ 最后这半句是这条横幅存在的理由：不说，用户就只会在下次主动打开面板时才发现。
  return `${parts.join('；')}。定时任务停了不会有别的提示，这里是唯一会主动告诉你的地方。`;
}

/*
 * ✅ **本轮（design-notes.md Phase 3 第 3 条「全局横幅优先级」）已按下面这份清单接上**，
 *    这条注释原样留着当接线记录（谁想知道"治理类横幅从哪来的"，从这里能一路找到）：
 *
 *   ① `types/banner.ts`
 *      · `BannerSeverity` 加了 `'warning'`（治理类，⚠️）——`BannerSeverity` 文件头那句
 *        "取值与它的生产方必须同一轮落地"，本文件就是那个生产方。
 *      · `BannerId` 加了 `'automation-needs-attention'`（`BANNER_RANK` 同步加了一行，
 *        排在两条 blocking 之后）。
 *      · `GlobalBannerInput` 加了一位 `automation?: AutomationAttention`
 *        （可选，缺席按"没有数据"处理，不强制所有既有调用点都要传）。
 *
 *   ② `lib/system/globalBanner.ts`
 *      · `globalBanners()` 加了一支：`automation.needsAttention` ⇒ push 一条，
 *        `title` / `description` / `actionLabel` **直接取本文件产出的那三个字段**，
 *        没有另写第二份文案。
 *      · 治理类横幅按 07 §8.4"关闭后当天不再弹"，`dismiss()` 分支按 severity 走
 *        `bannerDismissedToday`（`createUiSlice` 里那对此前没有写入方的 action，
 *        这条是它们的第一个用户）。
 *
 *   ③ `hooks/system/useGlobalBanner.ts`
 *      · 取数**没有新拉一次、也没有再起一份只读订阅**：直接调用
 *        `hooks/automation/useAutomations.ts` 已经导出的 `useAutomationAttention(projectId)`
 *        （该文件自己的注释写着"给全局横幅层用的那一位"——它比这份接线记录写得还早，
 *        本文件最初的草稿一度重新拼了一遍 `useQuery({queryKey, enabled:false})`，
 *        是重复实现，已经改回来）。
 *      · 结果直接塞进 `globalBanners()` 的入参，不在这里另存一份状态。
 *
 * ⛔ **一个已知的、本轮解决不了的缺口（需要后端）：**
 *   上面这套只在**用户至少打开过一次该项目的自动化面板**之后才有数据（`hasData`）。
 *   而这条横幅要防的恰恰是"从不打开面板"的那个人 —— 缺的是一个**不依赖面板的数据源**：
 *     · 跨项目的规则概览（今天只有 `GET /api/projects/:id/automations`，按项目、按需）；
 *     · P21-7 §5「凭证过期 → 引导重新授权」所需的 `AUTH_EXPIRED` 事实只存在于
 *       **运行记录**上（`automation_runs.error_code`），而运行记录只能按规则 id 分页拉。
 *   ⇒ 这两条已列进交付报告的后端待办。在它们到位之前，`hasData:false` 是诚实的答案，
 *     ⛔ 不许用"没拉到 ⇒ 没问题"把横幅静默掉。
 */
