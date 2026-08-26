// 镜像卡片（P21-4 §3/§5，F21-4 §3/§5.1）。纯展示、props 驱动、零副作用。
//
// 卡片只收一个算好的 `ImageCardModel`（`lib/image/imageCardModel.ts` 产出）：
// digest 怎么截、时间怎么说、[检查更新] 能不能点，**这里一律不算**——
// view 被 boundaries 禁止 import `lib/`，也被禁用 `useEffect`（F21-4 §3.1 规则 2）。
// 所以「解析于 3 小时前」不会自己走字，那是刻意的：它描述的是一个**不可变对象**，不需要走字。
//
// 两颗按钮**别做成一个**（P21-4 §3）：
//   [重新验证] 问「这个 digest 还合格吗」——只改三级结论，不动 digest、不动 isActive；
//   [检查更新] 问「这个 tag 现在还指向它吗」——才谈得上换镜像。
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ValidationResultView } from '@/views/image/ValidationResult.view';
import type { ImageCardModel } from '@/types/image';

export interface ImageCardProps {
  model: ImageCardModel;
  /**
   * 最近一次 [检查更新] 解出的上游 digest ≠ 卡片记录的 digest。
   * ⚠️ **蓝不是黄**：当前镜像仍然完全可用，这是"有新东西可以看"的信息，不是告警（P21-4 §5）。
   */
  upstreamUpdate?: { newDigestShort: string };
  /**
   * [重新验证] 进行中：按钮 loading + 三态区 spinner，
   * **卡片其余部分保持可读，不整卡骨架屏**——用户要对照的正是"验证前是什么样"（F21-4 §5.1）。
   */
  revalidating?: boolean;
  /** [检查更新] 进行中（解析中）。 */
  checkingUpdate?: boolean;
  /** [禁用]/[启用] 进行中。 */
  toggling?: boolean;
  /** 环境变量摘要（`LOG_LEVEL=info · MY_SECRET=***`；secret 一律掩码，原值不进 DOM）。 */
  envSummary?: string;
  /** 启动命令：MVP **只读**展示，v1.1 才可编辑（P21-4 §10.1）。 */
  startCommand?: string;
  /** 展开的运行参数编辑区（container 注入 `EnvVarEditor`；**行内表格，非弹层**）。 */
  runParamsSlot?: ReactNode;
  onEditRunParams: () => void;
  onRevalidate: () => void;
  onCheckUpdate: () => void;
  onToggle: (next: boolean) => void;
  onDelete: () => void;
  onViewRequirements?: () => void;
  onViewUpstreamChange?: () => void;
  onCopyDigest?: (digest: string) => void;
}

/** 列表初次加载的卡片骨架（F21-4 §6「`isPending` → 卡片骨架」）。 */
export function ImageCardSkeleton() {
  return (
    <div
      data-testid="image-card-skeleton"
      aria-hidden="true"
      className="flex animate-pulse flex-col gap-3 rounded-lg border border-border p-4"
    >
      <div className="h-4 w-40 rounded bg-muted" />
      <div className="h-3 w-64 rounded bg-muted" />
      <div className="h-12 w-full rounded bg-muted" />
      <div className="h-3 w-52 rounded bg-muted" />
    </div>
  );
}

export function ImageCardView({
  model,
  upstreamUpdate,
  revalidating = false,
  checkingUpdate = false,
  toggling = false,
  envSummary,
  startCommand,
  runParamsSlot,
  onEditRunParams,
  onRevalidate,
  onCheckUpdate,
  onToggle,
  onDelete,
  onViewRequirements,
  onViewUpstreamChange,
  onCopyDigest,
}: ImageCardProps) {
  // 全串展开是**本地 UI 态**（非敏感、不跨组件），留在 view 里；截断结果本身由 lib 算好。
  const [digestExpanded, setDigestExpanded] = useState(false);
  const digestFull = model.digestFull;

  return (
    <div
      data-testid="image-card"
      data-image-id={model.id}
      data-active={String(model.isActive)}
      data-status={model.validationStatus}
      className={`flex flex-col gap-3 rounded-lg border border-border p-4 ${
        model.isActive ? '' : 'opacity-60'
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            {model.name}
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {model.canDelete ? '自定义' : '预置'}
            </span>
          </h3>
          <span className="font-mono text-xs text-muted-foreground">{model.refDisplay}</span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground" data-testid="enable-state">
          {model.isActive ? '🟢 已启用' : '⚪ 已禁用'}
        </span>
      </header>

      <div className="relative">
        <ValidationResultView
          status={model.validationStatus}
          warnings={model.warnings}
          errors={model.errors}
          {...(onViewRequirements === undefined ? {} : { onViewRequirements })}
        />
        {revalidating && (
          // 三态区转圈，但**结论与 digest 一个字不改**——服务端返回前前端不猜（F21-4 §5.1）。
          <span
            role="status"
            data-testid="revalidating-spinner"
            className="absolute right-3 top-3 text-xs text-muted-foreground"
          >
            ⏳ 重新验证中…
          </span>
        )}
      </div>

      {model.supportedRuntimes.length > 0 && (
        <p className="text-xs text-muted-foreground">适用：{model.supportedRuntimes.join('、')}</p>
      )}

      {/* ——— 身份行：ref + 钉定 digest + 解析时间，全是派生值（F21-4 §5.1）——— */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
        data-testid="image-identity-row"
      >
        {model.digestState === 'pinned' && digestFull !== undefined ? (
          <>
            <span className="font-mono text-muted-foreground" data-testid="pinned-digest">
              钉定 digest: {digestExpanded ? digestFull : model.digestShort}
            </span>
            <button
              type="button"
              className="text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setDigestExpanded((v) => !v);
              }}
            >
              {digestExpanded ? '收起' : '展开全串'}
            </button>
            {onCopyDigest !== undefined && (
              <button
                type="button"
                aria-label="复制 digest"
                className="text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  onCopyDigest(digestFull);
                }}
              >
                复制
              </button>
            )}
          </>
        ) : (
          // 不留白、不显示假哈希：留白读作"没有 digest"，假哈希读作"已钉死"，两句都是假话。
          <span className="text-amber-400" data-testid="digest-unresolved">
            ⚠️ 未解析
          </span>
        )}

        {/* 缺席就整行不渲染——不是渲染「解析于 NaN 前」。措辞是「解析于」而非「最后验证」（P21-4 §3）。 */}
        {model.resolvedAtLabel !== undefined && (
          <span className="text-muted-foreground" data-testid="resolved-at">
            {model.resolvedAtLabel}
          </span>
        )}

        {model.refKind === 'digest' && (
          <span className="text-muted-foreground" data-testid="digest-ref-note">
            以 digest 注册（无 tag）
          </span>
        )}
      </div>

      {upstreamUpdate !== undefined && (
        // 🔄 信息角标：**信息色（蓝），不是告警色（黄）**。当前镜像仍然完全可用（P21-4 §5）。
        <div
          data-testid="upstream-update-badge"
          data-tone="info"
          className="flex items-center gap-2 rounded-md border border-sky-500/40 px-2 py-1 text-xs text-sky-400"
        >
          <span>🔄 上游该 tag 已指向新镜像（{upstreamUpdate.newDigestShort}）</span>
          {onViewUpstreamChange !== undefined && (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={onViewUpstreamChange}
            >
              查看变更
            </button>
          )}
        </div>
      )}

      {/* ——— 🔧 运行参数区（P21-4 §10.2）——— */}
      <div className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">🔧 运行参数</span>
          <Button type="button" variant="ghost" size="sm" onClick={onEditRunParams}>
            编辑环境变量
          </Button>
        </div>
        <span className="text-muted-foreground" data-testid="env-summary">
          环境变量：{envSummary === undefined || envSummary === '' ? '（未配置）' : envSummary}
        </span>
        {startCommand !== undefined && startCommand !== '' && (
          <span className="text-muted-foreground">
            启动命令：<span className="font-mono">{startCommand}</span>（只读）
          </span>
        )}
        {runParamsSlot}
      </div>

      {/* ——— 操作区 ——— */}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!model.canCheckUpdate || checkingUpdate}
          // 置灰**并说明理由**，不隐藏——隐藏会让人以为这张卡少了个功能（F21-4 §5.1）。
          title={model.checkUpdateDisabledReason}
          onClick={onCheckUpdate}
        >
          {checkingUpdate ? '解析中…' : '检查更新'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={revalidating}
          onClick={onRevalidate}
        >
          {revalidating ? '重新验证中…' : '重新验证'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={toggling}
          onClick={() => {
            onToggle(!model.isActive);
          }}
        >
          {model.isActive ? '禁用' : '启用'}
        </Button>
        {/* 预置镜像（AIO）**不渲染** [删除]，仅可禁用（P21-4 §9）。 */}
        {model.canDelete && (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}>
            删除
          </Button>
        )}
      </div>
    </div>
  );
}
