// [导出日志]（F21-5 §5 / P21-5 §10.3）。
//
// ⚠️ 它不是 Query 也不是 Mutation：**没有响应体要进缓存**——包由浏览器直接落盘，
// 前端不解析（几十 MB 的 tar.gz 读进 JS 堆没有任何用途）。包成 hook 只是为了让
// container 不直接 import service（07 §3 规则 1：container 只能碰 view/hook/type/store/component）。
import { useCallback } from 'react';
import { exportAudit } from '@/services/api/system.service';

export function useExportAuditLogs(): () => void {
  return useCallback(() => {
    exportAudit();
  }, []);
}
