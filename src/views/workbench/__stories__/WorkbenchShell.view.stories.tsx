import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { WorkbenchShellView } from '@/views/workbench/WorkbenchShell.view';
import type { ProjectGroup } from '@/types/domain';

const groups: ProjectGroup[] = [
  {
    projectId: 'p1',
    projectName: '项目 A',
    cloneStatus: 'ready',
    collapsed: false,
    taskCount: 2,
    tasks: [
      {
        id: 't1',
        projectId: 'p1',
        name: '运行中的任务',
        status: 'running',
        waitingInput: false,
        lastActiveAt: 2,
      },
      {
        id: 't2',
        projectId: 'p1',
        name: '等待你输入的任务',
        status: 'running',
        waitingInput: true,
        lastActiveAt: 1,
      },
    ],
  },
  {
    projectId: 'p2',
    projectName: '项目 B（克隆中）',
    cloneStatus: 'cloning',
    collapsed: true,
    taskCount: 0,
    tasks: [],
  },
];

const meta: Meta<typeof WorkbenchShellView> = {
  title: 'Workbench/WorkbenchShell',
  component: WorkbenchShellView,
  parameters: { layout: 'fullscreen' },
  /**
   * ⚠️ 这个 `h-screen` 外壳是**替 `app/layout.tsx` 站的位**：壳本身用 `h-full`，高度由根布局
   * 那个 flex 列（横幅 + `min-h-0 flex-1`）给。story 里没有那一层，不套的话整块塌成 0 高。
   */
  decorators: [(Story) => <div className="h-screen">{Story()}</div>],
};
export default meta;

type Story = StoryObj<typeof WorkbenchShellView>;

const terminalSlot = (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    终端区占位
  </div>
);

export const MultiProject: Story = {
  args: { groups, waitingInputCount: 1, healthLabel: '后端健康：ok（v1.0.0）', terminalSlot },
};

/**
 * ⭐ 顶部"等待你输入"汇总条：⚡ 换成 lucide `Zap`（class `lucide-zap`），装饰性
 * （`aria-hidden`）——去掉图标之后「N 个任务等待你输入」这句话本身仍然完整，
 * 不依赖图标传递唯一信息。
 */
export const WaitingInputBannerHasIcon: Story = {
  args: { groups, waitingInputCount: 3, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('3 个任务等待你输入')).toBeInTheDocument();
    const icon = canvasElement.querySelector('.lucide-zap');
    await expect(icon).not.toBeNull();
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  },
};

/**
 * ⭐ 任务树状态点接入 `StatusPill` 的极简变体（design-notes.md §4 Phase 3 第 2 条）：
 * 等待输入 → warn dot，运行中 → ok dot。⛔ 不再是文字前缀 🔵。
 *
 * 变异：把 `task.waitingInput ? 'warn' : 'ok'` 写反 ⇒ 本例两句 `data-status` 断言都会红
 * （一个该是 warn 却读到 ok，反之亦然）。
 */
export const TaskTreeStatusDots: Story = {
  args: { groups, waitingInputCount: 1, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const waitingRow = canvas.getByRole('button', { name: /等待你输入的任务/ });
    const runningRow = canvas.getByRole('button', { name: /运行中的任务/ });
    await expect(waitingRow.querySelector('[data-slot="status-dot"]')).toHaveAttribute(
      'data-status',
      'warn',
    );
    await expect(runningRow.querySelector('[data-slot="status-dot"]')).toHaveAttribute(
      'data-status',
      'ok',
    );
  },
};

/**
 * ⭐ 「正常时不渲染」（design-notes.md §1 问题 5 / §4 Phase 3 第 4 条）：`healthLabel: null`
 * ⇒ 顶栏那个 `data-testid="health-label"` 的节点**整个不挂载**，⛔ 不是挂载了一个空字符串。
 */
export const HealthLabelHidden: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('health-label')).toBeNull();
  },
};

/** 异常时才挂载：非空字符串 ⇒ 节点出现，且样式是错误色（不是中性灰）。 */
export const HealthLabelShown: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: '后端不可用', terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const label = canvas.getByTestId('health-label');
    await expect(label).toHaveTextContent('后端不可用');
    await expect(label.className).toContain('text-error');
  },
};

/**
 * ⭐ **空组那句「发起第一个任务 →」必须是可点的**（2026-09-11 修）。
 *
 * 它此前是个 `<p>`，却带着一个 `→` —— 箭头是"这里能点"的承诺，而它点不动。
 * 用户点上去没有任何反应，比不给这句话更糟。
 *
 * ⚠️ 可见文案**刻意不含项目名**（项目名放 `title`）：组头就在上一行，上下文不丢；
 * 含了的话，`getByRole('button', { name: /项目名/ })` 会同时命中组头按钮与这一条，
 * 全仓（含 e2e）按项目名点项目的地方一起变成 strict-mode 二义匹配 ——
 * 与同组「⋯」按钮上那条注释是同一条纪律。
 *
 * MUTATION: 把它改回 `<p>` ⇒ 第一条断言找不到按钮。
 */
export const EmptyGroup: Story = {
  args: {
    groups: [
      {
        projectId: 'p3',
        projectName: '空项目',
        cloneStatus: 'ready',
        collapsed: false,
        taskCount: 0,
        tasks: [],
      },
    ],
    waitingInputCount: 0,
    healthLabel: '正在检查后端…',
    terminalSlot,
    onSelectProject: fn(),
    onNewTask: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cta = canvas.getByRole('button', { name: /发起第一个任务/ });
    // 项目名不进无障碍名（否则与组头按钮撞名），但进 title —— 上下文没丢。
    await expect(cta).toHaveAttribute('title', '在 空项目 中发起第一个任务');
    cta.click();
    // 点它 = 先定归属、再开弹层（弹窗里没有项目下拉）。
    await expect(args.onSelectProject).toHaveBeenCalledWith('p3');
    await expect(args.onNewTask).toHaveBeenCalled();
  },
};

// —— [+ 新任务] 入口（F21-2 §N.1，本轮新增）——
/**
 * 选中了一个就绪项目 ⇒ 入口可点。
 * ⚠️ 这条 story 存在本身就是"新建任务成了一个动作"的证据（§9.1 #1）——
 * 在此之前新建面板只是"沙箱为空"时的兜底渲染，**没有任何入口**。
 */
export const NewTaskEnabled: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    selectedProjectId: 'p1',
  },
};

/**
 * 没有可用的选中项目 ⇒ 入口置灰 + 原因（§9.1 #33：绕过会建出无项目归属的 Task）。
 */
export const NewTaskDisabled: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    newTaskDisabledReason: '先选中一个就绪的项目',
  },
};

// —— 搜索 + 状态筛选（design-notes.md §4 Phase 3；硬要求：真过滤，非摆设）——
/**
 * ⭐ 搜索框是受控输入：键入的字符经 `onSearchQueryChange` 原样上抛给 container
 * （真正的过滤发生在 `useProjectTaskTree`/`filterProjectGroups`，这里只测 view 把输入
 * 忠实转发出去，不吞字符、不做防抖静默丢弃）。
 *
 * 变异：把 `onChange` 里的 `e.target.value` 改成写死的字符串 ⇒ 本例的 `toHaveBeenCalledWith`
 * 断言会读到错误的值。
 */
export const SearchInputForwardsValue: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    onSearchQueryChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('task-search-input');
    // 单字符输入：`searchQuery` 是受控 prop，story 里不回填 args，所以每次按键后
    // DOM 值都被拉回初始的空字符串——这里只需证明"敲了什么字符就原样上抛"，不测多字符累加。
    await userEvent.type(input, 'x');
    await expect(args.onSearchQueryChange).toHaveBeenCalledWith('x');
  },
};

/**
 * ⭐ P21-1 §6 七档筛选 chip（全部/准备中/运行中/等待输入/已暂停/异常/已停止，
 * 2026-09-13 用户裁决新增「已停止」）逐一可点，点哪个就上抛哪个
 * （`aria-pressed` 标出当前激活项）。
 * 变异：把某个 chip 的 `data-testid`/点击值写错（比如「已暂停」点了传 'running'）
 * ⇒ 对应断言的 `toHaveBeenCalledWith` 会读到错误的枚举值。
 */
export const FilterChipsEachEmitOwnValue: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    onStatusFilterChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // 主行三档：直接点。
    await userEvent.click(canvas.getByTestId('task-filter-preparing'));
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith('preparing');
    await userEvent.click(canvas.getByTestId('task-filter-running'));
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith('running');
    await userEvent.click(canvas.getByTestId('task-filter-all'));
    await expect(args.onStatusFilterChange).toHaveBeenCalledWith('all');

    // 收纳的四档：先开「更多」，再点。⚠️ 菜单挂在 portal 上，不在 canvasElement 里
    // ⇒ 必须用 `within(document.body)` 找，用 canvas 找会 not found。
    for (const [status, label] of [
      ['waitingInput', '等待输入'],
      ['paused', '已暂停'],
      ['error', '异常'],
      ['stopped', '已停止'],
    ] as const) {
      await userEvent.click(canvas.getByTestId('task-filter-more'));
      const menu = within(document.body);
      const item = await menu.findByTestId(`task-filter-${status}`);
      // ⭐ 文案与枚举值配对着断言：只断言回调值的话，把「异常」和「已停止」两个
      // label 对调仍然全绿 —— 菜单里显示错名字、点下去筛对了，用户照样被骗。
      await expect(item).toHaveTextContent(label);
      await userEvent.click(item);
      await expect(args.onStatusFilterChange).toHaveBeenCalledWith(status);
      // ⚠️ 等菜单**真正卸载**再开下一轮。Radix 的关闭走 `Presence` 动画，不等的话
      // 下一轮 `findByTestId` 会拿到正在退场、已经 detach 的旧节点，点下去什么都不
      // 发生 —— 表现为最后一两档"随机"收不到回调（实测 3 次红 2 次）。
      await waitFor(async () => {
        await expect(menu.queryByTestId(`task-filter-${status}`)).toBeNull();
      });
    }
  },
};

/**
 * ⭐ 筛选行**真的放得下**，不靠滚动也不换行（2026-09-14 裁决：前三档 + 「更多」）。
 *
 * ⚠️ 钉的是 `scrollWidth <= clientWidth` 这个**几何事实**，⛔ 不是类名。
 * 上一版这条 story 断言的是 `flex-nowrap` + `overflow-x-auto` 两个类名在不在 ——
 * 那种写法拦不住真正会犯的错：往主行多挪一档、或把某档文案改长，类名一个字没动、
 * 断言全绿，而侧栏里那一档已经溢出看不见了（现在没有滚动条，溢出是**直接消失**，
 * 不像以前还能滑出来）。几何断言才会红。
 *
 * 变异：把 `PRIMARY_STATUS_FILTERS` 加上 'waitingInput'（主行四档 ⇒ 270px 对 271px，
 * 差 1px），或把「准备中」改成更长的文案 ⇒ 本条红。
 */
export const FilterChipsFitWithoutScrolling: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chipsRow = canvas.getByTestId('task-filter-chips');
    // 放得下 = 没有可滚动的余量。±1px 容差留给亚像素取整。
    await expect(chipsRow.scrollWidth).toBeLessThanOrEqual(chipsRow.clientWidth + 1);
    // 而且不是靠换行放下的（换行同样能让 scrollWidth 归零）。
    await expect(chipsRow.className).toContain('flex-nowrap');
    await expect(chipsRow.className.split(/\s+/)).not.toContain('flex-wrap');
    // 主行三档 + 「更多」触发器都在场，每个都不许折行或缩到看不清。
    for (const status of ['all', 'preparing', 'running']) {
      const chip = canvas.getByTestId(`task-filter-${status}`);
      await expect(chip.className).toContain('whitespace-nowrap');
      await expect(chip.className).toContain('shrink-0');
    }
    await expect(canvas.getByTestId('task-filter-more')).toBeVisible();
    // ⛔ 收纳的四档**不该**出现在主行上（没点开「更多」时它们不在 DOM 里）。
    for (const status of ['waitingInput', 'paused', 'error', 'stopped']) {
      await expect(canvas.queryByTestId(`task-filter-${status}`)).toBeNull();
    }
  },
};

/**
 * ⭐ 选中项落在收纳档里时，触发器**显示那一档的名字并高亮** —— ⛔ 不是恒显「更多」。
 * 否则筛成「异常」之后整行看不出任何选中痕迹，用户会以为筛选没生效。
 * 变异：把触发器文案写死成 '更多'（或去掉 data-active 的条件）⇒ 本条红。
 */
export const FilterMoreTriggerShowsActiveOverflowFilter: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    statusFilter: 'error',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('task-filter-more');
    await expect(trigger).toHaveTextContent('异常');
    await expect(trigger).toHaveAttribute('data-active', 'true');
    // 选中项在收纳档里时，主行的「全部」不该还显示成激活。
    await expect(canvas.getByTestId('task-filter-all')).toHaveAttribute('aria-pressed', 'false');
  },
};

/** 选中项在主行时，触发器回到「更多」且不高亮 —— 上一条的反向断言。 */
export const FilterMoreTriggerIdleWhenPrimaryActive: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    statusFilter: 'running',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('task-filter-more');
    await expect(trigger).toHaveTextContent('更多');
    await expect(trigger).toHaveAttribute('data-active', 'false');
    await expect(canvas.getByTestId('task-filter-running')).toHaveAttribute('aria-pressed', 'true');
  },
};

/**
 * 激活的 chip 有 `aria-pressed="true"`，其余为 `false`——不是只有背景色区分。
 * ⚠️ 用主行里的档（'running'）：'waitingInput' 自 2026-09-14 起收进了「更多」，
 * 不点开菜单它不在 DOM 里，那一档的选中表现由
 * `FilterMoreTriggerShowsActiveOverflowFilter` 负责。
 */
export const FilterChipActiveState: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    statusFilter: 'running',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('task-filter-running')).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByTestId('task-filter-all')).toHaveAttribute('aria-pressed', 'false');
  },
};

/**
 * ⭐ 「搜不到时说什么」硬要求钉子：`hasNoFilterMatches` 为真 ⇒ 渲染空态文案而不是
 * 空的项目树（用户分不清"没有匹配"和"这个项目本来就没有任务"）。
 * 变异：把渲染条件从 `hasNoFilterMatches` 改成 `groups.length === 0`
 * ⇒ 普通空项目（没过滤时就是空）也会被误判成"没有找到匹配的任务"。
 */
/**
 * ⭐ 自查钉子：`groups` 为空**不等于** `hasNoFilterMatches`——这是两种不同的空态
 * （"这个人还没建过任务" vs "搜不到"）。没有这一条时，`NoSearchResults` 那条 story
 * 的变异自查（把渲染条件从 `hasNoFilterMatches` 换成 `groups.length === 0`）测不出来：
 * 之前所有 story 里 `groups` 为空必然伴随 `hasNoFilterMatches: true`，两个条件永远
 * 同真同假，那样的变异不会让任何用例变红。这一条专门造出"groups 为空但
 * hasNoFilterMatches 为假"的组合，才把两者的差异钉住。
 */
export const EmptyGroupsWithoutActiveFilter: Story = {
  args: { groups: [], waitingInputCount: 0, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 没有过滤 ⇒ 不该出现"没有找到匹配的任务"这句话——那句话专属于"搜/筛之后 0 条"。
    await expect(canvas.queryByTestId('task-search-no-results')).not.toBeInTheDocument();
  },
};

export const NoSearchResults: Story = {
  args: {
    groups: [],
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    searchQuery: '不存在的任务',
    hasNoFilterMatches: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('task-search-no-results')).toHaveTextContent(
      '没有找到匹配“不存在的任务”的任务',
    );
  },
};

/** 状态筛选（无搜索词）搜不到时，文案说的是筛选档而不是搜索词。 */
export const NoFilterResultsWithoutQuery: Story = {
  args: {
    groups: [],
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    statusFilter: 'paused',
    hasNoFilterMatches: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('task-search-no-results')).toHaveTextContent(
      '没有已暂停的任务',
    );
  },
};

// —— 项目组折叠箭头（design-notes.md §4 Phase 3）——
/**
 * ⭐ 点折叠箭头只切折叠，不选中项目——两个是不同动作（与 `ProjectGroupHeader` 那条
 * story 同一条纪律，这里在工作台整体装配层面再钉一次接线）。
 */
export const ToggleGroupCollapse: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: null,
    terminalSlot,
    onToggleGroupCollapse: fn(),
    onSelectProject: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const [firstToggle] = canvas.getAllByTestId('project-group-toggle');
    if (!firstToggle) throw new Error('project-group-toggle 节点缺失');
    await userEvent.click(firstToggle);
    await expect(args.onToggleGroupCollapse).toHaveBeenCalledWith('p1');
    await expect(args.onSelectProject).not.toHaveBeenCalled();
  },
};

// —— 任务副行「活跃于 X 前」（design-notes.md §4 Phase 3）——
/**
 * ⭐ 硬要求钉子：没有真实时间戳（`activityLabel: undefined`）⇒ 不渲染「活跃于」，
 * 但等待输入是独立真实字段，照常显示。
 * 变异：把渲染条件从 `activityLabel !== undefined || waitingInput` 改成恒真
 * ⇒ 本例第一个任务（两者都没有）也会渲染出一个空的副行节点。
 */
export const TaskActivitySubtitle: Story = {
  args: {
    groups: [
      {
        projectId: 'p1',
        projectName: '项目 A',
        cloneStatus: 'ready',
        collapsed: false,
        taskCount: 3,
        tasks: [
          {
            id: 't-no-data',
            projectId: 'p1',
            name: '没有真实时间戳的任务',
            status: 'running',
            waitingInput: false,
            lastActiveAt: 0,
          },
          {
            id: 't-active',
            projectId: 'p1',
            name: '有真实活跃时间的任务',
            status: 'running',
            waitingInput: false,
            lastActiveAt: 1,
            activityLabel: '活跃于 3 分钟前',
          },
          {
            id: 't-waiting-only',
            projectId: 'p1',
            name: '只有等待输入、没有时间戳',
            status: 'running',
            waitingInput: true,
            lastActiveAt: 0,
          },
        ],
      },
    ],
    waitingInputCount: 1,
    healthLabel: null,
    terminalSlot,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 没有真实数据 ⇒ 整段副行不渲染（⛔ 不是渲染一个空字符串占位）。
    await expect(canvas.queryByTestId('task-activity-t-no-data')).not.toBeInTheDocument();
    // 有真实时间戳 ⇒ 渲染「活跃于 3 分钟前」。
    await expect(canvas.getByTestId('task-activity-t-active')).toHaveTextContent('活跃于 3 分钟前');
    // 只有等待输入 ⇒ 只渲染「等待输入」，不编造一个假的活跃时间。
    const waitingOnly = canvas.getByTestId('task-activity-t-waiting-only');
    await expect(waitingOnly).toHaveTextContent('等待输入');
    await expect(waitingOnly.textContent).not.toContain('活跃于');
  },
};

// —— 顶栏：⌘K 提示（design-notes.md §4 Phase 3 第 4 条）——
export const TopBarShortcutHint: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('command-palette-hint')).toHaveTextContent('⌘K');
  },
};

// —— 顶栏：设置菜单收口（P20 §8.2；design-notes.md §4 Phase 3 第 4 条原写
// 「镜像管理落地时，这两条直链再收进一个真菜单」——`/settings/images` 已经落地，本轮收口）——
/**
 * ⭐ 凭证管理 / 镜像管理 / 系统状态三个直链收成一个 shadcn `DropdownMenu`：
 *  · 触发器可见文字本身就是无障碍名（不额外拿 `aria-label` 盖掉它）；
 *  · 键盘：聚焦触发器后 `Enter` 展开（Radix `DropdownMenuTrigger` 自己处理
 *    Enter/Space/ArrowDown，不依赖浏览器对 `<button>` 的原生激活行为——jsdom 里
 *    这条也成立），展开后第一项自动拿到焦点，`ArrowDown` 在三项间移动，`Escape` 收起；
 *  · 每个子项各自断言跳对了地方（`href`），⛔ 不是只测"菜单展开了"。
 *
 * ⚠️ `DropdownMenuContent` 经 Radix `Portal` 挂到 `document.body`，⛔ 不在
 * `canvasElement` 子树内——菜单展开后的断言改用 `within(document.body)`
 * （与 `InitWizardShell` 那几条 `BlockingDialog` 断言同一条纪律）。
 *
 * MUTATION：
 *  · 把三个 `<a href>` 中任意一个的地址写错 ⇒ 对应 `toHaveAttribute('href', …)` 读到错误值；
 *  · 把 `DropdownMenuItem` 的渲染顺序打乱 ⇒ `ArrowDown` 焦点顺序断言错位；
 *  · 把触发器的可见文字删空、只留 `aria-label` ⇒ `toHaveAccessibleName` 那条不动
 *    （name 计算优先取可见文字，这里只是确认"文字本身够格当无障碍名"，不依赖额外属性）。
 */
export const SettingsMenuOpensWithThreeItems: Story = {
  args: { groups, waitingInputCount: 0, healthLabel: null, terminalSlot },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByTestId('nav-settings-menu-trigger');
    // 齿轮换成了 lucide `Settings`（class `lucide-settings`），前面不再是字面 emoji
    // 字符——图标是 `aria-hidden`，无障碍名仍然只由可见文字「设置」决定。
    await expect(trigger).toHaveAccessibleName('设置');
    const triggerIcon = trigger.querySelector('svg');
    await expect(triggerIcon).toHaveClass('lucide-settings');
    await expect(triggerIcon).toHaveAttribute('aria-hidden', 'true');

    // 键盘展开：聚焦 + Enter，不摸鼠标。
    trigger.focus();
    await userEvent.keyboard('{Enter}');

    const body = within(document.body);
    const credentialsItem = await body.findByTestId('nav-settings-credentials');
    const imagesItem = body.getByTestId('nav-settings-images');
    const systemItem = body.getByTestId('nav-settings-system');

    await expect(credentialsItem).toHaveAttribute('href', '/settings/credentials');
    await expect(imagesItem).toHaveAttribute('href', '/settings/images');
    await expect(systemItem).toHaveAttribute('href', '/settings/system');

    // 展开后第一项自动获得焦点；ArrowDown 逐项移动——全程键盘可达。
    await expect(credentialsItem).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(imagesItem).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(systemItem).toHaveFocus();

    // Escape 收起——菜单不是"打开了就关不掉"。⚠️ 关闭走 Radix 的退出动画
    // （`data-[state=closed]:animate-out`），DOM 节点要等动画结束才真正卸载，
    // 故用 `waitFor` 而不是关键字之后立即同步断言。
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(body.queryByTestId('nav-settings-credentials')).not.toBeInTheDocument(),
    );
  },
};

/** 弹层插槽：两个「新建」都往这儿渲染，形态对称（§N.0）。 */
export const WithOverlay: Story = {
  args: {
    groups,
    waitingInputCount: 0,
    healthLabel: '后端健康：ok',
    terminalSlot,
    selectedProjectId: 'p1',
    overlaySlot: (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="rounded-lg border border-border bg-background p-6 text-sm">弹层占位</div>
      </div>
    ),
  },
};
