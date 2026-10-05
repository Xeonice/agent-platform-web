import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProviderLogs } from '@/services/api/system.service';

/** 按需读取环境运行日志；收起后保留缓存，不与审计流混用。 */
export function useProviderLogs() {
  const [providerId, setProviderId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['system', 'providerLogs', providerId],
    queryFn: () => getProviderLogs(providerId ?? ''),
    enabled: providerId !== null,
  });
  const toggle = useCallback((id: string) => {
    setProviderId((current) => (current === id ? null : id));
  }, []);
  const retry = useCallback(() => {
    void query.refetch();
  }, [query]);
  return {
    providerId,
    lines: query.data?.lines ?? [],
    unavailableReason: query.data?.unavailableReason,
    isLoading: query.isFetching,
    isError: query.isError,
    toggle,
    retry,
  };
}
