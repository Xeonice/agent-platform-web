// 规则生命周期判定（P21-7 §4 状态机 / 03 §8.4 / F21-7 §7.1）。
//
// ⚠️ **`archivedOff`（随项目归档禁用）不在这里，是故意的。** 产品状态机图里画了它，
// F21-7 §6 的状态矩阵也列了它，但 §10.3 C 写得很清楚：项目归档功能**F21-6 §10 D 已裁决不做**
// ⇒ 这条联动这一期无从落地，"别写进验收"。造一个后端永远产不出的分支，
// 等于在代码里承诺一件不存在的事（`uiSlice` 文件头那两个死值同一教训）。
// ⇒ 归档功能真落地时，在这里加一个分支 + 一条测试即可，不需要改调用点。
import {
  AUTO_DISABLE_AFTER_FAILURES,
  DEGRADE_AFTER_FAILURES,
  type AutomationLifecycle,
} from '@/types/automation';

export interface AutomationStatusInput {
  enabled: boolean;
  /** 后端的降频标记（03 §8.4 `degraded`）。 */
  degraded: boolean;
  consecutiveFailures: number;
}

/**
 * 判定顺序是有意义的，不能重排：
 *  1. **自动禁用先判**——它同时满足 `enabled===false` 与"失败很多"，
 *     若先判 `enabled` 就会被归成普通的「手动禁用 ⏸️」，用户就看不到 [查看原因]/[重新启用]，
 *     只会觉得"我没关过它，它自己关了"。
 *  2. 再判 `enabled`（手动禁用）。
 *  3. 最后判降频。
 */
export function automationLifecycle(input: AutomationStatusInput): AutomationLifecycle {
  const { enabled, degraded, consecutiveFailures } = input;
  if (!enabled && consecutiveFailures >= AUTO_DISABLE_AFTER_FAILURES) return 'autoDisabled';
  if (!enabled) return 'off';
  if (degraded || consecutiveFailures >= DEGRADE_AFTER_FAILURES) return 'degraded';
  return 'on';
}

export interface LifecyclePresentation {
  /**
   * 语义状态提示，复用 `StatusPill` 八态字面量集合中的三个（`ok`/`warn`/`fail`）。
   * ⛔ **这里只是状态字面量，不是图标组件**——把它换成 `icon: CheckCircle` 那种写法
   * 就是把表现层塞进了纯逻辑层（07 §4.1，lib 只许 import lib/type）。哪个 lucide
   * 图标、什么颜色，由 view 自己按这个字面量查表决定。
   * `off`（手动关掉）缺席：它在八态里没有精确对应，不强行塞进 `warn`/`fail`
   * （见交付报告"待拍板点"）。
   */
  status?: 'ok' | 'warn' | 'fail';
  text: string;
  /** 需要用户处置（`warn`/`fail`）→ 列表行给 [查看原因]，并汇进治理类横幅。 */
  needsAttention: boolean;
}

export function describeLifecycle(
  lifecycle: AutomationLifecycle,
  consecutiveFailures: number,
): LifecyclePresentation {
  switch (lifecycle) {
    case 'on':
      return { status: 'ok', text: '已开启', needsAttention: false };
    case 'off':
      // ⚠️ 不写"已停止"：停止说的是运行中的东西，这里是"到点不会被触发"。
      // `status` 缺席：手动关掉是中性态，不是 warn/fail。
      return { text: '已关掉（到点不会触发）', needsAttention: false };
    case 'degraded':
      return {
        status: 'warn',
        text: `连着失败 ${String(consecutiveFailures)} 次，已经放慢：现在每天只试一次`,
        needsAttention: true,
      };
    /**
     * ★ **两个数一起给。**
     *
     * 界面上只写「连续失败 10 次」，而产品文档说的是「放慢之后再连续失败 7 次就停用」——
     * 用户拿这两个数对不上，会以为其中一个是错的。它们其实是同一件事的两种数法：
     * 总共 10 次，其中前 3 次让规则放慢、之后又失败了 7 次。
     * ⇒ 把换算直接写出来，⛔ 不许只留一个数让用户自己去猜另一个是怎么来的。
     */
    case 'autoDisabled':
      return {
        status: 'fail',
        text:
          `连着失败 ${String(consecutiveFailures)} 次（放慢后又失败 ` +
          `${String(Math.max(0, consecutiveFailures - DEGRADE_AFTER_FAILURES))} 次），已自动停用`,
        needsAttention: true,
      };
  }
}

/**
 * [重新启用] 之后的本地乐观态（P21-7 §9.1 #25：**失败计数清零**）。
 * 文案上要明示清零，否则用户不知道这一下是不是"又要三次就再关一遍"。
 */
export function afterReenable(): AutomationStatusInput {
  return { enabled: true, degraded: false, consecutiveFailures: 0 };
}

/**
 * 一次运行结果对连续失败计数的影响（P21-7 §4 计数口径 / 03 §8.4）。
 *
 * ★ 三种走向，缺一不可：
 *  · `success`                       → **清零**；
 *  · `failed` / `timeout`            → **+1**；
 *  · `skipped` / `missed` / 未终态   → **既不 +1 也不清零**（视同该次未发生）。
 * ⚠️ 第三条是最容易写错的：把 `skipped` 当成功清零，用户的规则就永远降不了频；
 *    当失败 +1，凭证过期一晚上就能把规则自动禁用掉——两个方向都错，且都没有报错。
 */
export function applyOutcome(failures: number, status: string): number {
  if (status === 'success') return 0;
  if (status === 'failed' || status === 'timeout') return failures + 1;
  return failures;
}
