// 向导镜像下拉的可选性与预装标注（P21-4 §9）。零副作用、零网络、可单测。
//
// ── ⚠️ 2026-08 本文件取代 `filterImagesForRuntime.ts`，因为那条规则是错的 ──────
//
// 原规则：`isActive && (valid || warning) && supportedRuntimes.includes(runtime)`。
// 最后一条把「**预装了没有**」当成了「**能不能跑**」，而这两件事不一样。
//
// **实测把它照出来了**：给平台预制镜像打上诚实标签（上游预装 codex、没有 claude-code，
// `command -v` 实测）之后 ——
//
//     GET /api/images?runtimeId=codex        → 1 张可选
//     GET /api/images?runtimeId=claude-code  → 0 张可选     ← 平台唯一的镜像
//
// 于是 claude-code 任务**根本建不出来**，而 ⚠️ 档那句「未预装、需现装约 12.5 分钟」
// **永远显示不出来**——用户选不到那张卡，那句话没有出场的机会。整个 install-plan
// 现装兜底（04 §3）也就没人走得到。
//
// ── 新规则的依据是一条**被保证**的能力，不是宽容 ──────────────────────────────
// 自定义镜像必须基于平台预制镜像（血统由 `rootfs.diff_ids` 前缀校验，04 §7），
// 而预制镜像带 node ⇒ **任何合规镜像一定装得上任何 runtime**。
// 再用「预装了没有」去否决可选性，等于**否认一个已经被保证的能力**。
// 真的装不上（比如运维方把根镜像指到一个没有 node 的东西）在 `starting` 段
// 响亮失败 `INSTALL_FAILED`，那条路本来就在。
//
// ⇒ 可选性只看 `isActive && status ∈ {valid, warning}`；
//   runtime 不再参与过滤，而是用来**标注后果**（下面第二个函数）。

/** 过滤只读这两个字段；标注多读一个。任何带这些字段的形状都能喂进来。 */
export interface SelectableImage {
  /** 用户意图的启停开关（软下线，13 §2）。 */
  isActive: boolean;
  /**
   * 平台判定的三级结论。
   * ⚠️ 故意放宽成 `string`：13 §2.4 该列还有一个 `pending` 默认值，而 P21-4 §5 的状态
   * 矩阵里**没有 pending 的呈现**。所以必须按**白名单**放行（valid|warning），
   * 写成「≠ invalid」会把 pending 的镜像漏进向导下拉。
   */
  validationStatus: string;
}

/** 允许被选中的两档：⚠️ 警告级镜像**仍可选**（选项旁就地给后果说明，P21-4 §9）。 */
const SELECTABLE_STATUSES: readonly string[] = ['valid', 'warning'];

/**
 * 可选镜像 = `isActive && (valid || warning)`。**与 runtime 无关**（见文件头）。
 *
 * 「禁用后向导下拉自动移除」是这条规则 + 缓存失效的自然结果，**不需要任何跨页通知
 * 机制**（F21-4 §4）。泛型保持入参元素类型不变，调用方拿回去的还是自己的那个类型。
 */
export function selectableImages<T extends SelectableImage>(images: readonly T[]): T[] {
  return images.filter(
    (image) => image.isActive && SELECTABLE_STATUSES.includes(image.validationStatus),
  );
}

/**
 * 这张镜像**预装**了这个 runtime 吗 —— 只用来渲染后果说明，**不用来过滤**。
 *
 * `false` 的含义是「能跑，但要现装，实测约 12.5 分钟」（04 §7 ★ 的 753 秒），
 * 不是「不能跑」。把它当过滤条件用，就是上面那条被否掉的旧规则。
 */
export function runtimePreinstalled(
  image: { supportedRuntimes: readonly string[] },
  runtime: string,
): boolean {
  return image.supportedRuntimes.includes(runtime);
}
