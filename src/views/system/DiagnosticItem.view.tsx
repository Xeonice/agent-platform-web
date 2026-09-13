// 单项诊断结果（F21-5 §3 · P21-5 §9A/§9B · design/design-notes.md §4 Phase 1）。
// 纯展示、props 驱动、零副作用。
//
// ⚠️ **`info` 渲染 `Info` 图标，不是 `AlertTriangle`。** 这是本文件存在的头号理由。
// 预制镜像那一项的第 5 步（镜像已就绪但还没下载到本机）常态就是 `info`：镜像是好的，
// 只是首个任务要多等几分钟。渲染成警告色会让用户去修一个不需要修的东西，而他能想到的
// "修法"是删了重推——那会让情况更糟。⇒ `StatusPill` 的八态 variant 已经把 `info`/`warn`
// 分成两套独立颜色 + 独立图标（design-notes §1 问题 2），这里只管把 `item.status` 原样
// 交给它，⛔ 不许在这个文件里再长出一份自己的图标/颜色查表。
//
// ⚠️ **`timeout` 也有自己的图标（`Clock`，`StatusPill` 已定）。** 「没查出来」不是
// 「查出来是坏的」：前者常见于「系统好像坏了」的场景，而它**不构成**这一项坏了的结论。
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
//
// ⚠️ **展开状态不再是本地 `useState`。** Phase 1 接入「非 ok/info 默认展开」
// （design-notes §1 问题 1）：哪几项默认展开由 `DiagnosticsCardView` 的 Accordion
// 统一算（`lib/system/diagnosticsDisclosure.ts`），本组件只管接一个 `expanded: boolean`
// 照着画——放回本地 state 会让"结果一到达就该展开"这条规则无从生效（组件早就带着
// 上一次的展开状态挂在那儿，不会因为 status 从 undefined 变成 fail 而自动打开）。
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusPillStatus } from '@/components/ui/status-pill';
import type { DiagnoseStatus } from '@/types/sse-protocol';
import type { DiagnosticItemModel } from '@/types/system';

const STATUS_TEXT: Readonly<Record<DiagnoseStatus, string>> = {
  ok: '正常',
  // ⚠️ 「提示」而不是「警告」：`info` 是"没有任何东西需要修"。
  info: '提示',
  warn: '警告',
  fail: '失败',
  // ⚠️ 「未得出结论」而不是「失败」：它没说这一项是坏的。
  timeout: '未得出结论',
};

/**
 * ①–⑧：固定顺序的序号圆标（design/prototype.html `'①②③④⑤⑥⑦⑧'[d.id-1]`）。⚠️ 八项
 * 的展示顺序恒来自服务端首帧（`DiagnosticsCardModel.items`），这里只是把"它在这一次
 * 首帧里排第几"翻成一个圆圈数字，⛔ 不是把某个 check id 写死绑定到某个序号。
 */
const ORDINAL_GLYPHS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

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
  const pending = item.status === undefined;
  const pillStatus: StatusPillStatus = item.status ?? 'pending';
  const hasMore =
    item.detailText !== undefined || item.nextStep !== undefined || item.command !== undefined;
  const ordinalGlyph = ORDINAL_GLYPHS[ordinal - 1];

  return (
    <AccordionItem
      value={item.id}
      data-testid={`diagnostic-item-${item.id}`}
      data-status={item.status ?? 'pending'}
      data-expanded={expanded ? 'true' : 'false'}
      className="flex flex-col gap-1 rounded-md border border-b border-border/60 px-3 py-2 text-sm"
    >
      <span className="flex flex-wrap items-center gap-2">
        {/* 序号圆标（design/design-notes.md §4 Phase 1：诊断项 ①–⑧），紧跟展开箭头之后、
            状态 pill 之前——与 design/prototype.html 的顺序一致。`ordinal` 超出 8 项时
            （契约扩容/schema 不匹配的边角）宁可不画，也不许显示 `undefined`。 */}
        {ordinalGlyph === undefined ? null : (
          <span
            aria-hidden="true"
            className="w-4 flex-none font-mono text-xs text-muted-foreground"
          >
            {ordinalGlyph}
          </span>
        )}
        <StatusPill status={pillStatus}>
          {pending ? '检查中…' : STATUS_TEXT[item.status ?? 'ok']}
        </StatusPill>
        {/* `flex-1` 让 label 占满中间空间，把耗时推到行尾右对齐
            （design/prototype.html：`flex-1 truncate` 在 label 上，耗时是最后一个 flex 子项）。 */}
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
