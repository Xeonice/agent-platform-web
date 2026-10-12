'use client';
import { useInstanceUpgradeContext } from '@/hooks/system/useInstanceUpgrade';
import { useUpgradePopover } from '@/hooks/system/useUpgradePopover';
import { VersionUpdatePopoverView } from '@/views/system/VersionUpdatePopover.view';
import { VersionUpdateNoticeView } from '@/views/system/VersionUpdateNotice.view';

export function VersionUpdateContainer() {
  const controller = useInstanceUpgradeContext();
  const popover = useUpgradePopover(controller?.model.showEntry ?? false);
  if (controller === null) return null;
  const later = () => {
    controller.later();
    popover.setOpen(false);
  };
  const details = () => {
    popover.setOpen(false);
    controller.openDetails();
  };
  return (
    <VersionUpdatePopoverView
      model={controller.model}
      busy={controller.busy}
      isChecking={controller.isChecking}
      commandMessage={controller.commandMessage}
      onCheck={() => {
        void controller.check();
      }}
      onUpgrade={controller.upgrade}
      onRefresh={controller.refreshPage}
      onLater={later}
      onDetails={details}
      open={popover.open}
      onOpenChange={popover.setOpen}
      triggerRef={popover.triggerRef}
      contentRef={popover.contentRef}
      onCloseAutoFocus={popover.onCloseAutoFocus}
      notice={
        controller.showNotice ? (
          <VersionUpdateNoticeView
            model={controller.model}
            busy={controller.busy}
            onUpgrade={controller.upgrade}
            onRefresh={controller.refreshPage}
            onDetails={details}
            onClose={later}
          />
        ) : null
      }
    />
  );
}
