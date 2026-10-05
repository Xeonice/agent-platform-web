// 「设置 → 系统状态」里的代理配置卡。纯展示、props 驱动、零副作用。
//
// ⛔ **这张卡存在的全部理由**：代理配置此前**只在初始化向导里**，而向导的 `proxyActive`
//    只在连通性检查**有失败项**时才让那一步进流程 —— 连通性测的是**可达**、用户缺的
//    可能是**带宽**（2026-09-14 真机：ghcr.io 1.4 秒应答但只有 200 KB/s，320 MB 的镜像
//    拉到 84% 断掉）。检查全绿 ⇒ 向导判定"不需要代理" ⇒ 用户**再也没有地方能配代理**。
//    而向导开场白写着「之后所有配置都能在『设置 → 系统状态』里改」—— 那句话此前对代理
//    是**假的**，这张卡让它成真。
//
// ⚠️ 表单本体复用 `ProxyConfigForm.view`（向导也用它），⛔ 不另写一份 —— 两份表单迟早
//    会在"留空 = 清空"这类三态语义上分叉。
import { ProxyConfigFormView } from '@/views/system/ProxyConfigForm.view';
import { Button } from '@/components/ui/button';
import type { ProxyFormValues } from '@/types/init';

export interface ProxySettingsCardProps {
  initial: ProxyFormValues;
  isSaving: boolean;
  isLoading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  errorMessage: string | null;
  fieldErrors?: Partial<Record<keyof ProxyFormValues, string>>;
  onFieldChange?: () => void;
  saveSucceeded?: boolean;
  configured?: boolean;
  onSave: (values: ProxyFormValues) => void;
}

export function ProxySettingsCardView({
  initial,
  isSaving,
  isLoading = false,
  loadError = false,
  onRetry,
  errorMessage,
  fieldErrors,
  onFieldChange,
  saveSucceeded = false,
  configured = false,
  onSave,
}: ProxySettingsCardProps) {
  return (
    <section
      aria-labelledby="proxy-settings-heading"
      data-testid="proxy-settings-card"
      className="rounded-md bg-card p-4 shadow-[var(--v2-shadow-card)]"
    >
      <div className="flex items-center gap-2">
        <h2 id="proxy-settings-heading" className="text-base font-semibold">
          出网代理
        </h2>
        {configured && !loadError ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            已配置
          </span>
        ) : null}
      </div>
      {/* ⚠️ 说清**什么时候需要它** —— 「能连上」不等于「够快」，这正是用户会卡住的地方。 */}
      <p className="mt-1 text-xs text-muted-foreground">
        联网检查会走这组代理；镜像下载和沙箱里的 Agent
        现在还不读它。检查只测得出「能不能连上」，测不出带宽。
      </p>
      <div className="mt-3">
        {loadError ? (
          <div role="alert" className="flex items-center gap-3 text-sm">
            <span>读取代理配置失败，请重试。</span>
            <Button variant="outline" size="sm" onClick={onRetry}>
              重试
            </Button>
          </div>
        ) : isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            正在读取代理配置…
          </p>
        ) : (
          <ProxyConfigFormView
            // key 让设置回填到达后表单重新初始化（受控 state 的初值只吃第一次）。
            key={`${initial.httpProxy}|${initial.httpsProxy}|${initial.noProxy}`}
            initial={initial}
            isSaving={isSaving}
            cooldownSec={0}
            errorMessage={errorMessage}
            fieldErrors={fieldErrors}
            onFieldChange={onFieldChange}
            successMessage={saveSucceeded ? '已保存。下一轮联网检查会走这组代理。' : undefined}
            // ⚠️ 这一页没有「重新检测」——那是向导的动作（用户正卡在那一步等结论）。
            //    这里只存配置，所以按钮就叫「保存」。
            saveLabel="保存"
            onSaveAndRecheck={onSave}
          />
        )}
      </div>
    </section>
  );
}
