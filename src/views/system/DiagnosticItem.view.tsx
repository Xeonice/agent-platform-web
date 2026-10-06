// 诊断结果由 StatusPill 表达严重度。info 不表示警告，timeout 不等于确定失败。
// headline 恒可见，detailText/nextStep 在受控展开层；只有 command 使用等宽文字与复制。
// 证据、步骤和错误码保持完整，以纯文本展示，不解析 markdown。
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { DiagnoseStatus } from '@/types/sse-protocol';
import type { DiagnosticItemModel } from '@/types/system';
import Link from 'next/link';

const STATUS_TEXT: Readonly<Record<DiagnoseStatus, string>> = {
  ok: '正常',
  // ⚠️ 「提示」而不是「警告」：`info` 是"没有任何东西需要修"。
  info: '提示',
  warn: '警告',
  fail: '失败',
  // ⚠️ 「未得出结论」而不是「失败」：它没说这一项是坏的。
  timeout: '超时未响应',
};

/** 序号跟随首帧顺序；现有圆标之外仍显示数字，不丢掉新增检查的序号。 */
const ORDINAL_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

export interface DiagnosticItemProps {
  item: DiagnosticItemModel;
  /** 这一项在本轮首帧里排第几（从 1 开始）——只用来选一个圆标数字，纯展示。 */
  ordinal: number;
  /**
   * 这一项当前是否展开。由父级 `DiagnosticsCardView` 依据
   * 「非 ok/info 默认展开」的规则 + 用户手动切换的 override 算好，这里只负责渲染。
   */
  expanded: boolean;
  /** 命令 [复制]（clipboard + toast 在 container）。 */
  onCopyHint: (hint: string) => void;
}

export function DiagnosticItemView({ item, ordinal, expanded, onCopyHint }: DiagnosticItemProps) {
  const pending = item.status === undefined && !item.notReturned;
  const pillStatus: StatusPillStatus = item.notReturned ? 'unknown' : (item.status ?? 'pending');
  const hasMore =
    item.detailText !== undefined || item.nextStep !== undefined || item.command !== undefined;
  const ordinalGlyph = ORDINAL_GLYPHS[ordinal - 1] ?? String(ordinal);

  return (
    <AccordionItem
      value={item.id}
      data-testid={`diagnostic-item-${item.id}`}
      data-status={item.notReturned ? 'not-returned' : (item.status ?? 'pending')}
      data-expanded={expanded ? 'true' : 'false'}
      className="flex flex-col gap-1 rounded-md border border-b border-border/60 px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="w-4 flex-none font-mono text-xs text-muted-foreground">
          {ordinalGlyph}
        </span>
        <StatusPill status={pillStatus} className={item.notReturned ? 'border-dashed' : undefined}>
          {item.notReturned ? '未返回' : pending ? '检查中…' : STATUS_TEXT[item.status ?? 'ok']}
        </StatusPill>
        {/* label 占满中间空间并截断，将耗时推到行尾右对齐。 */}
        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
        {item.durationText === undefined ? null : (
          <span className="flex-none text-xs text-muted-foreground">{item.durationText}</span>
        )}
        {/* 只有第 ⑤ 项（联网检查）有这句，且数字读的是服务端首帧下发的配置
            （见 `types/system.ts` 里 `timeoutText` 的字段注释）。 */}
        {item.timeoutText === undefined ? null : (
          <span
            data-testid={`diagnostic-timeout-${item.id}`}
            className="flex-none text-xs text-muted-foreground"
          >
            {item.timeoutText}
          </span>
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
        <AccordionTrigger
          data-testid={`diagnostic-toggle-${item.id}`}
          className="self-start py-0 text-xs font-normal text-muted-foreground underline underline-offset-2 [&>svg]:h-3 [&>svg]:w-3"
        >
          {expanded ? '收起' : '展开详情'}
        </AccordionTrigger>
      ) : null}

      {/* ⚠️ 交给 `AccordionContent` 自己的开合动画，⛔ 不要从外部用 `expanded` 再关一道。
          曾经这里是 `hasMore && expanded ?`，为的是躲开一处假红：Radix `Presence` 靠
          `animationend` 决定何时把内容移出 DOM，满负载跑一整批 story 时那个事件会被挤占，
          断言在收起动画播完前就跑了。但那是**断言没等**，不是动画有问题 ——
          为了让测试稳定而砍掉过渡动效，是拿产品观感去迁就用例。
          ⇒ 动画留着，story 那边改成 `waitFor` 等它真的消失。 */}
      {hasMore ? (
        <AccordionContent className="pb-0 pt-1">
          {/* 第二层 ①：证据、例外条款、为什么。⛔ 一个字都不许截断（§9B）。 */}
          {item.detailText === undefined ? null : (
            <span
              data-testid={`diagnostic-detail-${item.id}`}
              className="block whitespace-pre-wrap break-words text-muted-foreground"
            >
              {item.detailText}
            </span>
          )}

          {item.errorCode === undefined ? null : (
            <span
              data-testid={`diagnostic-code-${item.id}`}
              className="block text-xs text-muted-foreground"
            >
              错误码 {item.errorCode}
            </span>
          )}

          {/* 第二层 ②：下一步。⛔ **普通字体、无复制按钮** —— 它是人话，不是命令。 */}
          {item.nextStep === undefined ? null : (
            <span
              data-testid={`diagnostic-next-${item.id}`}
              className="block whitespace-pre-wrap break-words"
            >
              {item.nextStep}
            </span>
          )}
          {item.imageManagementHref === undefined ? null : (
            <Link
              href={item.imageManagementHref}
              className="inline-flex text-sm underline underline-offset-4"
            >
              去镜像管理
            </Link>
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
        </AccordionContent>
      ) : null}
    </AccordionItem>
  );
}
