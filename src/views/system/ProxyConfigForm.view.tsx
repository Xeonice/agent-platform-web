// 代理配置表单。纯展示 + 受控表单，零副作用、零网络。
//
// ⚠️ **两个页面都用它**：向导 Step2（F21-8 §3/§5 · P21-8 §2）与「设置 → 系统状态」。
//    所以它住在 `views/system/` 而不是 `views/init/` —— 它是一项**系统设置**，
//    向导只是第一次配置它的地方。
//
// ⛔ **代理配置不能只在向导里**（2026-09-14 真机撞出来的）：向导的 `proxyActive` 只在
//    连通性检查**有失败项**时才让第 2 步进流程，而连通性测的是**可达**、用户缺的可能是
//    **带宽**（实测 ghcr.io 1.4 秒应答但只有 200 KB/s，镜像拉到 84% 断掉）。检查全绿 ⇒
//    向导判定"不需要代理" ⇒ 那时若表单只存在于向导里，用户就**再也没有地方能配代理**。
//    ⇒ 设置页必须有一份常驻入口；向导那句「之后所有配置都能在设置里改」才不是空话。
//
// ⚠️ **[保存并重新检测] 只发 `PUT /api/system/settings`，⛔ 不发 `POST /api/system/init`。**
// 存配置与放行是两件事（§8 约束 2）：混在一个按钮里会让用户"填了代理还没确认资源就进了工作台"。
// 按钮上的字因此写全了「保存并重新检测」，而不是暧昧的 [确定]。
//
// ⚠️ **三个字段留空 = 清空代理**，这是刻意的：表单从已存配置回填，用户看到当前值把它删掉
// 就是明确的"我不要代理了"。（拼请求体的三态处理在 `lib/system/initWizardModel.ts::toProxyUpdate`。）
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ProxyFormValues } from '@/types/init';

export interface ProxyConfigFormProps {
  initial: ProxyFormValues;
  isSaving: boolean;
  /** >0 = [重新检测] 节流冷却中。 */
  cooldownSec: number;
  /** 保存失败的人话原因。 */
  errorMessage: string | null;
  /**
   * 按钮上的字。⚠️ **由调用方给，因为两处的动作不是同一件事**：向导里保存完要立刻
   * 重新跑连通性检查（用户正卡在那一步上等结论），设置页里只是存配置。
   * ⛔ 别写成暧昧的 [确定] —— 按钮要说清它到底会做什么（§8 约束 2）。
   */
  saveLabel?: string;
  onSaveAndRecheck: (values: ProxyFormValues) => void;
}

const FIELDS: { key: keyof ProxyFormValues; label: string; placeholder: string }[] = [
  { key: 'httpProxy', label: 'HTTP_PROXY', placeholder: 'http://127.0.0.1:7890' },
  { key: 'httpsProxy', label: 'HTTPS_PROXY', placeholder: 'http://127.0.0.1:7890' },
  { key: 'noProxy', label: 'NO_PROXY', placeholder: 'localhost,127.0.0.1,.internal' },
];

export function ProxyConfigFormView({
  initial,
  isSaving,
  cooldownSec,
  errorMessage,
  saveLabel = '保存并重新检测',
  onSaveAndRecheck,
}: ProxyConfigFormProps) {
  // 受控表单的局部 state 属于 view 的**展示状态**（15 §1：不跨组件、不跨路由，不进 store）。
  const [values, setValues] = useState<ProxyFormValues>(initial);
  const cooling = cooldownSec > 0;

  return (
    <form
      data-testid="proxy-config-form"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSaveAndRecheck(values);
      }}
    >
      {FIELDS.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{field.label}</span>
          <input
            name={field.key}
            value={values[field.key]}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="rounded-md border border-border bg-transparent px-3 py-2 text-sm"
            onChange={(e) => {
              const next = e.target.value;
              setValues((prev) => ({ ...prev, [field.key]: next }));
            }}
          />
        </label>
      ))}

      <p className="text-xs text-muted-foreground">
        三个都留空 = 清空代理配置。⚠️ 代理串里如果带用户名密码（`http://user:pass@host`），
        它会被存进平台配置 —— 审计日志只记 host，但请确认这台机器上存它是可以接受的。
      </p>

      {errorMessage === null ? null : (
        <p role="alert" data-testid="proxy-error" className="text-sm text-red-500">
          保存失败：{errorMessage}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSaving || cooling}>
          {isSaving ? '保存中…' : cooling ? `${saveLabel}（${String(cooldownSec)}s）` : saveLabel}
        </Button>
        {/* ⚠️ 这句不是废话：它是 §8 约束 2 在界面上的那一半。 */}
        <span className="text-xs text-muted-foreground">
          只保存配置，不会结束初始化 —— 放行在最后一步。
        </span>
      </div>
    </form>
  );
}
