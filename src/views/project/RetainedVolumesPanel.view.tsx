// 已保留卷面板（F21-6 §3.3 项目菜单「🎁 已保留卷」/ P20 §6 决策 2）。纯展示、props 驱动。
//
// ★ 三条设计上不许被"顺手简化"掉的东西：
//
// ① **两个大小都显示，一个都不能省**（10 §6「保留卷的打包口径」的实测值）。
//    同一个卷宿主实占 1.0 GB、tar 包 14 MB —— **差 70 倍**。只显示 `downloadBytes`，用户会
//    以为清理只能拿回 14 MB（于是不清理，而磁盘正是本项目的真实瓶颈）；只显示 `diskBytes`，
//    用户会以为要下 1 GB（于是不下载）。两个数回答的是两个不同的问题，缺哪个都会**误导**，
//    不是"信息少一点"。⇒ 每行「占用 X · 下载 Y」，标题上再给一次合计。
//
// ② **[下载] 是一个 `<a href download>`，不是按钮 + fetch**（10 §6）。后端给 tar + 精确
//    `Content-Length`（不压缩就是为了这个数给得出来），浏览器据此画真实进度条并走「另存为」。
//    换成 `fetch` → blob 会同时丢掉进度条与另存为，还把一个可能上 GB 的包整个读进内存。
//    ⛔ 这一行绝不要"改成受控的下载按钮"。
//
// ③ **没有「恢复」入口**（P20 §6，2026-08-31）：它的语义还没裁——新建 Task 挂这个卷？覆盖某个
//    现有工作区？来源项目已删时怎么办？三个问题的答案会决定端点形态。⛔ 先定语义再做，
//    在 UI 上摆一个禁用的 [恢复] 同样不行（那是在承诺一件还没决定的事）。
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { RetainedVolumeRow, RetainedVolumeTotals } from '@/types/retainedVolume';

export interface RetainedVolumesPanelProps {
  projectName: string;
  rows: RetainedVolumeRow[];
  totals: RetainedVolumeTotals;
  loading: boolean;
  /** 列表取不回来（≠ 取回来是空的，两者各有分支）。 */
  loadErrorMessage?: string;
  /** 删除失败的人话。 */
  actionErrorMessage?: string;
  /** 正在删除的那一条：**只禁这一行**，其余行照常可用。 */
  deletingId?: string | null;
  /** `GET /api/retained-volumes/:id/archive` 的地址；直接进 `<a href>`。 */
  archiveUrl: (id: string) => string;
  onDelete: (id: string) => void;
}

/** 两个大小的读法。差 70 倍的两个数并排放，不解释一句会被当成界面出错。 */
const SIZE_LEGEND =
  '「占用」是宿主磁盘实占（删掉能拿回的空间）；「下载」是打包成 tar 的大小（.gitignore 命中的不打包，.git 保留）。';

export function RetainedVolumesPanelView({
  projectName,
  rows,
  totals,
  loading,
  loadErrorMessage,
  actionErrorMessage,
  deletingId = null,
  archiveUrl,
  onDelete,
}: RetainedVolumesPanelProps) {
  // 二次确认就地展开（不套第二层弹层——modal 不堆叠，F21-6 §2）。
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 px-5 py-4 text-sm" data-testid="retained-volumes-panel">
      <p className="text-xs text-muted-foreground">
        {projectName} 的已保留卷：Task 销毁时勾选「保留工作区卷」留下的工作区，到期由后台自动清理。
      </p>

      {loading && (
        <p className="text-xs text-muted-foreground" data-testid="retained-volumes-loading">
          正在读取已保留卷…
        </p>
      )}

      {loadErrorMessage !== undefined && loadErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400">
          {loadErrorMessage}
        </p>
      )}

      {!loading && loadErrorMessage === undefined && rows.length === 0 && (
        <div
          className="rounded border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground"
          data-testid="retained-volumes-empty"
        >
          <p>这个项目还没有已保留卷。</p>
          <p className="mt-1">
            销毁任务时勾选「保留工作区卷」，那份工作区就会留在这里，可下载或手动删除。
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="retained-volumes-totals">
            共 {totals.count} 个 · 占用 {totals.diskText} · 全部下载 {totals.downloadText}
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((row) => {
              const busy = deletingId === row.id;
              return (
                <li
                  key={row.id}
                  data-testid="retained-volume-row"
                  className="flex flex-col gap-1 rounded border border-border px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true">🎁</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">
                      {row.originText}
                    </span>
                    {row.countdownText !== undefined && (
                      <span
                        data-testid="retained-volume-countdown"
                        className={
                          'shrink-0 text-xs ' +
                          (row.urgent ? 'text-yellow-300' : 'text-muted-foreground')
                        }
                      >
                        {row.countdownText}
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    {row.sourceText} · 保留于 {row.retainedAtText}
                  </p>

                  {/*
                   * ⚠️ 两个数并排，**都带自己的标签**。去掉任意一半都会造出一个具体的误导，
                   *    见文件头 ①。story 与容器测试各有一条断言钉住"两个都在"。
                   */}
                  <p className="text-xs" data-testid="retained-volume-sizes">
                    占用 <span className="font-mono">{row.diskText}</span> · 下载{' '}
                    <span className="font-mono">{row.downloadText}</span>
                  </p>

                  <div className="flex items-center gap-2 pt-1">
                    {/*
                     * ⛔ 不是按钮。浏览器原生下载：tar + 精确 Content-Length ⇒ 下载栏进度条
                     *    直接可用、另存为可用、前端零代码。见文件头 ②。
                     */}
                    <a
                      href={archiveUrl(row.id)}
                      download
                      data-testid="retained-volume-download"
                      className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-muted"
                    >
                      下载（{row.downloadText}）
                    </a>

                    {confirmingId === row.id ? (
                      <>
                        <span className="text-xs text-red-400">
                          永久删除？删掉后这份工作区不可恢复。
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setConfirmingId(null);
                            onDelete(row.id);
                          }}
                        >
                          {busy ? '删除中…' : '确认删除'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setConfirmingId(null);
                          }}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setConfirmingId(row.id);
                        }}
                      >
                        {busy ? '删除中…' : '删除'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{SIZE_LEGEND}</p>
        </>
      )}

      {actionErrorMessage !== undefined && actionErrorMessage !== '' && (
        <p role="alert" className="text-xs text-red-400">
          {actionErrorMessage}
        </p>
      )}
    </div>
  );
}
