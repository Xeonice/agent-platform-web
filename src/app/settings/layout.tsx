'use client';
// 设置区布局（F21-3 §2）：SettingsLayout + 左侧菜单（三子页互切 + 返回工作台）。
// app 层只做编排：路由态（usePathname/useRouter）→ 菜单高亮/跳转；Esc → 回工作台（07 §2）。
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';
import { SettingsMenuView, type SettingsMenuItem } from '@/views/settings/SettingsMenu.view';

const MENU: (SettingsMenuItem & { href: string })[] = [
  { key: 'credentials', label: '🔐 凭证管理', href: '/settings/credentials' },
  // F21-4 / F21-5 后续切片接入；此处占位不可点，避免 404。
  { key: 'images', label: '🖼️ 镜像管理', href: '/settings/images', disabled: true },
  { key: 'system', label: '⚙️ 系统状态', href: '/settings/system', disabled: true },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const activeKey = MENU.find((item) => pathname.startsWith(item.href))?.key ?? 'credentials';

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') router.push('/');
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [router]);

  return (
    <SettingsLayoutView
      menu={
        <SettingsMenuView
          items={MENU}
          activeKey={activeKey}
          onSelect={(key) => {
            const target = MENU.find((item) => item.key === key);
            if (target !== undefined) router.push(target.href);
          }}
          onBackToWorkbench={() => {
            router.push('/');
          }}
        />
      }
    >
      {children}
    </SettingsLayoutView>
  );
}
