// Automation attention copy. Global banners use the cross-project overview only.
import { automationLifecycle } from '@/lib/automation/automationStatus';
import {
  AUTO_DISABLE_AFTER_FAILURES,
  type AutomationAttention,
  type AutomationAttentionItem,
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

/** Q-WB-01 B: unknown snapshots never fall back to a selected project's cached list. */
export function globalAutomationAttention(
  rules: readonly AutomationAttentionItem[] | undefined,
): AutomationAttention {
  if (rules === undefined) return NO_ATTENTION;
  const ordered = rules
    .slice()
    .sort((a, b) => Number(a.status !== 'autoDisabled') - Number(b.status !== 'autoDisabled'));
  const autoDisabledCount = ordered.filter((rule) => rule.status === 'autoDisabled').length;
  const degradedCount = ordered.length - autoDisabledCount;
  const first = ordered[0];
  if (first === undefined) {
    return { hasData: true, autoDisabledCount, degradedCount, needsAttention: false };
  }
  const description = ordered
    .slice(0, 3)
    .map((rule) => {
      const name = `${rule.projectName} 的「${rule.name}」`;
      return rule.status === 'autoDisabled'
        ? `${name}连着失败 ${String(rule.consecutiveFailures)} 次后已经不再触发，要重新开启才会继续跑`
        : `${name}被放慢成每天只试一次`;
    })
    .join('；');
  return {
    hasData: true,
    autoDisabledCount,
    degradedCount,
    needsAttention: true,
    title:
      autoDisabledCount > 0
        ? `有 ${String(autoDisabledCount)} 条定时规则已自动停用`
        : `有 ${String(degradedCount)} 条定时规则被放慢了`,
    description:
      description +
      (ordered.length > 3 ? `；等共 ${String(ordered.length)} 条规则需要关注` : '') +
      '。定时任务停了不会有别的提示，这里是唯一会主动告诉你的地方。',
    actionLabel: '查看这些规则',
    projectId: first.projectId,
  };
}
