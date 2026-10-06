import { useQuery } from '@tanstack/react-query';
import { getProjectDeletionPreview } from '@/services/api/project.service';
import { formatVolumeBytes } from '@/lib/project/retainedVolumeModel';
export function useProjectDeletionPreview(
  projectId: string,
  enabled: boolean,
  baselineSizeBytes?: number,
) {
  const query = useQuery({
    queryKey: ['projects', projectId, 'deletion-preview'],
    queryFn: () => getProjectDeletionPreview(projectId),
    enabled,
    staleTime: 0,
  });
  return {
    ...query,
    baselineText:
      baselineSizeBytes === undefined ? undefined : formatVolumeBytes(baselineSizeBytes),
  };
}
