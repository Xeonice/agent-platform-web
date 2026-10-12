import * as Popover from '@radix-ui/react-popover';
import { CircleArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  VersionUpdateDetailsView,
  type VersionUpdateDetailsProps,
} from '@/views/system/VersionUpdateDetails.view';
import type { Ref, ReactNode } from 'react';

export interface VersionUpdatePopoverProps extends VersionUpdateDetailsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: Ref<HTMLButtonElement>;
  contentRef: Ref<HTMLDivElement>;
  onCloseAutoFocus: (event: Event) => void;
  notice?: ReactNode;
}
export function VersionUpdatePopoverView({
  open,
  onOpenChange,
  triggerRef,
  contentRef,
  onCloseAutoFocus,
  notice,
  ...details
}: VersionUpdatePopoverProps) {
  if (!details.model.showEntry) return null;
  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange} modal={false}>
        <Popover.Trigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            className="relative size-8 shrink-0"
            aria-label="版本与更新"
            title="版本与更新"
          >
            <CircleArrowUp aria-hidden="true" className="size-4" />
            {details.model.showDot ? (
              <span
                data-testid="upgrade-available-dot"
                aria-hidden="true"
                className="absolute right-1 top-1 size-1.5 rounded-full bg-blue-500"
              />
            ) : null}
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={contentRef}
            align="end"
            sideOffset={8}
            className="z-50 w-[min(360px,calc(100vw-24px))] rounded-lg border border-border bg-background p-4 shadow-sm"
            aria-label="版本与更新详情"
            onCloseAutoFocus={onCloseAutoFocus}
          >
            <VersionUpdateDetailsView {...details} compact />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {notice}
    </>
  );
}
