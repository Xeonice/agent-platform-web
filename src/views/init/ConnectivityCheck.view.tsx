// Step1「出网可达性检测」（F21-8 §3/§5 · P21-8 §2）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「上次检测：…」那一行是这张卡的必需品，不是装饰。** 进向导直接渲染历史结果、不重跑
// 检测（§8 约束 1）——但历史结果如果不带时刻，用户就无从判断它是三秒前还是三周前的。
// 「代理昨天刚配好」和「三周前测的、之后网络换过」在界面上长得一模一样，而它们该做的事相反。
// ⇒ `checkedAtText` 缺席时**明说"这份结果没有时刻"**，而不是悄悄不显示。
//
// ⚠️ **[重新检测] 冷却中显示倒计时而不是干瘪的置灰。** 3s 节流（P21-8 §7）本身对；
// 一个没有理由的灰按钮会让人以为它坏了。
import { Button } from '@/components/ui/button';
import { ConnectivityItemView } from '@/views/init/ConnectivityItem.view';
import type { ConnectivityCheckModel } from '@/types/init';

export interface ConnectivityCheckProps {
  model: ConnectivityCheckModel;
  isChecking: boolean;
  /** >0 = 节流冷却中。 */
  cooldownSec: number;
  onRecheck: () => void;
}

export function ConnectivityCheckView({
  model,
  isChecking,
  cooldownSec,
  onRecheck,
}: ConnectivityCheckProps) {
  const cooling = cooldownSec > 0;
  return (
    <section
      data-testid="connectivity-check"
      data-verdict={model.verdict}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          data-testid="connectivity-verdict"
          className={
            model.verdict === 'offline'
              ? 'text-sm text-red-500'
              : model.verdict === 'partial'
                ? 'text-sm text-amber-600'
                : 'text-sm text-muted-foreground'
          }
        >
          {model.verdictText}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isChecking || cooling}
          onClick={onRecheck}
        >
          {isChecking ? '检测中…' : cooling ? `重新检测（${String(cooldownSec)}s）` : '重新检测'}
        </Button>
      </div>

      {model.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isChecking ? '正在检测出网可达性…' : '还没有检测结果，点 [重新检测] 跑一轮。'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {model.rows.map((row) => (
            <ConnectivityItemView key={row.id} row={row} pending={isChecking} />
          ))}
        </ul>
      )}

      {model.rows.length === 0 ? null : (
        <p data-testid="connectivity-checked-at" className="text-xs text-muted-foreground">
          {model.checkedAtText ??
            // ⚠️ 不静默省略：一份不知道什么时候测的结果，用户有权知道它不知道。
            '这份结果没有带时刻 —— 无法判断它有多旧，建议点 [重新检测] 跑一轮。'}
          {model.fromHistory ? '（上次检测的结果，进向导不重跑）' : '（本轮刚检测）'}
        </p>
      )}
    </section>
  );
}
