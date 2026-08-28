// 断层提示（F21-5 §3A ③）：**中间漏了多少条，如实说**。
//
// ⚠️ 这个组件存在的全部意义，是不让列表**假装连续**。异常风暴时 30s 内可能产生 >200 条
// 事件——那恰恰是最需要看清的时刻——增量一次拉不完，中间就有一段没加载。
// 只 prepend 一页就当无事发生，UI 上是连续的，用户会据此判断"这段时间没事发生"。
//
// ⛔ 它也**不自动填**：点一次填一段。异常风暴下自动循环追平是无界请求，
// 而且会把用户正在看的位置冲走。
import { Button } from '@/components/ui/button';

export interface AuditGapNoticeProps {
  /** 断层区间（只用于文案里如实说明范围，不参与请求）。 */
  afterSeq: number;
  beforeSeq: number;
  filling?: boolean;
  onFill: () => void;
}

export function AuditGapNoticeView({
  afterSeq,
  beforeSeq,
  filling = false,
  onFill,
}: AuditGapNoticeProps) {
  return (
    <li
      data-testid="audit-gap-notice"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">⚠️</span>
        <span>
          此处有未加载的事件（seq {afterSeq} – {beforeSeq} 之间，条数未知）
        </span>
      </span>
      <Button type="button" size="sm" variant="outline" disabled={filling} onClick={onFill}>
        {filling ? '加载中…' : '加载中间部分'}
      </Button>
    </li>
  );
}
