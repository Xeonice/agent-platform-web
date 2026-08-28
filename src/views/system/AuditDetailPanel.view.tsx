// 审计行的 detail 面板（F21-5 §3 组件树）：**行内展开，不弹层**（与 provider 的 [查看日志] 同姿态）。
//
// ⚠️ 内容是**已在写入口脱敏**的 detail（13 §2.8.2）——脱敏不在这里做，也不该在这里做：
// 导出包与 DB 文件是另外两条路，只在渲染时抹一遍等于没抹。
//
// ⚠️ 这里只渲染一个**已经格式化好的字符串**：`JSON.stringify` 在 `lib/audit/auditRowModel.ts`
// 里做完（view 碰不到 lib）。detail 为空的行根本不产出 `detailText`，因此也不会渲染本组件。
export interface AuditDetailPanelProps {
  detailText: string;
}

export function AuditDetailPanelView({ detailText }: AuditDetailPanelProps) {
  return (
    <pre
      data-testid="audit-detail-panel"
      className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground"
    >
      {detailText}
    </pre>
  );
}
