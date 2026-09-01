// 「新建任务」弹窗的**深链可寻址**（F21-2 §2.1）：`/?new=1&project=<id>`。
//
// 三条裁决写死在这一份里，改之前先读文档：
//
//  ① **深链恢复的不是用户输入，是「弹窗打开 + 项目上下文」。** 指令（`initialPrompt`）是敏感
//     上下文（15 §3.5），它只活在 `SandboxTerminalContainer` 的局部 state，绝不进 store /
//     localStorage —— 深链因此也**不许**成为那条红线的绕行道。本文件全程只认 `new` /
//     `project` 两个键，既不读也不写任何指令；`SandboxTerminalContainer` 那边配了一条断言
//     钉住「深链打开后 `window.location.search` 不含指令内容」。
//     ⇒ 从深链进入时，指令框下要**明说**一句「刷新后指令未保留」（容器负责渲染那句灰字）。
//        ⛔ 不许静默：用户看见弹窗还在，会默认自己写的东西也还在，那比弹窗直接关掉更糟。
//
//  ② **用 query 而不是新路由段**（§2.1 裁决二方案 C）：弹层仍然不占 path，「后退 = 关弹窗」
//     天然成立，现有实现（45 条集成 + 9 条 e2e 兜着的那一份）一行不用推倒。
//
//  ③ **读 query 用 `window.location`，不要用 `useSearchParams()`** —— 后者在 Next 15 会把整棵
//     子树逼进 Suspense 边界（否则 `next build` 直接报错）。这个坑 F21-4 的 `?filter=warning`
//     踩过并给了解法（`hooks/image/useImages.ts` 的 `initialStatusFilter`），这里照抄那一份。
//
// ⚠️ **落点与文档写的不一样**（文档 §2.1「读初值」那行写的是「`SandboxTerminalContainer`
// 挂载时读」）：那个落点在实现里**跑不通**。`SandboxTerminalContainer` 由
// `WorkbenchContainer` 在 `selectedProject !== null && selectedReady` 时才渲染 —— 而深链要
// 做的第一件事恰恰是**把 `project=<id>` 变成选中项目**。收到链接的同事本地 `selectedProjectId`
// 是 null（或是别的项目），容器根本不会挂载，写在容器里的读初值一次也执行不到。
// ⇒ 读初值这一半必须挂在**项目选中之上**（`app/page.tsx` 里的 `NewTaskDeepLinkContainer`），
//   URL 同步这一半跟它放在一起（它只订阅 store 上的 `currentModal`，不需要弹层的任何局部态）。
//   文档已回填。
import { useEffect, useRef, useState } from 'react';
import { useProjects } from '@/hooks/project/useProjects';
import { useAppStore } from '@/stores';
import type { ProjectDto } from '@/types/project';

/** 弹窗开关位。取 `'1'` 才算数（`?new=0` / `?new=` 一律不开）。 */
const OPEN_KEY = 'new';
/** 项目上下文位。**深链必须带它**：没有项目上下文的空弹窗一律不开（§2.1 落点表）。 */
const PROJECT_KEY = 'project';

export interface NewTaskDeepLink {
  projectId: string;
}

/**
 * 解析深链参数。`search` 由调用方给（唯一的生产调用点传 `window.location.search`），
 * 于是这个函数本身是纯的、可直接单测。
 *
 * ⚠️ 只认这两个键。**没有第三个键**，将来也不许有指令类的第三个键（红线①）。
 */
export function readNewTaskDeepLink(search: string): NewTaskDeepLink | null {
  const params = new URLSearchParams(search);
  if (params.get(OPEN_KEY) !== '1') return null;
  const projectId = params.get(PROJECT_KEY);
  // `?new=1` 单独出现 ⇒ 不算深链：⛔ 不要开一个没有项目上下文的空弹窗（§2.1 落点表）。
  if (projectId === null || projectId === '') return null;
  return { projectId };
}

/**
 * 把「弹窗开/关」写成 URL。**只增删那两个键**，其余 query（例如工作台的 `taskId`）原样留着 ——
 * 拿 `pathname` 直接顶掉整个 search 会把别人的深链参数一并抹掉。
 */
function withDeepLink(href: string, link: NewTaskDeepLink | null): string {
  const url = new URL(href);
  if (link === null) {
    url.searchParams.delete(OPEN_KEY);
    url.searchParams.delete(PROJECT_KEY);
  } else {
    url.searchParams.set(OPEN_KEY, '1');
    url.searchParams.set(PROJECT_KEY, link.projectId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** 挂载时的 URL 快照。此后 URL 由本 hook 自己写，不再当输入读（popstate 除外）。 */
function readEntryLink(): NewTaskDeepLink | null {
  if (typeof window === 'undefined') return null;
  return readNewTaskDeepLink(window.location.search);
}

/**
 * 深链 ⇄ 弹窗的双向同步。挂在**项目选中之上**（见文件头的落点说明），页面里挂一次。
 *
 * 三件事：
 *   ① 进入时消费一次 `?new=1&project=X`：项目存在 ⇒ 选中它；且**已就绪**才开弹窗。
 *      不存在 / 已删 ⇒ 不开弹窗、不报错，回落到工作台常态（并把失效参数从 URL 抹掉）。
 *   ② 弹窗开/关 → 写 URL。**声明式**：只在「URL 与当前状态不一致」时写一次，
 *      于是深链进入不会再 push 一遍（URL 本来就是对的），输入指令也不会触发任何一次写。
 *   ③ 浏览器前进/后退 → 弹窗跟着 URL 走（「后退 = 关弹窗」）。
 */
export function useNewTaskDeepLink(): void {
  const projects = useProjects();
  const currentModal = useAppStore((s) => s.currentModal);
  const setCurrentModal = useAppStore((s) => s.setCurrentModal);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const setSelectedProjectId = useAppStore((s) => s.setSelectedProjectId);

  const [entry] = useState<NewTaskDeepLink | null>(readEntryLink);
  const [consumed, setConsumed] = useState(false);
  /** 深链已有定论（本来就没有 / 已经判完）⇒ ② 才允许动 URL。 */
  const settled = entry === null || consumed;

  // ——— ① 消费深链 ———
  useEffect(() => {
    if (settled) return;
    // ⚠️ 判据是 `isSuccess`，**不是** `!isPending`：启用口令时项目列表会先 401（解锁门浮出），
    //    那时按"查无此项目"处理会把一个**有效**深链当成失效的抹掉，解锁后再也回不来。
    //    没有权威答案就什么都不做——参数留在 URL 上，解锁后这条 effect 自然再跑一次。
    if (!projects.isSuccess) return;
    const project = projects.data.find((p) => p.id === entry.projectId);
    setConsumed(true);
    // ⛔ 不存在 / 已删：不开弹窗、不报错崩页（§2.1 完成判据 3）。
    if (project === undefined) return;
    // 项目上下文照给（哪怕还在克隆）——用户至少落在他要的那个项目上。
    setSelectedProjectId(project.id);
    // 克隆中 / 克隆失败 ⇒ **不开弹窗**：那时 `WorkbenchContainer` 渲染的是恢复面板或
    // 「正在克隆」占位，`SandboxTerminalContainer` 根本没挂载，把 `currentModal` 置成
    // `'newTask'` 只会得到一个"开着但什么都没有"的幽灵态。
    if (project.cloneStatus !== 'ready') return;
    setCurrentModal('newTask');
  }, [settled, entry, projects.isSuccess, projects.data, setSelectedProjectId, setCurrentModal]);

  // ——— ② 弹窗 → URL ———
  useEffect(() => {
    if (!settled || typeof window === 'undefined') return;
    const inUrl = readNewTaskDeepLink(window.location.search);
    const open = currentModal === 'newTask' && selectedProjectId !== null;
    if (open) {
      // 已经一致（深链进入 / 刚 push 过）⇒ 什么都不做。**push 一次，不要每次输入都写**。
      if (inUrl !== null && inUrl.projectId === selectedProjectId) return;
      window.history.pushState(
        null,
        '',
        withDeepLink(window.location.href, { projectId: selectedProjectId }),
      );
      return;
    }
    if (inUrl === null) return;
    // ⚠️ 关闭用 `replaceState` 而**不是** `history.back()`（文档 §2.1 两者都允许）：
    //    `back()` 在**直接访问深链**时会把用户送出站（前一条历史是别人的页面），
    //    而且它是异步的——effect 再跑一次就可能连退两步。`replaceState` 同步、幂等，
    //    代价只是历史里多一条同 URL 的记录。浏览器后退关弹窗由 ③ 保证，不靠这一条。
    window.history.replaceState(null, '', withDeepLink(window.location.href, null));
  }, [settled, currentModal, selectedProjectId]);

  // ——— ③ URL → 弹窗（浏览器前进/后退）———
  // 监听器里要读**最新**的项目列表，但又不想每次列表变化都重订阅一次 popstate。
  const projectsRef = useRef<ProjectDto[]>([]);
  useEffect(() => {
    projectsRef.current = projects.data ?? [];
  }, [projects.data]);

  useEffect(() => {
    function onPopState(): void {
      const link = readNewTaskDeepLink(window.location.search);
      if (link === null) {
        // 后退到干净 URL ⇒ 关弹窗。这就是「后退 = 关弹窗」那条语义的**唯一**实现处。
        // ⚠️ 只关**自己那一个**：别的弹层（新建项目 / 已保留卷 …）不占 URL，
        //    在这里无条件 `setCurrentModal(null)` 会让一次无关的后退顺手把它们也关掉。
        if (useAppStore.getState().currentModal === 'newTask') setCurrentModal(null);
        return;
      }
      // 前进回深链：同 ① 的判据，项目得存在且已就绪。
      const project = projectsRef.current.find((p) => p.id === link.projectId);
      if (project?.cloneStatus !== 'ready') return;
      setSelectedProjectId(project.id);
      setCurrentModal('newTask');
    }
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, [setCurrentModal, setSelectedProjectId]);
}
