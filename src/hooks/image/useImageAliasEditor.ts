import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiErrorException } from '@/services/api/apiError';
import { useSaveImageAlias } from '@/hooks/image/useImageMutations';
import { validateImageAlias } from '@/lib/image/imageAlias';
import type { ImageManifestDto } from '@/types/image';

export function useImageAliasEditor(manifests: readonly ImageManifestDto[], modalOpen: boolean) {
  const mutation = useSaveImageAlias();
  const [draft, setDraft] = useState<{
    manifestId: string;
    raw: string;
    serverError?: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const busyRef = useRef(false);
  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      const trigger = returnTo.current;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else searchRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const open = useCallback(
    (manifestId: string, trigger: HTMLButtonElement) => {
      if (busyRef.current) return;
      const manifest = manifests.find((item) => item.id === manifestId);
      if (manifest === undefined) return;
      returnTo.current = trigger;
      setDraft({ manifestId, raw: manifest.imageAlias ?? '' });
    },
    [manifests],
  );
  const close = useCallback(() => {
    if (busyRef.current) return;
    setDraft(null);
    restoreFocus();
  }, [restoreFocus]);
  const change = useCallback((raw: string) => {
    if (!busyRef.current)
      setDraft((previous) => (previous === null ? null : { manifestId: previous.manifestId, raw }));
  }, []);
  const openManifestId = draft?.manifestId;
  useEffect(() => {
    if (openManifestId !== undefined) inputRef.current?.focus({ preventScroll: true });
  }, [openManifestId]);
  useEffect(() => {
    if (draft === null || modalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [draft, modalOpen, close]);
  const checked = validateImageAlias(draft?.raw ?? '');
  const save = useCallback(() => {
    if (draft === null || busyRef.current) return;
    const result = validateImageAlias(draft.raw);
    if (result.error !== undefined) return;
    busyRef.current = true;
    mutation.mutate(
      { id: draft.manifestId, alias: result.value },
      {
        onSuccess: () => {
          busyRef.current = false;
          setDraft(null);
          toast.success(result.value === null ? '别名已清除' : '别名已保存');
          restoreFocus();
        },
        onError: (error) => {
          busyRef.current = false;
          const message =
            error instanceof ApiErrorException ? error.envelope.message : error.message;
          setDraft((previous) =>
            previous === null
              ? null
              : { ...previous, serverError: message || '别名保存失败，请重试。' },
          );
        },
      },
    );
  }, [draft, mutation, restoreFocus]);
  return {
    draft,
    count: checked.count,
    error: checked.error ?? draft?.serverError,
    invalid: checked.error !== undefined,
    saving: mutation.isPending,
    inputRef,
    searchRef,
    open,
    close,
    change,
    clear: () => {
      change('');
      inputRef.current?.focus({ preventScroll: true });
    },
    save,
  };
}
