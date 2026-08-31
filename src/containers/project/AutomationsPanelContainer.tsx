'use client';
// 自动化面板容器（F21-7 §2/§3）：hook ↔ view 的唯一粘合点（07 §2）。
//
// ★ **列表 ⇄ 详情 ⇄ 表单是同一面板内的视图切换，不是三层弹层**（F21-7 §2 / P20 §8.4）。
//   本容器整个活在 `WorkbenchContainer` 的一层 `ModalShell` 里，`view` 只是它的内部状态。
//   `containers/project/__tests__` 里有一条断言钉住"全程只有一个 role=dialog"。
//
// ⚠️ 本容器自己不做任何判断（文案 / 状态判定 / payload 构造全在 `lib/automation/*`，经 hook 转接）——
//   container 被 boundaries 禁止 import `lib/`。
import { useCallback, useMemo, useState } from 'react';
import { useAutomations } from '@/hooks/automation/useAutomations';
import { useAutomationRuns } from '@/hooks/automation/useAutomationRuns';
import { draftFromDto, emptyDraft, useAutomationForm } from '@/hooks/automation/useAutomationForm';
import { useAutomationPresentation } from '@/hooks/automation/useAutomationPresentation';
import { useRuntimes } from '@/hooks/credential/useRuntimes';
import { AutomationListView } from '@/views/project/AutomationList.view';
import { AutomationDetailView } from '@/views/project/AutomationDetail.view';
import { AutomationFormView } from '@/views/project/AutomationForm.view';
import type { AutomationDraft } from '@/hooks/automation/useAutomationForm';

export type AutomationPanelView = 'list' | 'detail' | 'form';

export interface AutomationsPanelContainerProps {
  projectId: string;
  /** 关面板 + 在工作台选中该 Task（F21-7 §5「[打开 Task]」）。缺席则历史行不渲染该按钮。 */
  onOpenTask?: (sandboxId: string) => void;
  /** 供 story / 测试指定初始视图；生产恒为 'list'。 */
  initialView?: AutomationPanelView;
}

export function AutomationsPanelContainer({
  projectId,
  onOpenTask,
  initialView = 'list',
}: AutomationsPanelContainerProps) {
  const automations = useAutomations(projectId);
  const runtimes = useRuntimes();

  const [view, setView] = useState<AutomationPanelView>(initialView);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
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
    view === 'detail' && selectedDto !== undefined ? selectedDto.id : null,
    selectedDto?.timezone ?? 'UTC',
  );

  const presentation = useAutomationPresentation(selectedDto);

  const handleNewRule = useCallback(() => {
    const seed = emptyDraft();
    setFormSeed(seed);
    form.reset(seed);
    setFormMode('create');
    setView('form');
  }, [form]);

  const handleSelectRule = useCallback((id: string) => {
    setSelectedId(id);
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

  const handleShowFailure = useCallback((id: string) => {
    setSelectedId(id);
    setView('detail');
  }, []);

  const runtimeOptions = useMemo(
    () => (runtimes.data ?? []).map((rt) => ({ id: rt.id, label: rt.displayName })),
    [runtimes.data],
  );

  if (view === 'form') {
    return (
      <AutomationFormView
        mode={formMode}
        draft={form.draft}
        errors={form.errors}
        canSave={form.canSave}
        saving={automations.savingId !== null}
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
        onTimeZoneChange={form.setTimeZone}
        onTestWebhook={() => {
          void automations.sendWebhookTest(form.draft.webhookUrl).catch(() => {
            /* 结果由 webhookTestState 承载。 */
          });
        }}
        onSave={handleSave}
        onCancel={() => {
          automations.resetWebhookTest();
          setView(selectedId === null ? 'list' : 'detail');
        }}
      />
    );
  }

  if (view === 'detail' && selectedRow !== undefined && selectedDto !== undefined) {
    return (
      <AutomationDetailView
        row={selectedRow}
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
        onDelete={handleDelete}
        onLoadMoreRuns={runs.loadMore}
        {...(onOpenTask === undefined ? {} : { onOpenTask })}
      />
    );
  }

  return (
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
      onSelect={handleSelectRule}
      onToggle={automations.toggle}
      onShowFailure={handleShowFailure}
    />
  );
}
