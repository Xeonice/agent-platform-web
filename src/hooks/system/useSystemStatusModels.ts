// DTO / store 事实 → 四张卡的视图模型（F21-5 §3）。
//
// ⚠️ **这一层存在的唯一理由是分层铁律**：`container` 只能 import view/hook/type/store/component
// （eslint boundaries），**碰不到 `lib`**。而阈值判定、单位换算、文案挑选一律在 `lib/system/`。
// 于是需要一个 hook 把两边接起来 —— 它自己不做任何判断，只是转接。
//
// ⚠️ **连接状态的事实来自全局 store，不来自"再连一次试试"**：
// 终端会话数读 `terminalRegistry`（15 §3.2）；`/events` 的延迟本仓没有采样点，
// 传 `null` 让 lib 渲染成「未测量」而不是「已断开」（那是假警报，见 `connectionModel.ts`）。
import { useMemo } from 'react';
import { useAppStore } from '@/stores';
import { connectionStatusModel } from '@/lib/system/connectionModel';
import { diagnosticsCardModel } from '@/lib/system/diagnoseModel';
import { providerStatusModel } from '@/lib/system/providerModel';
import { resourcePoolModel } from '@/lib/system/resourceModel';
import type { UseSystemStatusResult } from '@/hooks/system/useSystemStatus';
import type {
  ConnectionStatusCardModel,
  DiagnosticsCardModel,
  ProviderStatusCardModel,
  ResourcePoolCardModel,
} from '@/types/system';

export interface SystemStatusModels {
  /** `null` = 还没取到（加载中或失败）。 */
  resourcePool: ResourcePoolCardModel | null;
  providerStatus: ProviderStatusCardModel | null;
  connection: ConnectionStatusCardModel;
  diagnostics: DiagnosticsCardModel;
}

export function useSystemStatusModels(status: UseSystemStatusResult): SystemStatusModels {
  const terminals = useAppStore((s) => s.entries);

  const resources = status.resources;
  const resourcePool = useMemo(
    // ⚠️ `new Date()` 在这里而不是在 lib 里：保留卷倒计时要一个可注入的"现在"，
    //    lib 侧写死 `Date.now()` 会让那条边界（不足 1 天 / 还需 N 天）没法被测。
    () => (resources === undefined ? null : resourcePoolModel(resources, new Date())),
    [resources],
  );

  const providers = status.providers;
  const providerStatus = useMemo(
    () => (providers === undefined ? null : providerStatusModel(providers)),
    [providers],
  );

  const restOk = !status.resourcesError && !status.providersError;
  const connection = useMemo(
    () =>
      connectionStatusModel({
        rest: { ok: restOk },
        terminals: {
          total: terminals.size,
          connected: [...terminals.values()].filter((e) => e.connState === 'open').length,
        },
        // ⚠️ 恒 `null`：本仓没有 `/events` 心跳 RTT 采样，而这条通道只挂在工作台。
        //    ⛔ 不许为了点亮这一行在本页新开一条连接（见 connectionModel.ts 文件头）。
        eventsLatencyMs: null,
      }),
    [restOk, terminals],
  );

  const diagnoseState = status.diagnoseState;
  const diagnostics = useMemo(() => diagnosticsCardModel(diagnoseState), [diagnoseState]);

  return { resourcePool, providerStatus, connection, diagnostics };
}
