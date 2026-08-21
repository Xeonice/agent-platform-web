// 鉴权拦截面板外壳（07 §6.1/§6.4）：方式切换 Tab（帐号授权 / API Key）+ 取舍说明 + 一次性语义文案 +
// 页脚 [管理所有凭证]。子面板（Device/SetupToken/ApiKey）由容器按当前 Tab 渲染进 children。
// 同一实现被向导拦截面板与凭证页卡片内嵌复用（凭证页无一次性文案、无 [管理所有凭证] 页脚）。纯展示、零副作用。
import type { ReactNode } from 'react';

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

/** 取舍说明（07 §6.1/P20 §5.1）：帐号授权用订阅额度；API key 按量计费、配置最快。 */
const TRADEOFF_HINT =
  '帐号授权使用订阅额度；API Key 按量计费、配置最快。两类凭证可同时留存，切换只改谁生效。';

export function AuthGatePanelView({
  runtimeName,
  tabs,
  selectedTab,
  onSelectTab,
  children,
  showOneTimeNotice = false,
  onOpenCredentials,
}: AuthGatePanelProps) {
  return (
    <section
      aria-label={`配置 ${runtimeName} 凭证`}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">配置 {runtimeName} 凭证</h3>
        {showOneTimeNotice && (
          <p className="text-xs text-muted-foreground">
            只需配置一次，此后所有任务（包括其他项目）自动使用该凭证。
          </p>
        )}
      </header>

      <div role="tablist" aria-label="鉴权方式" className="flex gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.key === selectedTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                onSelectTab(tab.key);
              }}
              className={
                '-mb-px border-b-2 px-3 py-2 text-sm transition-colors ' +
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

      <p className="text-xs text-muted-foreground">{TRADEOFF_HINT}</p>

      <div>{children}</div>

      {onOpenCredentials !== undefined && (
        <footer className="mt-1 border-t border-border pt-3">
          <button
            type="button"
            onClick={onOpenCredentials}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            管理所有凭证
          </button>
        </footer>
      )}
    </section>
  );
}
