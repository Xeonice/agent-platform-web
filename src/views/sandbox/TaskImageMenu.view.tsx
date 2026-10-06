import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
interface Props {
  imageLabel?: string;
  status?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onStop?: () => void;
  onStart?: () => void;
  onDestroy?: () => void;
}
export function TaskImageMenuView({
  imageLabel,
  status,
  open,
  onOpenChange,
  onStop,
  onStart,
  onDestroy,
}: Props) {
  const preparing = [
    'pending',
    'scheduling',
    'preparing-workspace',
    'creating',
    'starting',
    'preparing',
  ].includes(status ?? '');
  const deleting = status === 'destroying' || status === 'deleting';
  return (
    <DropdownMenu {...(open === undefined ? {} : { open })} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="任务菜单">
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-sm">
        {deleting ? (
          <DropdownMenuItem disabled>删除中…</DropdownMenuItem>
        ) : (
          <>
            {imageLabel !== undefined && (
              <p className="break-all px-3 py-2 text-xs text-muted-foreground">
                镜像：{imageLabel}
              </p>
            )}
            {imageLabel !== undefined && <DropdownMenuSeparator />}
            {['running', 'idle'].includes(status ?? '') && onStop !== undefined && (
              <DropdownMenuItem onSelect={onStop}>停止</DropdownMenuItem>
            )}
            {(status === 'stopped' || status === 'stopping') && onStart !== undefined && (
              <DropdownMenuItem disabled={status === 'stopping'} onSelect={onStart}>
                启动
              </DropdownMenuItem>
            )}
            {onDestroy !== undefined && (
              <DropdownMenuItem onSelect={onDestroy} className="text-error">
                {preparing ? '取消并删除…' : '销毁任务…'}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
