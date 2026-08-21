// C · api-key（两 runtime 通用，07 §6.2）：key 输入框（password 遮罩）→ [保存并继续]；前端即时前缀校验
//（Codex sk- / Claude Code sk-ant-，不匹配即红边提示）；AUTH_REJECTED 就地红字 + 可能原因列表，不弹层。
// key 受控于容器局部 state（提交即清空，绝不进 store，15 §3.5）。纯展示、props 驱动、零副作用。
import { Button } from '@/components/ui/button';

export interface ApiKeyAuthProps {
  /** key 明文（受控，容器持有，提交即清空）。 */
  value: string;
  onValueChange: (value: string) => void;
  /** 期望前缀（格式提示，权威判定在后端）。 */
  expectedPrefix: string;
  /** 前缀是否合法（false → 红边 + 提示）。 */
  prefixValid: boolean;
  submitting?: boolean;
  /** AUTH_REJECTED 就地红字。 */
  error?: string;
  /** 可能原因列表（格式错误/无权限/额度不足）。 */
  reasons?: string[];
  onSubmit: () => void;
}

export function ApiKeyAuthView({
  value,
  onValueChange,
  expectedPrefix,
  prefixValid,
  submitting = false,
  error,
  reasons,
  onSubmit,
}: ApiKeyAuthProps) {
  const disabled = submitting || value.trim() === '' || !prefixValid;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">API Key（保存后仅展示尾号）</span>
        <input
          type="password"
          name="api-key"
          autoComplete="off"
          aria-invalid={!prefixValid}
          placeholder={`${expectedPrefix}…`}
          className={
            'rounded-md border bg-transparent px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
            (prefixValid ? 'border-border' : 'border-red-400')
          }
          value={value}
          disabled={submitting}
          onChange={(e) => {
            onValueChange(e.target.value);
          }}
        />
        {!prefixValid && (
          <span role="alert" className="text-xs text-red-400">
            Key 应以 {expectedPrefix} 开头，请检查后重试。
          </span>
        )}
        <span className="text-xs text-muted-foreground">API Key 按量计费。</span>
      </label>

      {error !== undefined && error !== '' && (
        <div role="alert" className="flex flex-col gap-1 text-xs text-red-400">
          <span>{error}</span>
          {reasons !== undefined && reasons.length > 0 && (
            <ul className="list-inside list-disc">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <Button type="submit" size="sm" disabled={disabled}>
          {submitting ? '校验中…' : '保存并继续'}
        </Button>
      </div>
    </form>
  );
}
