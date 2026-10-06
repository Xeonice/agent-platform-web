import { useQuery } from '@tanstack/react-query';
import { getCredentialDeletionPreview } from '@/services/api/runtime.service';
import type { AffectedTasksResult } from '@/types/runtimeCredential';

/** Read the actual credential bindings when the destructive confirmation opens. */
export function useAffectedTasks(target: { runtimeId: string; credentialId: string } | null) {
  const query = useQuery({
    queryKey: ['credentials', 'deletion-preview', target?.runtimeId, target?.credentialId],
    queryFn: () => {
      if (target === null) throw new Error('credential preview needs a target');
      return getCredentialDeletionPreview(target.runtimeId, target.credentialId);
    },
    enabled: target !== null,
    staleTime: 0,
    retry: false,
  });
  const items = query.data?.affectedTasks ?? [];
  const affected: AffectedTasksResult = {
    items: items.slice(0, 10),
    restCount: Math.max(0, items.length - 10),
    total: items.length,
  };
  return {
    known: query.isSuccess && !query.isFetching,
    affected,
    preparing: query.data?.preparingTasks ?? [],
    retry: () => {
      void query.refetch();
    },
  };
}
