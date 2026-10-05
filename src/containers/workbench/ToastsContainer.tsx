'use client';

import { Toaster } from 'sonner';
import { useTheme } from '@/hooks/_shared/useTheme';

export function ToastsContainer() {
  const { theme } = useTheme();
  return <Toaster richColors position="top-right" theme={theme} />;
}
