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
  filling?: boolean;
  onFill: () => void;
}

/**
 * ⛔ **不再把 `seq` 区间写在屏幕上**（2026-09 修）。原文是「此处有未加载的事件
 * （seq 1200 – 1587 之间，条数未知）」—— `seq` 是**数据库列名**，而那两个内部序号对用户
 * 毫无意义：他既不知道 1200 是什么时候，也不能拿这两个数做任何事。
 * 唯一有信息量的半句是「条数未知」，它留着；⚠️ **这不是把精确性删掉** —— 区间本来就
 * 「只用于文案，不参与请求」，填洞用的是 hook 里那份 `gap`，一个字都没动。
 */
export function AuditGapNoticeView({ filling = false, onFill }: AuditGapNoticeProps) {
  return (
    <li
      data-testid="audit-gap-notice"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-amber-500/60 bg-amber-500/5 px-3 py-2 text-xs"
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true">⚠️</span>
        <span>这里有一段事件还没加载（条数未知）</span>
      </span>
      <Button type="button" size="sm" variant="outline" disabled={filling} onClick={onFill}>
        {filling ? '加载中…' : '加载中间部分'}
      </Button>
    </li>
  );
}
