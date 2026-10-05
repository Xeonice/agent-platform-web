'use client';
// 自动化面板容器（F21-7 §2/§3）：hook ↔ view 的唯一粘合点（07 §2）。
//
// 列表、详情、表单、删除确认在容器拥有的同一个 AppDialog 内切换（REQ-AUT-002）。
// 未提供 onClose 时只渲染正文，供独立视图故事与已有测试宿主使用。
//
// ⚠️ 本容器自己不做任何判断（文案 / 状态判定 / payload 构造全在 `lib/automation/*`，经 hook 转接）——
//   container 被 boundaries 禁止 import `lib/`。
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useAutomations } from '@/hooks/automation/useAutomations';
import { useAutomationRunFocus } from '@/hooks/automation/useAutomationRunFocus';
import { useAutomationDeletionPreview } from '@/hooks/automation/useAutomationDeletionPreview';
import { AppDialogView } from '@/views/common/AppDialog.view';
import { DeleteAutomationConfirmView } from '@/views/project/DeleteAutomationConfirm.view';
import { useAutomationRuns } from '@/hooks/automation/useAutomationRuns';
import { draftFromDto, emptyDraft, useAutomationForm } from '@/hooks/automation/useAutomationForm';
import { useAutomationPresentation } from '@/hooks/automation/useAutomationPresentation';
import { useRuntimes } from '@/hooks/credential/useRuntimes';
import { AutomationListView } from '@/views/project/AutomationList.view';
import { AutomationDetailView } from '@/views/project/AutomationDetail.view';
import { AutomationFormView } from '@/views/project/AutomationForm.view';
import type { AutomationDraft } from '@/hooks/automation/useAutomationForm';

export type AutomationPanelView = 'list' | 'detail' | 'form' | 'confirm';

export interface AutomationsPanelContainerProps {
  projectId: string;
  /** 关面板 + 在工作台选中该 Task（F21-7 §5「[打开 Task]」）。缺席则历史行不渲染该按钮。 */
  onOpenTask?: (sandboxId: string) => void;
  onViewArtifacts?: (sandboxId: string) => void;
  onClose?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  projectName?: string;
  /** 任务来源入口定位规则；规则已删除时仍落到列表。 */
  focusRuleId?: string;
  /** 供 story / 测试指定初始视图；生产恒为 'list'。 */
  initialView?: AutomationPanelView;
}

export function AutomationsPanelContainer({
  projectId,
  onOpenTask,
  onViewArtifacts,
  onClose,
  onCloseAutoFocus,
  projectName,
  focusRuleId,
  initialView = 'list',
}: AutomationsPanelContainerProps) {
  const runtimes = useRuntimes();
  const runtimeNames = useMemo(
    () =>
      Object.fromEntries((runtimes.data ?? []).map((runtime) => [runtime.id, runtime.displayName])),
    [runtimes.data],
  );
  const automations = useAutomations(projectId, runtimeNames);

  const [view, setView] = useState<AutomationPanelView>(
    focusRuleId === undefined ? initialView : 'detail',
  );
  const [selectedId, setSelectedId] = useState<string | null>(focusRuleId ?? null);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  /**
   * 这一次进详情是不是从 [查看原因] 来的。为真 ⇒ 运行历史自动展开最近一次算失败的那条。
   *
   * ⚠️ 单独一位而不是复用 `selectedId`：从规则名进来和从 [查看原因] 进来是**两个意图**，
   *    前者是"我想看看这条规则"，后者是"告诉我它为什么出问题"。合成一个的话，
   *    每次点规则名都会自动展开一条失败记录——那是另一种噪音。
   */
  const [focusLatestFailure, setFocusLatestFailure] = useState(false);
  // ⚠️ 草稿（含 prompt）只活在这里与 useAutomationForm 的 useState 里：15 §3.5 安全红线。
  const [formSeed, setFormSeed] = useState<AutomationDraft>(() => emptyDraft());
  const form = useAutomationForm(formSeed);

  const selectedDto = useMemo(
    () => automations.dtos.find((dto) => dto.id === selectedId),
    [automations.dtos, selectedId],
  );
  const selectedRow = useMemo(
    () => automations.rows.find((row) => row.id === selectedId),
    [automations.rows, selectedId],
  );

  const runs = useAutomationRuns(
    (view === 'detail' || view === 'confirm') && selectedDto !== undefined ? selectedDto.id : null,
    selectedDto?.timezone ?? 'UTC',
  );

  const presentation = useAutomationPresentation(selectedDto, runtimeNames);
  const focusRegionRef = useAutomationRunFocus(runs.rows, view === 'detail' && focusLatestFailure);
  const deletionPreview = useAutomationDeletionPreview(view === 'confirm' ? selectedId : null);

  const handleNewRule = useCallback(() => {
    const seed = emptyDraft();
    setFormSeed(seed);
    form.reset(seed);
    setFormMode('create');
    setView('form');
  }, [form]);

  const handleSelectRule = useCallback((id: string) => {
    setSelectedId(id);
    setFocusLatestFailure(false);
    setView('detail');
  }, []);

  const handleEdit = useCallback(
    (id: string) => {
      const dto = automations.dtos.find((d) => d.id === id);
      if (dto === undefined) return;
      const seed = draftFromDto(dto);
      setFormSeed(seed);
      form.reset(seed);
      setSelectedId(id);
      setFormMode('edit');
      setView('form');
    },
    [automations.dtos, form],
  );

  const handleSave = useCallback(() => {
    if (!form.canSave) return;
    const run = async (): Promise<void> => {
      if (formMode === 'create') {
        // ★ 创建 payload **带 timezone**（这一刻就是快照，23 I-AUT-9）。
        const created = await automations.create(form.createPayload());
        setSelectedId(created.id);
      } else if (selectedId !== null) {
        // ★ 编辑 payload **默认不带 timezone**（用户没显式改过就不出现这个键）。
        await automations.update(selectedId, form.updatePayload());
      }
      setView('detail');
    };
    void run().catch(() => {
      // 错误已由 mutation 的 error 状态承载并渲染成人话，这里只是不让 rejection 逃逸。
    });
  }, [automations, form, formMode, selectedId]);

  const handleDelete = useCallback(
    (id: string) => {
      void automations
        .remove(id)
        .then(() => {
          setSelectedId(null);
          setView('list');
        })
        .catch(() => {
          /* 错误由 actionErrorMessage 渲染。 */
        });
    },
    [automations],
  );

  /**
   * 列表行的 [查看原因]。
   *
   * ⚠️ 此前它只做了 `setView('detail')` —— 按钮承诺了"原因"，给到的却是一个原因仍然
   *    折叠着的页面。现在多带一位 `focusLatestFailure`，让运行历史把最近一次算失败的
   *    那条直接展开。⛔ 不许退回"只切视图"：那等于按钮上的字是假的。
   */
  const handleShowFailure = useCallback((id: string) => {
    setSelectedId(id);
    setFocusLatestFailure(true);
    setView('detail');
  }, []);

  const runtimeOptions = useMemo(
    () => (runtimes.data ?? []).map((rt) => ({ id: rt.id, label: rt.displayName })),
    [runtimes.data],
  );

  const title =
    view === 'confirm' ? `删除自动化规则「${selectedDto?.name ?? ''}」？` : '自动化规则';
  const wrap = (content: ReactNode) =>
    onClose === undefined ? (
      content
    ) : (
      <AppDialogView
        title={title}
        {...(projectName === undefined ? {} : { subtitle: `在 ${projectName} 中` })}
        testId="automations-modal"
        busy={automations.saving}
        {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
        onClose={() => {
          if (view === 'confirm') setView('detail');
          else onClose();
        }}
      >
        {content}
      </AppDialogView>
    );
  if (view === 'confirm' && selectedDto !== undefined)
    return wrap(
      <DeleteAutomationConfirmView
        name={selectedDto.name}
        {...(selectedRow?.nextTriggerText === undefined
          ? {}
          : { nextTriggerText: selectedRow.nextTriggerText })}
        {...(deletionPreview.isError || deletionPreview.data === undefined
          ? {}
          : { preview: deletionPreview.data })}
        busy={automations.saving}
        {...(automations.actionErrorMessage === undefined
          ? {}
          : { errorMessage: automations.actionErrorMessage })}
        onCancel={() => {
          setView('detail');
        }}
        onDelete={() => {
          handleDelete(selectedDto.id);
        }}
      />,
    );

  if (view === 'form') {
    return wrap(
      <AutomationFormView
        mode={formMode}
        draft={form.draft}
        errors={form.errors}
        canSave={form.canSave}
        saving={automations.saving}
        promptCount={form.promptCount}
        schedulePreview={form.schedulePreview}
        runtimeOptions={runtimeOptions}
        runtimesLoading={runtimes.isPending}
        webhookDeliveryNote={presentation.webhookDeliveryNote}
        webhookTestPhase={automations.webhookTestState.phase}
        {...(automations.webhookTestState.phase === 'error'
          ? { webhookTestErrorMessage: automations.webhookTestState.message }
          : {})}
        {...(automations.actionErrorMessage === undefined
          ? {}
          : { saveErrorMessage: automations.actionErrorMessage })}
        onPatch={form.patch}
        onBlurField={form.touch}
        onTimeZoneChange={form.setTimeZone}
        onTestWebhook={() => {
          void automations.sendWebhookTest(form.draft.webhookUrl).catch(() => {
            /* 结果由 webhookTestState 承载。 */
          });
        }}
        onSave={handleSave}
        onCancel={() => {
          automations.resetWebhookTest();
          setView(formMode === 'create' ? 'list' : 'detail');
        }}
      />,
    );
  }

  if (view === 'detail' && selectedRow !== undefined && selectedDto !== undefined) {
    return wrap(
      <AutomationDetailView
        row={selectedRow}
        focusRegionRef={focusRegionRef}
        onRetryRuns={runs.refresh}
        {...(onViewArtifacts === undefined ? {} : { onViewArtifacts })}
        focusLatestFailure={focusLatestFailure}
        configLines={presentation.configLines}
        promptPreview={presentation.promptPreview}
        busy={automations.togglingId === selectedRow.id}
        {...(automations.actionErrorMessage === undefined
          ? {}
          : { actionErrorMessage: automations.actionErrorMessage })}
        runs={{
          rows: runs.rows,
          previewRows: runs.previewRows,
          loading: runs.loading,
          ...(runs.loadErrorMessage === undefined
            ? {}
            : { loadErrorMessage: runs.loadErrorMessage }),
          hasMore: runs.hasMore,
          loadingMore: runs.loadingMore,
        }}
        onBack={() => {
          setView('list');
        }}
        onEdit={handleEdit}
        onToggle={automations.toggle}
        onDelete={() => {
          setView('confirm');
        }}
        onLoadMoreRuns={runs.loadMore}
        {...(onOpenTask === undefined ? {} : { onOpenTask })}
      />,
    );
  }

  return wrap(
    <AutomationListView
      rows={automations.rows}
      loading={automations.loading}
      {...(automations.loadErrorMessage === undefined
        ? {}
        : { loadErrorMessage: automations.loadErrorMessage })}
      {...(automations.actionErrorMessage === undefined
        ? {}
        : { actionErrorMessage: automations.actionErrorMessage })}
      selectedId={selectedId}
      togglingId={automations.togglingId}
      atLimit={automations.atLimit}
      onCreate={handleNewRule}
      onRetry={automations.refresh}
      onSelect={handleSelectRule}
      onToggle={automations.toggle}
      onShowFailure={handleShowFailure}
    />,
  );
}
