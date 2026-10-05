import { useQuery } from '@tanstack/react-query';
import { getAutomationDeletionPreview } from '@/services/api/automation.service';
import { automationKeys } from '@/hooks/automation/useAutomations';

export function useAutomationDeletionPreview(id: string | null) {
  return useQuery({
    queryKey: [...automationKeys.all(), 'deletion-preview', id],
    queryFn: () => getAutomationDeletionPreview(id ?? ''),
    enabled: id !== null,
    retry: false,
    staleTime: 0,
  });
}
