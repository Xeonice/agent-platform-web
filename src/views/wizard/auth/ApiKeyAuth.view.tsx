// C · api-key（07 §6.2）：key 输入框（password 遮罩）→ [保存并继续]；前端即时前缀提示
//（不匹配即红边 + 红字，**但不禁用提交**）；被拒时就地红字 + 可能原因列表，不弹层。
// key 受控于容器局部 state（提交即清空，绝不进 store，15 §3.5）。纯展示、props 驱动、零副作用。
//
// ⛔ **前缀不匹配不再拦住提交。** 此前 `disabled` 里含 `!prefixValid`，而 `lib/credential/authFlow.ts`
//    的注释自己就写过：「前端猜错的代价是『合法凭证提交不了』，比不提示严重得多」——
//    那条注释纠正了前缀的**来源**（改成 runtime 自己声明），却没拆掉这个**禁用**。
//    于是后端下发的前缀一旦有偏差（或第三方 runtime 的 key 长得不一样），用户手里一串
//    完全合法的 key **根本按不下保存键**。⇒ 提示归提示，判定权交后端。
import { Button } from '@/components/ui/button';
import { CircleAlert } from 'lucide-react';

export interface ApiKeyAuthProps {
  /** key 明文（受控，容器持有，提交即清空）。 */
  value: string;
  onValueChange: (value: string) => void;
  /** 期望前缀（格式提示，权威判定在后端）。 */
  expectedPrefix: string;
  /** 前缀是否匹配（false → 红边 + 红字提示；**不禁用提交**，权威判定在后端）。 */
  prefixValid: boolean;
  /**
   * 这个 key 的出处（`RuntimeDto.vendor`，后端下发的运行时字段）。
   *
   * ⚠️ 用它拼一句「去哪儿拿」—— 此前这里只有孤零零一句「API Key 按量计费。」，
   *    对**从哪儿弄到这串东西**一个字都没说。
   * ⛔ 只渲染后端给的值，不在前端硬编码任何 runtime 名字或控制台链接（开放注册表）。
   */
  vendor?: string;
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
  vendor,
  submitting = false,
  error,
  reasons,
  onSubmit,
}: ApiKeyAuthProps) {
  // ⚠️ **不含 `!prefixValid`**（见文件头）：前缀只是提示，拦不住提交。
  const disabled = submitting || value.trim() === '';

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">API Key（保存后仅展示尾号）</span>
        <input
          type="password"
          name="api-key"
          autoComplete="off"
          aria-invalid={!prefixValid}
          // 前缀为空 = 该 runtime 没声明前缀（04 §3 ★3z）⇒ 不拿前缀做提示，
          // 否则 placeholder 会退化成一个光秃秃的「…」。
          placeholder={expectedPrefix === '' ? '粘贴密钥' : `${expectedPrefix}…`}
          className={
            'h-9 min-w-0 rounded-md border bg-background px-3 font-mono text-[13px] focus-visible:outline-none ' +
            (prefixValid
              ? 'border-border focus-visible:shadow-[var(--v2-focus-input)]'
              : 'border-destructive shadow-[var(--v2-focus-input-error)]')
          }
          value={value}
          disabled={submitting}
          onChange={(e) => {
            onValueChange(e.target.value);
          }}
        />
        {!prefixValid && (
          <span role="alert" className="flex items-start gap-1.5 text-[13px] text-destructive">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              这串 key 一般以 {expectedPrefix} 开头 ——
              确认没拿错的话，也可以直接提交，由服务端判定。
            </span>
          </span>
        )}
        <span className="text-[13px] text-muted-foreground">
          {vendor === undefined || vendor === ''
            ? 'API Key 在签发它的厂商控制台里创建；按用量计费。'
            : `在 ${vendor} 的控制台创建一个 API Key，粘到这里；按用量计费。`}
        </span>
      </label>

      {error !== undefined && error !== '' && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-md border border-[var(--v2-status-fail-subtle-border)] bg-[var(--v2-status-fail-subtle-bg)] p-3 text-sm text-destructive"
        >
          <span className="font-medium">{error}</span>
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
