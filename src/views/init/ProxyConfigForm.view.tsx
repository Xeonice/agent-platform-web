// Step2「代理配置」（F21-8 §3/§5 · P21-8 §2）。纯展示 + 受控表单，零副作用、零网络。
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
          {isSaving
            ? '保存中…'
            : cooling
              ? `保存并重新检测（${String(cooldownSec)}s）`
              : '保存并重新检测'}
        </Button>
        {/* ⚠️ 这句不是废话：它是 §8 约束 2 在界面上的那一半。 */}
        <span className="text-xs text-muted-foreground">
          只保存配置，不会结束初始化 —— 放行在最后一步。
        </span>
      </div>
    </form>
  );
}
