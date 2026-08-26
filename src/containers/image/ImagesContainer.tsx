'use client';
// 镜像管理页容器（F21-4 §3/§5）：**唯一的 view ↔ hook 粘合点**。
// 逻辑、副作用、派生值全在 `useImageManager`（07 §2/§6），这里只把返回值装配进视图。
//
// ⚠️ 两颗按钮在这里也**分别接在两个 handler 上**，别顺手合并：
//   [重新验证] → `m.revalidate`（问「这个 digest 还合格吗」）；
//   [检查更新] → `m.checkUpdate`（问「这个 tag 现在还指向它吗」）。
// 一旦有人图省事把后者接到前者上，digest 就会跟着变——`__tests__` 里有一条用例守着它。
//
// ⚠️ [启用] **不是** `PATCH { isActive:true }`：`m.toggle(id, true)` 内部走
// `POST /:id/activate`（后端对前者明确回 400 并指向 activate）。
import { useRef } from 'react';
import { useImageManager } from '@/hooks/image/useImages';
import { useEscapeKey } from '@/hooks/_shared/useEscapeKey';
import { useModalFocus } from '@/hooks/_shared/useModalFocus';
import { ImageCardView, ImageCardSkeleton } from '@/views/image/ImageCard.view';
import { ImageVersionHistoryView } from '@/views/image/ImageVersionHistory.view';
import { EnvVarEditorView } from '@/views/image/EnvVarEditor.view';
import { RegisterImageModalView } from '@/views/image/RegisterImageModal.view';
import { UpdateCompareDialogView } from '@/views/image/UpdateCompareDialog.view';
import { ConfirmDialogView } from '@/views/settings/ConfirmDialog.view';
import { Button } from '@/components/ui/button';
import type { ImageStatusFilter } from '@/hooks/image/useImages';

const FILTERS: { key: ImageStatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'valid', label: '✅ 有效' },
  { key: 'warning', label: '⚠️ 警告' },
  { key: 'invalid', label: '❌ 无效' },
];

export function ImagesContainer() {
  const m = useImageManager();
  const registerModalRef = useRef<HTMLDivElement>(null);

  // 三个弹层各自的 Esc；焦点入弹层由 useModalFocus 接管（URI 输入框自己还带 autoFocus）。
  useEscapeKey(m.registerOpen && !m.validating && !m.saving, m.closeRegister);
  useEscapeKey(m.compare !== null && !m.adopting, m.dismissCompare);
  useEscapeKey(m.pendingDelete !== null && !m.deleting, m.cancelDelete);
  useModalFocus(m.registerOpen, registerModalRef);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">已注册的 OCI 镜像</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="搜索镜像"
            placeholder="按名称或坐标搜索"
            className="w-56 rounded-md border border-border bg-transparent px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            value={m.search}
            onChange={(e) => {
              m.setSearch(e.target.value);
            }}
          />
          <div className="flex gap-1" role="group" aria-label="状态过滤">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                type="button"
                size="sm"
                variant={m.statusFilter === f.key ? 'default' : 'outline'}
                aria-pressed={m.statusFilter === f.key}
                onClick={() => {
                  m.setStatusFilter(f.key);
                }}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <Button type="button" size="sm" onClick={m.openRegister}>
            + 注册新镜像
          </Button>
        </div>
      </header>

      {m.loading && (
        <div className="flex flex-col gap-3">
          <ImageCardSkeleton />
          <ImageCardSkeleton />
        </div>
      )}

      {/* 「一张都没注册」与「过滤后为空」是两句不同的话：前者给 CTA，后者只是让人改条件。 */}
      {!m.loading && m.noImagesAtAll && (
        <div
          data-testid="images-empty"
          className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground"
        >
          <p>还没有注册任何镜像。注册一张之后，它会出现在发起任务向导的镜像下拉里。</p>
          <Button type="button" size="sm" onClick={m.openRegister}>
            + 注册新镜像
          </Button>
        </div>
      )}

      {!m.loading && !m.noImagesAtAll && m.cards.length === 0 && (
        <p data-testid="images-filtered-empty" className="text-sm text-muted-foreground">
          没有符合当前搜索/过滤条件的镜像。
        </p>
      )}

      <div className="flex flex-col gap-3">
        {m.cards.map((card) => (
          <div
            key={card.imageId}
            data-testid="image-card-slot"
            data-highlighted={String(m.highlightedImageId === card.imageId)}
            className={
              m.highlightedImageId === card.imageId ? 'rounded-lg ring-2 ring-primary' : undefined
            }
          >
            <ImageCardView
              model={card.model}
              {...(card.upstreamUpdate === undefined
                ? {}
                : { upstreamUpdate: card.upstreamUpdate })}
              revalidating={card.revalidating}
              checkingUpdate={card.checkingUpdate}
              toggling={card.toggling}
              envSummary={card.envSummary}
              runParamsSlot={
                m.envEditor?.manifestId === card.manifestId ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <EnvVarEditorView
                      rows={m.envEditor.rows}
                      errors={m.envEditor.errors}
                      valueByteCounts={m.envEditor.valueByteCounts}
                      canAddRow={m.envEditor.canAddRow}
                      disabled={m.savingEnv}
                      onChangeKey={m.changeEnvKey}
                      onChangeValue={m.changeEnvValue}
                      onToggleSecret={m.toggleEnvSecret}
                      onRemoveRow={m.removeEnvRow}
                      onAddRow={m.addEnvRow}
                    />
                    {/* 归不了位的后端错误 + envelope 的 message：**不吞**，否则"后端拒了、界面一片安静"。 */}
                    {m.envEditor.generalError !== undefined && (
                      <p
                        role="alert"
                        data-testid="env-general-error"
                        className="text-xs text-red-400"
                      >
                        {m.envEditor.generalError}
                      </p>
                    )}
                    {m.envEditor.unmapped.map((issue) => (
                      <p key={issue.message} className="text-[11px] text-red-400">
                        {issue.message}
                      </p>
                    ))}
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={m.savingEnv} onClick={m.saveEnv}>
                        {m.savingEnv ? '保存中…' : '保存运行参数'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={m.savingEnv}
                        onClick={m.closeEnvEditor}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : undefined
              }
              onEditRunParams={() => {
                if (m.envEditor?.manifestId === card.manifestId) m.closeEnvEditor();
                else m.openEnvEditor(card.manifestId);
              }}
              onRevalidate={() => {
                m.revalidate(card.manifestId);
              }}
              onCheckUpdate={() => {
                m.checkUpdate(card.manifestId);
              }}
              onToggle={(next) => {
                m.toggle(card.manifestId, next);
              }}
              onDelete={() => {
                m.requestDelete(card.manifestId);
              }}
              onViewRequirements={m.viewRequirements}
              onViewUpstreamChange={() => {
                m.checkUpdate(card.manifestId);
              }}
              onCopyDigest={m.copyDigest}
            />
            <div className="mt-2">
              <ImageVersionHistoryView
                rows={card.history}
                {...(card.toggling ? { switchingId: card.manifestId } : {})}
                onSwitchVersion={m.activateVersion}
              />
            </div>
          </div>
        ))}
      </div>

      {m.registerOpen && (
        <div ref={registerModalRef}>
          <RegisterImageModalView
            uri={m.uri}
            onUriChange={m.onUriChange}
            onValidate={m.validate}
            onSave={m.save}
            onCancel={m.closeRegister}
            validating={m.validating}
            saving={m.saving}
            {...(m.validationResult === undefined ? {} : { result: m.validationResult })}
            conclusionInvalidated={m.conclusionInvalidated}
            {...(m.uriError === undefined ? {} : { uriError: m.uriError })}
            {...(m.duplicate === undefined ? {} : { duplicate: m.duplicate })}
            onLocateExisting={m.locateExisting}
            onViewRequirements={m.viewRequirements}
          />
        </div>
      )}

      {m.compare !== null && (
        <UpdateCompareDialogView
          imageName={m.compare.imageName}
          refDisplay={m.compare.refDisplay}
          currentDigestShort={m.compare.currentDigestShort}
          {...(m.compare.currentResolvedAtLabel === undefined
            ? {}
            : { currentResolvedAtLabel: m.compare.currentResolvedAtLabel })}
          upstreamDigestShort={m.compare.upstreamDigestShort}
          upstreamValidation={m.compare.upstreamValidation}
          updating={m.adopting}
          onAdopt={m.adoptNewVersion}
          onDismiss={m.dismissCompare}
          onViewRequirements={m.viewRequirements}
        />
      )}

      {m.pendingDelete !== null && (
        <ConfirmDialogView
          title="删除镜像版本"
          message={`即将删除 ${m.pendingDelete.imageName}（${m.pendingDelete.version}）这一行 manifest。此操作不可逆；被 Task 引用中的版本会被平台拒绝删除，那时请改为 [禁用]。`}
          confirmLabel="删除"
          busy={m.deleting}
          onConfirm={m.confirmDelete}
          onCancel={m.cancelDelete}
        />
      )}
    </div>
  );
}
