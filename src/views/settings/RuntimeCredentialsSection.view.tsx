// Agent 帐号分区（F21-3 §3）：标题 + 搜索 + 卡片列表（骨架 / 加载失败 / 搜索无果 / 一个都没有）。
// 与 Git 凭证分区并列。纯展示、props 驱动、零副作用；一切决策/网络在容器。
//
// ⚠️ **空列表分三态，不是一态**（此前只有一句「没有匹配的 runtime。」）：
//    · 加载失败 —— `useRuntimes` 的 `isError` 此前**全仓无人读取**，于是接口挂了也渲染「没有匹配」，
//      而用户根本没搜索过。这是「把『不知道』说成『没有』」，本页最严重的一类。
//    · 搜索无果 —— 用户确实搜了，但没命中。
//    · 一个都没有 —— 后端注册表是空的。
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { RuntimeCredentialCardView } from '@/views/settings/RuntimeCredentialCard.view';
import type {
  RuntimeCredentialCardModel,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

export interface RuntimeCredentialsSectionProps {
  loading?: boolean;
  /** 列表**加载失败**（区别于「查到了但是空的」）；true → 失败态 + [重试]。 */
  loadError?: boolean;
  /** [重试] 重新拉取列表。 */
  onRetryLoad?: () => void;
  cards: RuntimeCredentialCardModel[];
  search: string;
  onSearch: (q: string) => void;
  /** 存放承诺（「加密存在本机、不上传、读不回明文」；lib 常量，容器传入）。 */
  storageNote?: string;
  /** 每张卡对应的就地授权面板（容器按 expandedPanel 定位；无展开则 undefined）。 */
  panelFor: (runtimeId: string) => ReactNode;
  onSwitch: (runtimeId: string, mode: RuntimeAuthMode) => void;
  onNeedSetup: (runtimeId: string, mode: RuntimeAuthMode) => void;
  onReauth: (runtimeId: string, method: RuntimeAuthMethod) => void;
  onAddKey: (runtimeId: string) => void;
  onRevoke: (runtimeId: string, mode: RuntimeAuthMode) => void;
  /** 某 runtime 某模式行是否正被操作（精确 scope，只禁正在操作的那一行；缺省=永不忙）。 */
  isRowBusy?: (runtimeId: string, mode: RuntimeAuthMode) => boolean;
}

export function RuntimeCredentialsSectionView({
  loading = false,
  loadError = false,
  onRetryLoad,
  cards,
  search,
  onSearch,
  storageNote,
  panelFor,
  onSwitch,
  onNeedSetup,
  onReauth,
  onAddKey,
  onRevoke,
  isRowBusy,
}: RuntimeCredentialsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">🤖 Agent 帐号（这台机器上通用）</h2>
        <p className="text-xs text-muted-foreground">
          帐号登录 / API Key
          二选一，这台机器上的所有任务都用它；两样可以同时留着，切换只改现在用哪个。
        </p>
        {storageNote !== undefined && storageNote !== '' && (
          <p className="text-xs text-muted-foreground">{storageNote}</p>
        )}
        <input
          type="search"
          name="runtime-search"
          placeholder="搜索 Agent 名字或帐号尾号…"
          className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={search}
          onChange={(e) => {
            onSearch(e.target.value);
          }}
        />
      </header>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/30" />
      ) : loadError ? (
        // ⛔ 「查不动」自成一态：这里绝不能落到下面那句「没有匹配」——
        //    那会让用户以为自己搜错了，或者以为 Agent 列表真的是空的。
        <div
          role="alert"
          data-testid="runtime-load-error"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-4 text-sm text-amber-400"
        >
          <span>Agent 列表没能加载出来，现在看不到这台机器上都配了些什么。</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetryLoad}>
            重试
          </Button>
        </div>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search.trim() === '' ? '这台机器上还没有可用的 Agent。' : '没有匹配的 Agent。'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((model) => (
            <RuntimeCredentialCardView
              key={model.runtimeId}
              model={model}
              rowBusy={(mode) => isRowBusy?.(model.runtimeId, mode) ?? false}
              expandedSlot={panelFor(model.runtimeId)}
              onSwitch={(mode) => {
                onSwitch(model.runtimeId, mode);
              }}
              onNeedSetup={(mode) => {
                onNeedSetup(model.runtimeId, mode);
              }}
              onReauth={(method) => {
                onReauth(model.runtimeId, method);
              }}
              onAddKey={() => {
                onAddKey(model.runtimeId);
              }}
              onRevoke={(mode) => {
                onRevoke(model.runtimeId, mode);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}
