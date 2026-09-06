// Step4「订阅配置」（F21-8 §7B · P21-8 §2）。纯展示、props 驱动、零副作用。
//
// ⚠️ **三条纪律：**
//
//  ① **每个 runtime 一行，各自独立可配。** 判据是「至少一个可用」——一台只跑 codex 的机器
//     不该被 claude-code 的空凭证挡住，那会逼用户去配一个他根本不用的帐号。
//
//  ② **已配好的那行不再给「去配置」。** 它没有下一步了；给一个动作按钮会让人以为还差点
//     什么（与 P21-5 §9A「✅ 的那一步不再给下一步动作」同一条，那条是实测订正来的）。
//
//  ③ **鉴权面板本身不在这里实现。** 展开的是同一个 `AuthGateContainer`（F07 §6.1 第三处
//     宿主）——两份「怎么算授权成功」迟早对不上，而其中一份还管着运行期的过期判定。
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { SubscriptionRuntimeModel, SubscriptionStepModel } from '@/types/init';

const STATE_ICON: Readonly<Record<SubscriptionRuntimeModel['state'], string>> = {
  ready: '✅',
  expired: '⚠️',
  none: '○',
};
const STATE_TEXT: Readonly<Record<SubscriptionRuntimeModel['state'], string>> = {
  ready: '已配置',
  // ⚠️ 「已过期」与「未配置」分开：前者要重新授权、后者是首次配置，动作名都不同。
  expired: '凭证已过期',
  none: '未配置',
};

export interface SubscriptionSetupProps {
  model: SubscriptionStepModel;
  /** 正在展开配置面板的 runtime id；`undefined` = 都收着。 */
  expandedRuntimeId?: string;
  onExpand: (runtimeId: string) => void;
  onCollapse: () => void;
  /** 鉴权面板由容器塞进来（同一个 `AuthGateContainer`，本视图不认识它）。 */
  renderAuthPanel: (runtime: SubscriptionRuntimeModel) => ReactNode;
}

export function SubscriptionSetupView({
  model,
  expandedRuntimeId,
  onExpand,
  onCollapse,
  renderAuthPanel,
}: SubscriptionSetupProps) {
  return (
    <section
      data-testid="subscription-setup"
      data-ready={model.ready ? 'true' : 'false'}
      className="flex flex-col gap-3"
    >
      <p className="text-sm text-muted-foreground">
        agent 用你自己的模型帐号跑。 <span className="text-foreground">配好任意一个即可开始</span>{' '}
        —— 不必两个都配。
      </p>

      {model.runtimes.length === 0 ? (
        // ⛔ registry 一个 runtime 都没有：如实说，不渲染一个空列表让人以为在加载。
        <p role="alert" data-testid="subscription-no-runtime" className="text-sm text-amber-400">
          ⚠️ 平台没有注册任何 runtime —— 这不该发生，去系统状态页看 provider 注册情况。
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {model.runtimes.map((r) => {
            const expanded = expandedRuntimeId === r.id;
            return (
              <li
                key={r.id}
                data-testid={`subscription-runtime-${r.id}`}
                data-state={r.state}
                className="flex flex-col gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true">{STATE_ICON[r.state]}</span>
                  <span className="font-medium">{r.displayName}</span>
                  <span className="text-xs text-muted-foreground">{STATE_TEXT[r.state]}</span>
                  {r.maskedIdentifier === undefined ? null : (
                    <span className="text-xs text-muted-foreground">· {r.maskedIdentifier}</span>
                  )}
                  <span className="ml-auto">
                    {/* ② 已配好的那行没有下一步，不给动作按钮。 */}
                    {r.state === 'ready' ? null : expanded ? (
                      <Button type="button" size="sm" variant="ghost" onClick={onCollapse}>
                        收起
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        data-testid={`subscription-configure-${r.id}`}
                        onClick={() => {
                          onExpand(r.id);
                        }}
                      >
                        {r.state === 'expired' ? '重新授权' : '去配置'}
                      </Button>
                    )}
                  </span>
                </span>

                {/* ③ 同一个 AuthGateContainer，由容器塞进来。 */}
                {expanded ? <div className="pt-1">{renderAuthPanel(r)}</div> : null}
              </li>
            );
          })}
        </ul>
      )}

      {model.blockedText === undefined ? null : (
        <p
          role="alert"
          data-testid="subscription-blocked"
          className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-600"
        >
          {model.blockedText}
        </p>
      )}
    </section>
  );
}
