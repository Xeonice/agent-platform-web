// SSH 私钥表单（F21-3 §3，P21-3 §10.2）：粘贴私钥 → [测试连接] → [保存]；展示只显 SHA256 指纹。
// 带 passphrase 的私钥 MVP 不支持（保存前由容器经 lib 预校验，本视图仅展示提示 + 禁用保存）。
// 受控：私钥值由容器局部 state 持有（提交即清空，绝不进 store，15 §3.5）；本视图纯展示、零副作用、零 lib。
import { Button } from '@/components/ui/button';
import { TestConnectionResultView } from '@/views/settings/TestConnectionResult.view';

export interface SshKeyFormProps {
  /** 私钥明文（受控，容器持有）。 */
  privateKey: string;
  onPrivateKeyChange: (value: string) => void;
  /** passphrase 私钥不支持的提示（null = 无警告）。 */
  passphraseWarning?: string | null;
  /** 保存禁用（容器综合：非空 + 像私钥 + 无 passphrase）。 */
  submitDisabled?: boolean;
  submitting?: boolean;
  testing?: boolean;
  testResult?: { ok: boolean; message: string } | null;
  onTest: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function SshKeyFormView({
  privateKey,
  onPrivateKeyChange,
  passphraseWarning,
  submitDisabled = false,
  submitting = false,
  testing = false,
  testResult,
  onTest,
  onSubmit,
  onCancel,
}: SshKeyFormProps) {
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitDisabled && !submitting) onSubmit();
      }}
    >
      <h3 className="text-sm font-semibold">配置 SSH 密钥</h3>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">
          粘贴私钥（保存后仅展示 SHA256 指纹，永不回显）
        </span>
        <textarea
          name="ssh-private-key"
          rows={6}
          spellCheck={false}
          autoComplete="off"
          placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          className="rounded-md border border-border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          value={privateKey}
          disabled={submitting}
          onChange={(e) => {
            onPrivateKeyChange(e.target.value);
          }}
        />
      </label>

      {passphraseWarning !== undefined &&
        passphraseWarning !== null &&
        passphraseWarning !== '' && (
          <p role="alert" className="text-xs text-yellow-300">
            {passphraseWarning}
          </p>
        )}

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
