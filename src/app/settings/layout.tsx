'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';

const PAGES = [
  { href: '/settings/credentials', title: '凭证管理', width: 'form' as const },
  { href: '/settings/images', title: '镜像管理', width: 'wide' as const },
  { href: '/settings/system', title: '系统状态', width: 'wide' as const },
];
export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const page = PAGES.find((item) => pathname.startsWith(item.href));
  return (
    <SettingsLayoutView hideHeader width={page?.width ?? 'form'} pageTitle={page?.title ?? '设置'}>
      {children}
    </SettingsLayoutView>
  );
}
