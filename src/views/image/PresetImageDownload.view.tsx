import { CircleX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { PresetImageProvisionOffer } from '@/types/init';

export interface PresetImageDownloadProps {
  offer: PresetImageProvisionOffer;
  headline?: string;
  isProvisioning: boolean;
  statusText?: string;
  progress?: number | null;
  elapsedSeconds?: number;
  error?: string;
  notice?: string;
  disabledReason?: string;
  onPrepare: () => void;
}

export function PresetImageDownloadView({
  offer,
  headline,
  isProvisioning,
  statusText,
  progress,
  elapsedSeconds,
  error,
  notice,
  disabledReason,
  onPrepare,
}: PresetImageDownloadProps) {
  return (
    <section
      aria-label="下载到本机"
      className="space-y-2 rounded-md border border-[hsl(var(--info)/0.3)] bg-[hsl(var(--info)/0.06)] p-3 text-sm"
    >
      <h4 className="font-medium">下载到本机</h4>
      <p className="text-xs text-muted-foreground">
        {headline ?? '预制镜像还没下载到本机'}
        ：第一个任务会先下载它，要多等几分钟。现在就可以提前下，不必等到发起任务时。
      </p>
      <p className="break-all text-xs text-muted-foreground">
        {offer.from} → {offer.to}
        {offer.sizeBytes === null
          ? ''
          : ` · 约 ${String(Math.round(offer.sizeBytes / 1024 / 1024))} MB`}
      </p>
      {statusText === undefined ? null : (
        <p role="status" className="text-xs">
          {statusText}
        </p>
      )}
      {isProvisioning ? (
        <div className="space-y-1">
          {progress === null || progress === undefined ? (
            <>
              <style>
                {
                  '@keyframes image-download-indeterminate{from{transform:translateX(-100%)}to{transform:translateX(330%)}}'
                }
              </style>
              <div
                role="progressbar"
                aria-label="镜像准备进度"
                aria-valuetext="进度未知"
                className="h-1.5 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-1/3 rounded-full bg-primary [animation:image-download-indeterminate_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
              </div>
              <p className="text-xs text-muted-foreground">
                进度未知 —— 期间数字没变不代表卡死，正在持续写入。
              </p>
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Progress value={progress * 100} className="flex-1" />
              <span className="text-xs tabular-nums">{Math.round(progress * 100)}%</span>
            </div>
          )}
          {elapsedSeconds === undefined ? null : (
            <p className="text-xs text-muted-foreground">已用时 {elapsedSeconds} 秒</p>
          )}
        </div>
      ) : null}
      {notice === undefined ? null : (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <div role="alert" className="space-y-1 text-xs">
          <p className="flex items-start gap-1 text-destructive">
            <CircleX aria-hidden="true" className="h-4 w-4 shrink-0" />
            {error}
          </p>
          <p className="text-muted-foreground">
            多半是网速：镜像下载源够得着、但拉得太慢，中途就断了。换个网络环境后再点 [准备镜像]
            重试。
          </p>
        </div>
      )}
      <Button
        type="button"
        size="sm"
        disabled={isProvisioning || disabledReason !== undefined}
        onClick={onPrepare}
      >
        {isProvisioning ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
        {isProvisioning ? '准备中…' : '准备镜像'}
      </Button>
      {disabledReason === undefined ? null : (
        <p className="text-xs text-muted-foreground">{disabledReason}</p>
      )}
    </section>
  );
}
