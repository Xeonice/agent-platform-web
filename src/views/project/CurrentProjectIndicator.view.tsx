// 顶部当前项目指示器（F21-6 §3 / §5）。纯展示、props 驱动、零副作用。
//
// ⚠️ **只读**：点击**只做树内定位展开**（§5「顶部指示器点击」），⛔ 不提供下拉、
// 不承载创建/管理入口（§9.1 #2 是一条否定性验收）。切换项目在左侧树里做，
// 管理动作在组头「⋯」里做——指示器只回答"我现在在哪个项目下"。
//
// ⚠️ **名字是文本、定位是按钮**，刻意分成两个元素：把它做成"一个名字就是按钮"的形态，
// 会让 `getByRole('button', { name: /项目名/ })` 同时命中它与左侧树的组头按钮，
// 全仓（含 e2e）按项目名点项目的地方一起变成二义匹配。分开之后
// 读屏用户照样念得到项目名（它是可见文本），而按钮有自己明确的名字。
export interface CurrentProjectIndicatorProps {
  /** 当前项目名；未选中为 null。 */
  projectName: string | null;
  onLocate: () => void;
}

export function CurrentProjectIndicatorView({
  projectName,
  onLocate,
}: CurrentProjectIndicatorProps) {
  if (projectName === null) {
    return (
      <span data-testid="current-project-indicator" className="text-xs text-muted-foreground">
        未选择项目
      </span>
    );
  }
  return (
    <span
      data-testid="current-project-indicator"
      className="flex items-center gap-1 text-xs text-muted-foreground"
    >
      <span aria-hidden="true">📁</span>
      <span className="max-w-40 truncate">{projectName}</span>
      <button
        type="button"
        aria-label="在左侧树中定位当前项目"
        data-testid="locate-current-project"
        className="rounded px-1 text-xs hover:bg-muted hover:text-foreground"
        onClick={() => {
          onLocate();
        }}
      >
        ⌖
      </button>
    </span>
  );
}
