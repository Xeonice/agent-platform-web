'use client';
import { useState } from 'react';
import { focusDestructiveCancel } from '@/hooks/workbench/useWorkbenchObjectFocus';
import { useAppStore } from '@/stores';
import { useSandboxOperations, useTaskActionDetails } from '@/hooks/sandbox/useSandboxOperations';
import { TaskImageMenuView } from '@/views/sandbox/TaskImageMenu.view';
import { DestroyTaskConfirmView } from '@/views/sandbox/DestroyTaskConfirm.view';
import { Button } from '@/components/ui/button';
import { AppDialogView } from '@/views/common/AppDialog.view';
interface Props {
  id: string;
  name: string;
  projectId?: string;
  status?: string;
  imageLabel?: string;
  showCancel?: boolean;
  triggerLabel?: string;
}
export function TaskActionsContainer({
  id,
  name,
  projectId,
  status,
  imageLabel,
  showCancel,
  triggerLabel,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [keep, setKeep] = useState(true);
  const runtime = useAppStore((s) => s.sandboxStatuses[id]);
  const current = runtime?.status ?? status ?? 'pending';
  const preparing = [
    'pending',
    'scheduling',
    'preparing-workspace',
    'creating',
    'starting',
  ].includes(current);
  const details = useTaskActionDetails(id, menuOpen || confirm);
  const canKeep =
    runtime?.restarting === true ||
    details.data?.hasRun === true ||
    (!preparing && current !== 'failed');
  const operation = useSandboxOperations(id, name, projectId);
  return (
    <>
      {showCancel ? (
        <Button
          variant="outline"
          onClick={() => {
            setConfirm(true);
            setKeep(true);
          }}
        >
          {triggerLabel ?? '取消并删除…'}
        </Button>
      ) : (
        <TaskImageMenuView
          imageLabel={imageLabel ?? details.data?.image}
          status={current}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onStop={operation.stop}
          onStart={operation.start}
          onDestroy={() => {
            setConfirm(true);
            setKeep(true);
          }}
        />
      )}
      {confirm && (
        <AppDialogView
          title={preparing ? `取消并删除任务「${name}」？` : `销毁任务「${name}」？`}
          subtitle={preparing ? '准备中；删除后占用的名额会释放。' : '删除任务并处理它的代码副本。'}
          busy={operation.busy}
          onClose={() => {
            setConfirm(false);
          }}
          onOpenAutoFocus={focusDestructiveCancel}
          testId="task-destroy-confirm"
        >
          <DestroyTaskConfirmView
            name={name}
            preparing={preparing}
            detailsLoading={details.isPending}
            canKeep={canKeep}
            keep={keep}
            onKeep={setKeep}
            busy={operation.busy}
            error={operation.error}
            onCancel={() => {
              setConfirm(false);
            }}
            onConfirm={() => {
              void operation.destroy(canKeep && keep).then(
                () => {
                  setConfirm(false);
                },
                () => undefined,
              );
            }}
          />
        </AppDialogView>
      )}
    </>
  );
}
