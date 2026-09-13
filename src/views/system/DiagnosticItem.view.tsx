// 单项诊断结果（F21-5 §3 · P21-5 §9A/§9B）。纯展示、props 驱动、零副作用。
//
// ⚠️ **`info` 渲染 ℹ️，不是 ⚠️。** 这是本文件存在的头号理由。预制镜像那一项的第 5 步
// （镜像已就绪但还没下载到本机）常态就是 `info`：镜像是好的，只是首个任务要多等几分钟。
// 渲染成 ⚠️ 会让用户去修一个不需要修的东西，而他能想到的"修法"是删了重推——那会让情况
// 更糟。⇒ 下面这张表里 `info` 与 `warn` 是**两行**，谁把它们合并谁当场改到这里。
//
// ⚠️ **`timeout` 也有自己的图标。** 「没查出来」不是「查出来是坏的」：前者常见于
// 「系统好像坏了」的场景，而它**不构成**这一项坏了的结论。
//
// ── 三层信息，三种渲染（2026-09-11 拆的）──────────────────────────────────────
//
// ⚠️ **第一层 `headline` 恒可见**：一句结论 + 挡不挡我干活，≤ 20 字。
//
// ⚠️ **第二层 `detailText` / `nextStep` 收进展开层**。证据（哪个端口、被谁占、还剩多少
// GB）一个字都不许丢 —— 端口那一项的全部价值就在那句话里（P21-5 §9B）—— 但它不该跟
// 结论抢第一行：上一版把整段证据顶在图标旁边，用户要读完三行才知道这一项到底好不好。
//
// ⛔ **`nextStep` 用普通字体渲染，没有 [复制] 按钮。** 上一版把整个 `hint` 塞进 `<code>`
// 等宽框 + [复制]，而后端的 hint 早就演化成散文了（「重跑一次看稳不稳定」）—— **一段
// 散文顶着一个复制按钮**，复制下来也没地方粘。等宽 + [复制] 只属于 `command`。
//
// ⛔ **全链路没有 markdown 渲染器。** 后端上屏文案里一个 `**` 都不许有，否则用户读到的
// 是带星号的源代码。这条纪律在后端（每项检查的 spec）与这里（下面那条断言不到的地方靠
// review）两头守；这里能做的是**不给 markdown 任何可乘之机**：纯文本渲染，不解析。
//
// ⚠️ **预制镜像那一项的 `stepText` 与 `errorCode` 各自成行**，⛔ 不与结论拼成一句：
// 五步的下一步动作完全不同，合成一条等于把诊断退化成一个红灯（P21-5 §9A）。
import { useState } from 'react';
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
  timeout: '未得出结论',
};

export interface DiagnosticItemProps {
  item: DiagnosticItemModel;
  /** 命令 [复制]（clipboard + toast 在 container）。 */
  onCopyHint: (hint: string) => void;
}

export function DiagnosticItemView({ item, onCopyHint }: DiagnosticItemProps) {
  const pending = item.status === undefined;
  // ⚠️ **默认收起**。展开状态是纯粹的每一项自己的事，不进 model —— 它不该跨重新诊断
  //    保留，也不该让 lib 层多一个与结论无关的字段。
  const [expanded, setExpanded] = useState(false);
  const hasMore =
    item.detailText !== undefined || item.nextStep !== undefined || item.command !== undefined;

  return (
    <li
      data-testid={`diagnostic-item-${item.id}`}
      data-status={item.status ?? 'pending'}
      data-expanded={expanded ? 'true' : 'false'}
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

      {/* 第一层：一句结论。⚠️ 不加 `truncate` / `line-clamp` —— 它本来就 ≤ 20 字。 */}
      {item.headline === undefined ? null : (
        <span data-testid={`diagnostic-headline-${item.id}`} className="break-words">
          {item.headline}
        </span>
      )}

      {item.stepText === undefined ? null : (
        <span data-testid={`diagnostic-step-${item.id}`} className="text-xs text-muted-foreground">
          {item.stepText}
        </span>
      )}

      {hasMore ? (
        <button
          type="button"
          data-testid={`diagnostic-toggle-${item.id}`}
          aria-expanded={expanded}
          className="self-start text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setExpanded((v) => !v);
          }}
        >
          {expanded ? '收起' : '展开详情'}
        </button>
      ) : null}

      {expanded ? (
        <>
          {/* 第二层 ①：证据、例外条款、为什么。⛔ 一个字都不许截断（§9B）。 */}
          {item.detailText === undefined ? null : (
            <span
              data-testid={`diagnostic-detail-${item.id}`}
              className="whitespace-pre-wrap break-words text-muted-foreground"
            >
              {item.detailText}
            </span>
          )}

          {item.errorCode === undefined ? null : (
            <span
              data-testid={`diagnostic-code-${item.id}`}
              className="text-xs text-muted-foreground"
            >
              错误码 {item.errorCode}
            </span>
          )}

          {/* 第二层 ②：下一步。⛔ **普通字体、无复制按钮** —— 它是人话，不是命令。 */}
          {item.nextStep === undefined ? null : (
            <span
              data-testid={`diagnostic-next-${item.id}`}
              className="whitespace-pre-wrap break-words"
            >
              {item.nextStep}
            </span>
          )}

          {/* 第二层 ③：真正可粘贴执行的命令 —— 只有它配等宽 + [复制]。 */}
          {item.command === undefined ? null : (
            <span className="flex flex-wrap items-center gap-2">
              <code
                data-testid={`diagnostic-command-${item.id}`}
                className="flex-1 whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs"
              >
                {item.command}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  onCopyHint(item.command ?? '');
                }}
              >
                复制
              </Button>
            </span>
          )}
        </>
      ) : null}
    </li>
  );
}
