// Runtime 凭证分区（F21-3 §3）：「Runtime 凭证（本机全局共享）」标题 + 搜索 + 卡片列表（骨架/空态）。
// 与 Git 凭证分区并列。纯展示、props 驱动、零副作用；一切决策/网络在容器。
import type { ReactNode } from 'react';
import { RuntimeCredentialCardView } from '@/views/settings/RuntimeCredentialCard.view';
import type {
  RuntimeCredentialCardModel,
  RuntimeAuthMethod,
  RuntimeAuthMode,
} from '@/types/runtimeCredential';

export interface RuntimeCredentialsSectionProps {
  loading?: boolean;
  cards: RuntimeCredentialCardModel[];
  search: string;
  onSearch: (q: string) => void;
  /** 每张卡对应的就地授权面板（容器按 expandedPanel 定位；无展开则 undefined）。 */
  panelFor: (runtimeId: string) => ReactNode;
  onSwitch: (runtimeId: string, mode: RuntimeAuthMode) => void;
  onNeedSetup: (runtimeId: string, mode: RuntimeAuthMode) => void;
  onReauth: (runtimeId: string, method: RuntimeAuthMethod) => void;
  onAddKey: (runtimeId: string) => void;
  onRevoke: (runtimeId: string, mode: RuntimeAuthMode) => void;
  busy?: boolean;
}

export function RuntimeCredentialsSectionView({
  loading = false,
  cards,
  search,
  onSearch,
  panelFor,
  onSwitch,
  onNeedSetup,
  onReauth,
  onAddKey,
  onRevoke,
  busy = false,
}: RuntimeCredentialsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Runtime 凭证（本机全局共享）</h2>
        <p className="text-xs text-muted-foreground">
          帐号授权 / API Key 二选一，全局生效；两类凭证可同时留存，切换只改谁生效。
        </p>
        <input
          type="search"
          name="runtime-search"
          placeholder="搜索 runtime 或掩码帐号…"
          className="w-full max-w-xs rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={search}
          onChange={(e) => {
            onSearch(e.target.value);
          }}
        />
      </header>

      {loading ? (
        <div className="h-24 animate-pulse rounded-lg border border-border bg-muted/30" />
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">没有匹配的 runtime。</p>
      ) : (
        <div className="flex flex-col gap-3">
          {cards.map((model) => (
            <RuntimeCredentialCardView
              key={model.runtimeId}
              model={model}
              busy={busy}
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
