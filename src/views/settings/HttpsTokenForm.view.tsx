// HTTPS Token 表单（F21-3 §3，P21-3 §10.2）：选来源（GitHub→github.com / GitLab→gitlab.com /
// Gitee→gitee.com 自动推导 host；其他手填）+ host 白名单（可加多个，≥1）+ scope 提示 + 粘贴 →
// [测试连接] → [保存]（body 带 allowedHosts）；展示仅尾号 + host 白名单（明文）。
// 受控：token 值由容器局部 state 持有（提交即清空，绝不进 store，15 §3.5）；本视图纯展示、零副作用、零 lib。
// 平台选项不在此硬编码：由容器/hook 从 lib 的 `GIT_PLATFORMS` 注册表派生后经 platformOptions 传入（单一来源）。
import { Button } from '@/components/ui/button';
import { AllowedHostsEditorView } from '@/views/settings/AllowedHostsEditor.view';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';
import type { GitPlatform } from '@/types/gitCredential';

export interface HttpsTokenFormProps {
  /** 选来源选项（容器/hook 从 lib `GIT_PLATFORMS` 注册表派生传入，view 不硬编码平台列表）。 */
  platformOptions: { value: GitPlatform; label: string }[];
  platform: GitPlatform;
  onPlatformChange: (platform: GitPlatform) => void;
  /** Token 明文（受控，容器持有）。 */
  token: string;
  onTokenChange: (value: string) => void;
  allowedHosts: string[];
  onAllowedHostsChange: (hosts: string[]) => void;
  /** scope 提示文案（容器传入，来自 lib 常量）。 */
  scopeHint: string;
  /** 保存禁用（容器综合：token 非空 + allowedHosts ≥1）。 */
  submitDisabled?: boolean;
  submitting?: boolean;
  testing?: boolean;
  testResult?: { ok: boolean; message: string } | null;
  onTest: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function HttpsTokenFormView({
  platformOptions,
  platform,
  onPlatformChange,
  token,
  onTokenChange,
  allowedHosts,
  onAllowedHostsChange,
  scopeHint,
  submitDisabled = false,
  submitting = false,
  testing = false,
  testResult,
  onTest,
  onSubmit,
  onCancel,
}: HttpsTokenFormProps) {
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitDisabled && !submitting) onSubmit();
      }}
    >
      <h3 className="text-sm font-semibold">配置 HTTPS Token</h3>

      <fieldset className="flex flex-col gap-2" disabled={submitting}>
        <legend className="mb-1 text-xs text-muted-foreground">来源（自动推导 host）</legend>
        <div className="flex flex-wrap gap-3">
          {platformOptions.map((opt) => (
            <label key={opt.value} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="git-platform"
                value={opt.value}
                checked={platform === opt.value}
                onChange={() => {
                  onPlatformChange(opt.value);
                }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <AllowedHostsEditorView
        value={allowedHosts}
        onChange={onAllowedHostsChange}
        disabled={submitting}
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Personal Access Token（保存后仅展示尾号）</span>
        <input
          type="password"
          name="https-token"
          autoComplete="off"
          placeholder="ghp_…"
          className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={token}
          disabled={submitting}
          onChange={(e) => {
            onTokenChange(e.target.value);
          }}
        />
        <span className="text-xs text-muted-foreground">{scopeHint}</span>
      </label>

      <TestConnectionResultView testing={testing} result={testResult} />

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={submitDisabled || testing || submitting}
          onClick={onTest}
        >
          测试连接
        </Button>
        <Button type="submit" size="sm" disabled={submitDisabled || submitting}>
          {submitting ? '保存中…' : '保存'}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={submitting} onClick={onCancel}>
          取消
        </Button>
      </div>
    </form>
  );
}
