'use client';
// 设置区布局（F21-3 §2）：SettingsLayout + 左侧菜单（三子页互切 + 返回工作台）。
// app 层只做编排：路由态（usePathname/useRouter）→ 菜单高亮/跳转；Esc → 回工作台（07 §2）。
import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { KeyRound, Package, Settings } from 'lucide-react';
import { SettingsLayoutView } from '@/views/settings/SettingsLayout.view';
import { SettingsMenuView, type SettingsMenuItem } from '@/views/settings/SettingsMenu.view';

// ⚠️ emoji 收口：label 不再拼图标字符（`'🔐 凭证管理'`），改用 `icon` 字段。
// 图标按语义选：凭证 → 钥匙（KeyRound）、镜像 → 容器包（Package，不是相框 Image——
// 这里的"镜像"是 image/container，不是图片）、系统状态 → 齿轮（Settings，与原 ⚙️ 呼应）。
const MENU: (SettingsMenuItem & { href: string })[] = [
  { key: 'credentials', label: '凭证管理', icon: KeyRound, href: '/settings/credentials' },
  // ⚠️ 本轮解禁：`app/settings/images/page.tsx` 已落地，再挂 `disabled` 就成了
  // 「页面建好了也进不去」——F21-4 §2 点名的正是这一条（菜单与子页必须同一轮改）。
  { key: 'images', label: '镜像管理', icon: Package, href: '/settings/images' },
  // ⚠️ 本轮解禁：`app/settings/system/page.tsx` 已落地（F21-5 审计流切片）。
  // 与镜像页那次同一条纪律——菜单与子页必须同一轮改，否则"页面建好了也进不去"。
  { key: 'system', label: '系统状态', icon: Settings, href: '/settings/system' },
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

  // ⚠️ 系统状态是**看板**（两栏卡片栅格），要满宽；凭证/镜像是**表单**，`max-w-3xl`
  //    才不会让 label 与 input 离得太远。档位的理由写在 `SettingsLayout.view.tsx` 文件头。
  return (
    <SettingsLayoutView
      width={activeKey === 'system' ? 'wide' : 'form'}
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
