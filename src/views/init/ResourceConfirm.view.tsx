// Step4「资源池确认」（F21-8 §3 · P21-8 §2/§7）。纯展示、props 驱动、零副作用。
//
// ⚠️ **「资源偏低」是黄字不是门**（P21-8 §2「但仍可继续」）：CPU<2 核 / RAM<4GB /
// 可用磁盘<50GB 命中时给一句建议，[确认，开始使用] **照常可点**。做成 disabled 会让一台
// 小机器根本装不起来，而产品明确说了它只是提醒。
//
// ⚠️ **磁盘按真实构成说**（P21-8 §2，2026-08 实测）：预制镜像约 13GB、boxlite 的 rootfs
// 缓存实测约 31GB、每个 Task 一份工作区副本，三项都在持续增长。只报总量会让人以为宽裕。
//
// ⚠️ **[确认，开始使用] 是整个向导里唯一会写 `initialized=true` 的按钮。** 前面每一步的
// 保存都只是存配置。
import { Button } from '@/components/ui/button';
import type { ResourceConfirmModel } from '@/types/init';

export interface ResourceConfirmProps {
  model: ResourceConfirmModel | undefined;
  /** 资源接口失败：⚠️ **不许渲染成 0%/空**（那会把"读不到"伪装成"很空闲"）。 */
  isError: boolean;
  isFinishing: boolean;
  onFinish: () => void;
}

export function ResourceConfirmView({
  model,
  isError,
  isFinishing,
  onFinish,
}: ResourceConfirmProps) {
  return (
    <section data-testid="resource-confirm" className="flex flex-col gap-3">
      {isError ? (
        <p role="alert" data-testid="resource-error" className="text-sm text-red-500">
          读不到本机资源水位 —— 这不代表资源充足，只代表这一项没查出来。
          仍可继续初始化，装好后可在系统状态页再看。
        </p>
      ) : model === undefined ? (
        <p className="text-sm text-muted-foreground">正在读取本机资源…</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {model.rows.map((row) => (
              <li
                key={row.id}
                data-testid={`resource-row-${row.id}`}
                data-low={row.low ? 'true' : 'false'}
                data-level={row.level}
                className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2 text-sm"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true">{row.low ? '⚠️' : '✅'}</span>
                  <span className="font-medium">{row.label}</span>
                  <span>{row.valueText}</span>
                </span>
                {row.noteText === undefined ? null : (
                  <span className="text-xs text-muted-foreground">{row.noteText}</span>
                )}
              </li>
            ))}
          </ul>

          <p data-testid="resource-reserved" className="text-xs text-muted-foreground">
            {model.reservedText}
          </p>

          {model.lowText === undefined ? null : (
            <p
              role="status"
              data-testid="resource-low"
              className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm text-amber-600"
            >
              ⚠️ {model.lowText}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* ⚠️ 资源偏低**不禁用**它（见文件头）。只有请求在途时才禁，防重复提交。 */}
        <Button type="button" disabled={isFinishing} onClick={onFinish}>
          {isFinishing ? '正在完成…' : '确认，开始使用'}
        </Button>
        <span className="text-xs text-muted-foreground">
          点它才会写入初始化完成标记 —— 这是一次性操作，此后配置修改全部走「设置 → 系统状态」。
        </span>
      </div>
    </section>
  );
}
