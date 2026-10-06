import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/stores';

export function useUnknownRouteRecovery() {
  const router = useRouter();
  useEffect(() => {
    const state = useAppStore.getState();
    state.setSelectedProjectId(null);
    state.setSelectedSandboxId(null);
    state.setSelectedTaskId(null);
    state.setWorkbenchNotice({ message: '这个地址没有对应的页面，已打开项目总览。' });
    router.replace('/');
  }, [router]);
}
