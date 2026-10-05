// 鉴权拦截面板外壳（07 §6.1/§6.4）：方式切换 Tab（帐号授权 / API Key）+ 取舍说明 + 一次性语义文案 +
// 页脚 [管理所有凭证]。子面板（Device/SetupToken/ApiKey）由容器按当前 Tab 渲染进 children。
// 同一实现被向导拦截面板与凭证页卡片内嵌复用（凭证页无一次性文案、无 [管理所有凭证] 页脚）。纯展示、零副作用。
import { useId, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

export type AuthTabKey = 'account' | 'api-key';

export interface AuthGateTab {
  key: AuthTabKey;
  label: string;
}

export interface AuthGatePanelProps {
  runtimeName: string;
  tabs: AuthGateTab[];
  selectedTab: AuthTabKey;
  onSelectTab: (tab: AuthTabKey) => void;
  /** 当前 Tab 对应的子面板（容器渲染）。 */
  children: ReactNode;
  /** 拦截面板首次配置的一次性语义文案（凭证页复用时省略）。 */
  showOneTimeNotice?: boolean;
  /** 页脚 [管理所有凭证]（仅向导拦截面板；凭证页自身无需）。 */
  onOpenCredentials?: () => void;
}

/** 取舍说明（07 §6.1/P20 §5.1）：帐号登录走订阅额度；API key 按用量计费、配起来最快。 */
const TRADEOFF_HINT =
  '帐号登录走你的订阅额度；API Key 按用量计费、配起来最快。两样可以同时留着，切换只改现在用哪个。';

export function AuthGatePanelView({
  runtimeName,
  tabs,
  selectedTab,
  onSelectTab,
  children,
  showOneTimeNotice = false,
  onOpenCredentials,
}: AuthGatePanelProps) {
  const id = useId();
  return (
    <section
      aria-label={`配置 ${runtimeName} 凭证`}
      className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/50 p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">配置 {runtimeName} 凭证</h3>
        {showOneTimeNotice && (
          <p className="text-sm text-muted-foreground">
            只用配一次，之后所有任务（别的项目也算）都会用它。
          </p>
        )}
      </header>

      <div role="tablist" aria-label="登录方式" className="flex gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.key === selectedTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              id={`${id}-${tab.key}`}
              aria-selected={active}
              aria-controls={`${id}-panel`}
              tabIndex={active ? 0 : -1}
              onKeyDown={(event) => {
                const index = tabs.findIndex((item) => item.key === tab.key);
                const target =
                  event.key === 'ArrowRight'
                    ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft'
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? tabs.length - 1
                          : -1;
                const next = tabs[target];
                if (!next) return;
                event.preventDefault();
                onSelectTab(next.key);
                const buttons =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                buttons?.[target]?.focus();
              }}
              onClick={() => {
                onSelectTab(tab.key);
              }}
              className={
                '-mb-px h-10 border-b-2 px-3 text-sm transition-colors ' +
                (active
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <p className="text-sm text-muted-foreground">{TRADEOFF_HINT}</p>

      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selectedTab}`}>
        {children}
      </div>

      {onOpenCredentials !== undefined && (
        <footer className="mt-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={onOpenCredentials}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            管理所有凭证
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </footer>
      )}
    </section>
  );
}
