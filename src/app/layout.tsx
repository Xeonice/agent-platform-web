// 根布局：只做 Provider + 全局样式装配（app 层不写业务逻辑，07 §2）。
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from '@/app/providers';
import { AppBootGate } from '@/containers/init/AppBootGate';
import { GlobalBannerContainer } from '@/containers/banner/GlobalBannerContainer';

export const metadata: Metadata = {
  title: 'Agent 管理平台',
  description: '云 Agent 管理平台前端',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /*
      ⚠️ `className="dark"` 仍作为**服务端渲染的默认**（产品规定全局暗色，P21 §3）。
      下面那段脚本会在首屏绘制前按用户偏好改写它 —— 对没表过态的用户（`system`）
      结果多半仍是暗色，所以这个默认值是对的、不是随便挑的。
    */
    <html lang="zh-CN" className="dark">
      <head>
        {/*
          ⚠️⚠️ **主题必须在首屏绘制之前定下来，所以这段脚本是内联同步的**（Phase 5）。
          偏好存在 localStorage（zustand persist 的 `agent-platform-ui`），而 persist 要等
          React 水合完才读得到 —— 那时第一帧早画完了。⇒ 用户每次刷新都会看到一闪的暗色
          再跳成亮色（业界叫 FOUC）。对亮色用户来说那一下就是一次刺眼的白→黑→白。

          ⛔ 不要把它挪进 `useEffect` / Provider / 任何组件里 —— 那些全都在水合之后。
          ⛔ 也不要因为"内联脚本不好看"就删掉：这是**唯一**能赶在首帧之前的位置。

          ⚠️ 整段包在 try/catch 里：localStorage 在隐私模式/禁用站点数据时会**抛异常**，
          而这是 `<head>` 里的同步脚本 —— 抛出去就阻断后续解析，整页白屏。
          读不到偏好不是错误，回落到 SSR 给的 `dark` 即可。
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
var s=localStorage.getItem('agent-platform-ui');
var t=s?(JSON.parse(s).state||{}).theme:null;
if(!t){t='dark';}else if(t==='system'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}
document.documentElement.classList.toggle('dark',t!=='light');
}catch(e){}})();`,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        {/*
          `AppBootGate` 挂在 `Providers` 之下、所有页面之上（F21-8 §2「判定位置」）。
          ⚠️ 它必须在**根**布局里：Next 的嵌套布局让所有路由（`/`、`/settings/*`）都是它的
          `children`，于是"未初始化时直接访问 `/settings/images` 也被拦下"是结构性成立的，
          **不需要一条 redirect**（§2「不做 redirect，避免与深链恢复打架」）。
        */}
        <Providers>
          <AppBootGate>
            {/*
              全局横幅栈（F21-8 §4 / 07 §8.4）。**挂在 `AppBootGate` 的 children 里**，
              于是它与阻塞式向导天然互斥（`initialized:false` 时整棵 children 不进树）——
              理由见 `GlobalBannerContainer` 的文件头。

              ⚠️ 这个 flex 列是横幅存在的**结构前提**：工作台壳与设置页壳此前各自 `h-screen`，
              横幅一出现就把它们顶出视口 100vh + 横幅高度 ⇒ 整页滚动条 + xterm 按失控高度
              算行数（`WorkbenchShell.view` 里已经为同一件事写过一次注释）。⇒ 两个壳改
              `h-full`，高度由这里的 `min-h-0 flex-1` 给。**没有横幅时 DOM 高度与此前一致。**
            */}
            <div className="flex h-screen flex-col">
              <GlobalBannerContainer />
              <div className="min-h-0 flex-1">{children}</div>
            </div>
          </AppBootGate>
        </Providers>
      </body>
    </html>
  );
}
