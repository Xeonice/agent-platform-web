// 环境变量行内编辑表（P21-4 §10.2，F21-4 §3/§5）。纯展示、受控、零副作用。
// **行内表格，不是弹层**——`KEY | VALUE | ☐ Secret | [删除]` + [+ 添加变量]。
//
// ⚠️ 校验**不在这里跑**：view 被 boundaries 禁止 import `lib/`，
// `validateEnvVars` 在 hook 层跑完，本组件只吃 `errors` / `valueByteCounts` / `canAddRow`
// 然后渲染（F21-4 §3.1 规则 1）。错误按**码**渲染文案，不按后端自由文本——
// 于是前端提示与后端拒绝永远是同一句话。
//
// ⚠️ **安全红线（P21-4 §10.2）**：已存 secret 的值**永远不进 DOM**。
// 本组件对 `secretStored` 的行做**兜底掩码**——即便容器不小心把原值传了下来，输入框也渲染空串。
// 这不是重复防护，是最后一道：泄漏一次就没法收回。
import { Button } from '@/components/ui/button';
import type { EnvVarRowModel, EnvVarValidationError, EnvVarErrorCode } from '@/types/image';

/** 行内文案与后端四个码同名映射（F21-4 §5 表），**不做二次翻译**。 */
const ERROR_COPY: Record<EnvVarErrorCode, string> = {
  ENV_NAME_INVALID: '变量名只能包含字母、数字、下划线，且不能以数字开头',
  ENV_NAME_RESERVED: '该变量名为系统保留，请使用凭证管理配置',
  ENV_LIMIT_EXCEEDED: '超出长度或条数上限',
  ENV_DUPLICATE_KEY: '变量名重复',
};

/** VALUE 上限的**字节**数——计数器上的分母，单位在 UI 上也写「字节」（F21-4 §5）。 */
const VALUE_MAX_BYTES_LABEL = 4096;

export interface EnvVarEditorProps {
  rows: readonly EnvVarRowModel[];
  /** `lib/image/validateEnvVar.ts` 的产出（hook 层跑完传下来）。 */
  errors: readonly EnvVarValidationError[];
  /** 逐行 VALUE 字节数，与 `rows` 下标对齐。 */
  valueByteCounts: readonly number[];
  /** 条数未到顶才允许加行；到顶时 [+ 添加变量] 置灰。 */
  canAddRow: boolean;
  onChangeKey: (id: string, key: string) => void;
  onChangeValue: (id: string, value: string) => void;
  onToggleSecret: (id: string, secret: boolean) => void;
  onRemoveRow: (id: string) => void;
  onAddRow: () => void;
  disabled?: boolean;
}

export function EnvVarEditorView({
  rows,
  errors,
  valueByteCounts,
  canAddRow,
  onChangeKey,
  onChangeValue,
  onToggleSecret,
  onRemoveRow,
  onAddRow,
  disabled = false,
}: EnvVarEditorProps) {
  const tableErrors = errors.filter((e) => e.field === 'rows');

  return (
    <div className="flex flex-col gap-2" data-testid="env-var-editor">
      {rows.length === 0 && <p className="text-xs text-muted-foreground">还没有环境变量。</p>}

      {rows.map((row, index) => {
        const rowErrors = errors.filter((e) => e.index === index);
        const keyErrors = rowErrors.filter((e) => e.field === 'key');
        const valueErrors = rowErrors.filter((e) => e.field === 'value');
        // 兜底掩码：已存 secret ⇒ 输入框恒为空串，用户一输入即覆盖（容器随之清掉 secretStored）。
        const masked = row.secret && row.secretStored;
        const bytes = valueByteCounts[index] ?? 0;

        return (
          <div
            key={row.id}
            data-testid="env-var-row"
            data-row-index={index}
            className="flex flex-col gap-1"
          >
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label={`变量名 ${String(index + 1)}`}
                placeholder="LOG_LEVEL"
                disabled={disabled}
                className={`w-48 rounded-md border bg-transparent px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  keyErrors.length > 0 ? 'border-red-500' : 'border-border'
                }`}
                value={row.key}
                onChange={(e) => {
                  onChangeKey(row.id, e.target.value);
                }}
              />
              <input
                type={row.secret ? 'password' : 'text'}
                aria-label={`变量值 ${String(index + 1)}`}
                // 已存 secret：值渲染为空 + 「保持不变，输入即覆盖」（P21-4 §10.2）。
                placeholder={masked ? '（保持不变，输入即覆盖）' : 'info'}
                disabled={disabled}
                className={`w-64 rounded-md border bg-transparent px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  valueErrors.length > 0 ? 'border-red-500' : 'border-border'
                }`}
                value={masked ? '' : row.value}
                onChange={(e) => {
                  onChangeValue(row.id, e.target.value);
                }}
              />
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`Secret ${String(index + 1)}`}
                  disabled={disabled}
                  checked={row.secret}
                  onChange={(e) => {
                    onToggleSecret(row.id, e.target.checked);
                  }}
                />
                Secret
              </label>
              <button
                type="button"
                aria-label={`删除变量 ${String(index + 1)}`}
                disabled={disabled}
                className="text-xs text-muted-foreground hover:text-red-400"
                onClick={() => {
                  onRemoveRow(row.id);
                }}
              >
                删除
              </button>
              <span
                className={`text-[10px] ${bytes > VALUE_MAX_BYTES_LABEL ? 'text-red-400' : 'text-muted-foreground'}`}
                data-testid="value-byte-counter"
              >
                {String(bytes)} / {String(VALUE_MAX_BYTES_LABEL)} 字节
              </span>
            </div>

            {rowErrors.map((e) => (
              <p
                key={`${e.field}-${e.code}`}
                role="alert"
                data-testid="env-var-row-error"
                data-code={e.code}
                className="text-[11px] text-red-400"
              >
                {ERROR_COPY[e.code]}
              </p>
            ))}
          </div>
        );
      })}

      {tableErrors.map((e) => (
        <p key={e.code} role="alert" className="text-[11px] text-red-400" data-code={e.code}>
          {ERROR_COPY[e.code]}
        </p>
      ))}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !canAddRow}
          onClick={onAddRow}
        >
          + 添加变量
        </Button>
      </div>
    </div>
  );
}
