/**
 * 「打开授权页」—— ChatGPT 帐号授权那一步的开标签页动作（P21-8 §2.1 / F07 §6.2a）。
 *
 * ── 为什么这几行值得单独一个文件 ────────────────────────────────────────────
 * 它看起来只是 `window.open` 一句，实际压着三个各自会静默失败的坑。三个都写在这里，
 * 于是它们可以被逐条钉住，而不必为了测「弹窗被拦时怎么办」去起一个真浏览器。
 */

/**
 * 开标签页的结果。
 *
 * ⚠️ **只声明成 `OpenedTab | null` 而不是 `Window | null`**：这一层真正用到的只有
 * 「返回了没有」这一个事实。声明成 `Window` 会逼替身去伪造一个几百个成员的对象
 * （或者打一次 `as Window` 断言，而那正是仓库规则禁的），换不来任何额外的类型安全。
 */
export interface OpenedTab {
  readonly closed?: boolean;
}

export interface OpenAuthPageDeps {
  /** 注入而不是直接摸 `window` —— 单测里要能扮演「被拦了」。 */
  open: (url: string, target: string, features: string) => OpenedTab | null;
  /** 注入而不是直接摸 `navigator.clipboard` —— 它在非 HTTPS 下会抛。 */
  writeClipboard: (text: string) => Promise<void>;
}

export interface OpenAuthPageResult {
  /** 标签页开成了没有。`false` ⇒ 被浏览器拦了，界面要显形。 */
  opened: boolean;
  /** 设备码复制进剪贴板了没有。⚠️ 它失败**不影响** `opened`。 */
  copied: boolean;
}

/**
 * ⚠️ **必须在 click 回调里同步调用。** 先 `await` 任何东西再进来，`window.open` 就会被
 * 判定为非用户手势直接拦掉（Safari 尤其严）——所以本函数**同步**开标签页，
 * 剪贴板那一下才是异步的，且排在后面。
 *
 * ⚠️ **`noopener` 不能省**：不带它，新标签页拿得到 `window.opener`，能把原页面导去任意
 * 地址（reverse tabnabbing）。目标站是 OpenAI 不改变这条规矩——**规矩不看目标是谁**。
 *
 * ⚠️ **剪贴板失败不算失败**：`navigator.clipboard` 在非 HTTPS / 无权限时抛。码本来就还在
 * 屏幕上、[复制] 按钮也还在，为一次锦上添花的复制而中断主流程是本末倒置。
 * ⇒ 吞掉异常，只把 `copied: false` 如实报上去。
 */
export function openAuthPage(
  url: string,
  userCode: string,
  deps: OpenAuthPageDeps,
): Promise<OpenAuthPageResult> {
  // ① 同步开——这一句之前不许有任何 await。
  const handle = deps.open(url, '_blank', 'noopener,noreferrer');
  const opened = handle !== null;

  // ② 再复制。⚠️ 即使标签页被拦了也照复制：用户接下来多半会手动开，码在剪贴板里仍然有用。
  return deps
    .writeClipboard(userCode)
    .then(() => ({ opened, copied: true }))
    .catch(() => ({ opened, copied: false }));
}

/** 浏览器里的真实现。测试注入替身，生产用这个。 */
export function browserOpenAuthPageDeps(): OpenAuthPageDeps {
  return {
    open: (url, target, features) => window.open(url, target, features),
    writeClipboard: (text) => navigator.clipboard.writeText(text),
  };
}
