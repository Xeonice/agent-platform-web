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

/**
 * 每个子页归哪个宽度档。档位**定义**与理由写在 `SettingsLayout.view.tsx` 文件头，
 * 这里只管"哪页归哪档"。
 *
 * ⚠️ **写成按 key 穷举的 Record，⛔ 不是 `activeKey === 'x' ? a : b` 那种三元**：
 * 三元有一个**静默的默认**，新增子页会不声不响地继承它。而这两档的差别是实打实的
 * （`max-w-3xl` 720px vs 满宽），继承错了就是一页白白空掉一半或一页表单拉到满屏。
 * Record 少写一个 key，tsc 当场就红 —— 逼着加页的人做一次选择。
 *
 * ⚠️ 镜像页归 `wide` 是 design-notes.md Phase 6 的裁决：注册表单在**弹层**里，
 * 页面本体（`src/views/image/*.view.tsx`）里 `<Input`/`<Label`/`<form` **全为 0 处**，
 * 它是列表看板不是表单页 —— 按表单页给 `max-w-3xl` 实测左右各空约 250px，
 * 反而把卡内的 sha256 摘要与运行参数挤成三行。
 */
const SETTINGS_WIDTH: Record<SettingsMenuItem['key'], 'form' | 'wide'> = {
  // 帐号登录 / API Key 两组输入：`max-w-3xl` 才不会让 label 与 input 离得太远。
  credentials: 'form',
  images: 'wide',
  system: 'wide',
};

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
      width={SETTINGS_WIDTH[activeKey]}
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
