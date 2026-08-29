// 单项诊断结果（F21-5 §3 · P21-5 §9A/§9B）。纯展示、props 驱动、零副作用。
//
// ⚠️ **`info` 渲染 ℹ️，不是 ⚠️。** 这是本文件存在的头号理由。第 ⑧ 项第 5 步（镜像已就绪
// 但尚未在本机铺开）常态就是 `info`：镜像是好的，只是首个任务要多等几分钟。渲染成 ⚠️
// 会让用户去修一个不需要修的东西，而他能想到的"修法"是删了重推——那会让情况更糟。
// ⇒ 下面这张表里 `info` 与 `warn` 是**两行**，谁把它们合并谁当场改到这里。
//
// ⚠️ **`timeout` 也有自己的图标。** 「5 秒内没查出来」不是「查出来是坏的」：前者常见于
// 「系统好像坏了」的场景，而它**不构成**这一项坏了的结论。
//
// ⚠️ **`summary` 整段原样渲染，不截断。** 端口占用那一项的全部价值就在这句话里：
// 「端口 3000（平台 HTTP/WS 服务）被 com.docke (pid 41235) 占用」——端口号 · 进程名与 pid ·
// 平台原本要用它做什么，三样缺一样，用户就得自己去查（P21-5 §9B）。截断它等于把诊断
// 最有用的那部分丢掉。
//
// ⚠️ **第 ⑧ 项的 `stepText` 与 `errorCode` 各自成行**，⛔ 不与 `summary` 拼成一句：
// 五步的下一步动作完全不同，合成一条等于把诊断退化成一个红灯（P21-5 §9A）。
import { Button } from '@/components/ui/button';
import type { DiagnoseStatus } from '@/types/sse-protocol';
import type { DiagnosticItemModel } from '@/types/system';

/** ⚠️ 五个状态五个图标 —— `info` 与 `warn` 分开、`timeout` 与 `fail` 分开。 */
const STATUS_ICON: Readonly<Record<DiagnoseStatus, string>> = {
  ok: '✅',
  info: 'ℹ️',
  warn: '⚠️',
  fail: '❌',
  timeout: '⌛',
};
const STATUS_TEXT: Readonly<Record<DiagnoseStatus, string>> = {
  ok: '正常',
  // ⚠️ 「提示」而不是「警告」：`info` 是"没有任何东西需要修"。
  info: '提示',
  warn: '警告',
  fail: '失败',
  // ⚠️ 「未得出结论」而不是「失败」：它没说这一项是坏的。
  timeout: '超时未得出结论',
};

export interface DiagnosticItemProps {
  item: DiagnosticItemModel;
  /** 修复建议 [复制]（clipboard + toast 在 container）。 */
  onCopyHint: (hint: string) => void;
}

export function DiagnosticItemView({ item, onCopyHint }: DiagnosticItemProps) {
  const pending = item.status === undefined;
  return (
    <li
      data-testid={`diagnostic-item-${item.id}`}
      data-status={item.status ?? 'pending'}
      className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true">{pending ? '⏳' : STATUS_ICON[item.status ?? 'ok']}</span>
        <span className="font-medium">{item.label}</span>
        <span className="text-xs text-muted-foreground">
          {pending ? '检查中…' : STATUS_TEXT[item.status ?? 'ok']}
        </span>
        {item.durationText === undefined ? null : (
          <span className="text-xs text-muted-foreground">{item.durationText}</span>
        )}
      </span>

      {item.stepText === undefined ? null : (
        <span data-testid={`diagnostic-step-${item.id}`} className="text-xs text-muted-foreground">
          {item.stepText}
        </span>
      )}

      {item.summary === undefined ? null : (
        // ⚠️ 不加 `truncate` / `line-clamp`：这句话是这一项的全部结论（§9B）。
        <span className="whitespace-pre-wrap break-words">{item.summary}</span>
      )}

      {item.errorCode === undefined ? null : (
        <span data-testid={`diagnostic-code-${item.id}`} className="text-xs text-muted-foreground">
          错误码 {item.errorCode}
        </span>
      )}

      {item.hint === undefined ? null : (
        <span className="flex flex-wrap items-center gap-2">
          <code className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs">
            {item.hint}
          </code>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              onCopyHint(item.hint ?? '');
            }}
          >
            复制
          </Button>
        </span>
      )}
    </li>
  );
}
