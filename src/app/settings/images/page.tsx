// 镜像管理页 /settings/images（F21-4 §2）：只装配 container（app 层只做布局编排，07 §2）。
// 布局复用 `src/app/settings/layout.tsx` + `SettingsLayout.view`（左侧设置菜单 + [← 返回工作台]），
// 本文件零布局改动——与已实现的 `settings/credentials/page.tsx` 平级、同形。
// 口令门与工作台/凭证页一致。
import { AccessGateContainer } from '@/containers/access/AccessGateContainer';
import { ImagesContainer } from '@/containers/image/ImagesContainer';

export default function ImagesPage() {
  return (
    <AccessGateContainer>
      <ImagesContainer />
    </AccessGateContainer>
  );
}
