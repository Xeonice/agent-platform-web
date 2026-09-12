import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Accordion } from '@/components/ui/accordion';
import { DiagnosticItemView } from '@/views/system/DiagnosticItem.view';

// ⚠️ **`DiagnosticItemView` 是 `AccordionItem`**（Phase 1，design-notes §4）：它必须挂在
// 一棵 `Accordion` Root 下面才立得住（Radix 靠 context 找 Root，脱离 Root 直接渲染会抛错）。
// 真实页面里这棵 Root 是 `DiagnosticsCardView` 受控管的（八项共享一份 `openIds`），这里
// 只是单项故事的最小外壳——`defaultValue` 按 `args.expanded` 摆一次初始态，够这些
// play 断言用；它不是受控的，所以点一下 Trigger 之后内容照样会真的展开/收起
// （Radix 自己的状态），只是 `args.expanded` 这个静态值不会跟着回弹——这在真实页面里
// 不存在（`DiagnosticsCardView` 每次渲染都会重新算 `expanded`），纯粹是"单项故事"这个
// 隔离环境的产物。
const meta: Meta<typeof DiagnosticItemView> = {
  title: 'System/DiagnosticItem',
  component: DiagnosticItemView,
  parameters: { layout: 'padded' },
  decorators: [
    (Story, context) => {
      const id = context.args.item.id;
      return (
        <Accordion type="multiple" defaultValue={context.args.expanded ? [id] : []}>
          <Story />
        </Accordion>
      );
    },
  ],
  args: {
    item: {
      id: 'container-runtime',
      label: '容器服务可达',
      status: 'ok',
      headline: '容器服务可达',
      detailText: '/var/run/docker.sock，142ms · Docker/27.3.1 (linux)。',
      durationText: '142ms',
    },
    // `container-runtime` 是 `DIAGNOSE_CHECK_IDS` 第 1 项 ⇒ ①。各故事按自己的 id 覆盖。
    ordinal: 1,
    expanded: false,
    onCopyHint: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof DiagnosticItemView>;

/** ⭐ `ok` 是「非 ok/info 默认展开」的两个例外之一——默认收起。 */
export const Ok: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-container-runtime');
    await expect(row).toHaveAttribute('data-status', 'ok');
    // ⭐ design/design-notes.md §4 Phase 1「诊断项序号 ①–⑧」：`ordinal: 1` ⇒ 圆标是①。
    // ⚠️ MUTATION：把 `DiagnosticItemView` 里 `ORDINAL_GLYPHS[ordinal - 1]` 写死成
    //    某个固定字符（如永远显示 ①），这条会在其它 ordinal 不为 1 的故事里保持绿——
    //    真正锁住"跟着 ordinal 走"的是下面 `PortConflictFail`（ordinal 4 ⇒ ④）那一条。
    await expect(row).toHaveTextContent('①');
    // ⚠️ 默认只看到一句结论：证据在展开层里。
    await expect(canvas.getByTestId('diagnostic-headline-container-runtime')).toHaveTextContent(
      '容器服务可达',
    );
    await expect(canvas.queryByTestId('diagnostic-detail-container-runtime')).toBeNull();
  },
};

export const Pending: Story = {
  args: { item: { id: 'ws-loopback', label: '实时推送自检' }, ordinal: 6 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('检查中…')).toBeInTheDocument();
    // 没有第二层就**不给展开按钮** —— 一个点开是空的按钮比没有按钮更糟。
    await expect(canvas.queryByTestId('diagnostic-toggle-ws-loopback')).toBeNull();
  },
};

/**
 * ⭐ **散文归散文，命令归命令**（2026-09-11 拆的那两个字段）。
 *
 * ⛔ 上一版把整个 `hint` 塞进 `<code>` 等宽框 + [复制]，而后端的 hint 早就演化成散文了
 * （「重跑一次看稳不稳定」）—— **一段散文顶着一个复制按钮**，复制下来也没地方粘。
 *
 * ⭐ Phase 1「非 ok/info 默认展开」：`warn` 不是 ok/info，这一项默认就是展开的
 * （`expanded: true`），⛔ 不需要再点一次 [展开详情]。
 */
export const Warning: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'warn',
      headline: '拉不到新镜像，Agent 仍可用',
      detailText: 'ghcr.io 未在超时时限内应答。模型 API 正常，Agent 可用。',
      nextStep: '重跑一次看它稳不稳定：偶发多半只是慢；每次都这样就在系统设置里填代理后重试。',
      durationText: '7s',
    },
    ordinal: 5,
    expanded: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // ⛔ 只有散文、没有命令 ⇒ **一个 [复制] 按钮都不该出现**。
    await expect(canvas.queryByRole('button', { name: '复制' })).toBeNull();
    await expect(canvas.getByTestId('diagnostic-next-outbound-network')).toHaveTextContent(
      '重跑一次',
    );
    await expect(args.onCopyHint).not.toHaveBeenCalled();
    // 展开按钮显示的是「收起」——它已经默认展开了。
    await expect(canvas.getByTestId('diagnostic-toggle-outbound-network')).toHaveTextContent(
      '收起',
    );
  },
};

/**
 * ⭐ §9B：端口号 · 进程名与 pid · 平台原本要用它做什么，**三样一个都不许丢**。
 * ⭐ Phase 1：`fail` 默认展开（`expanded: true`），证据不需要用户先点一下才看得到。
 */
export const PortConflictFail: Story = {
  args: {
    item: {
      id: 'port-conflict',
      label: '端口占用',
      status: 'fail',
      headline: '端口 3000 被占用，平台起不来',
      detailText:
        '端口 3000（平台 HTTP/WS 服务（REST · /events · /terminal · /tasks 同一端口））被 com.docke (pid 41235) 占用。',
      nextStep: '先确认它是什么，确实该让路就停掉它；否则给平台换一个端口后重启平台。',
      command: 'lsof -nP -iTCP:3000 -sTCP:LISTEN',
      durationText: '312ms',
    },
    ordinal: 4,
    expanded: true,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-port-conflict');
    // ⭐ `ordinal: 4` ⇒ 圆标是④，不是 `Ok` 故事那条①——锁的是"圆标跟着 `ordinal` prop
    //    走"，不是"组件里写死了一个①"。
    await expect(row).toHaveTextContent('④');
    // 第一眼看到的是结论 + 挡不挡我干活。
    await expect(row).toHaveTextContent('端口 3000 被占用，平台起不来');
    // ⚠️ 证据一个字都不许丢：用户下一步要做的是**找出占它的东西**——且**不需要点开**，
    //    `fail` 已经默认展开。
    await expect(row).toHaveTextContent('com.docke');
    await expect(row).toHaveTextContent('pid 41235');
    await expect(row).toHaveTextContent('平台 HTTP/WS 服务');

    // 只有真命令配等宽 + [复制]，且复制的是**命令原文**。
    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyHint).toHaveBeenCalledWith('lsof -nP -iTCP:3000 -sTCP:LISTEN');
  },
};

/** ⭐ §9A 第 5 步：`info` 渲染 ℹ️「提示」—— **不是** ⚠️「警告」；且 `info` 默认收起。 */
export const PresetImageStagedInfo: Story = {
  args: {
    item: {
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'info',
      step: 'staged',
      stepText:
        '前 4 步已通过，已到第 5 步（共 5 步） · 有没有下载到本机（没下载只影响首个任务的耗时）',
      headline: '镜像还没下载到本机',
      detailText:
        '镜像本身没问题，只是这台机器上还没有它的副本（镜像压缩后约 0.3GB，通常十几秒到一分钟）。',
      nextStep: '不需要做任何事，第一个任务会自动下载。',
      durationText: '431ms',
    },
    ordinal: 8,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-preset-image');
    await expect(row).toHaveAttribute('data-status', 'info');
    await expect(row).toHaveTextContent('提示');
    // ⚠️ 否定断言是关键：渲染成「警告」会让用户去修一个不需要修的东西，
    //    而他能想到的"修法"是删了重推 —— 那会让情况更糟。
    await expect(row).not.toHaveTextContent('警告');
    await expect(row).not.toHaveTextContent('失败');
    // ⭐ 序号自带上下文：「前 4 步已通过」+「共 5 步」。
    const step = canvas.getByTestId('diagnostic-step-preset-image');
    await expect(step).toHaveTextContent('前 4 步已通过');
    await expect(step).toHaveTextContent('共 5 步');
    await expect(step).not.toHaveTextContent('卡在');
    // ⭐ Phase 1：`info` 是「非 ok/info 默认展开」的两个例外之一 —— 默认收起。
    await expect(canvas.queryByTestId('diagnostic-detail-preset-image')).toBeNull();
    await expect(canvas.getByTestId('diagnostic-toggle-preset-image')).toHaveTextContent(
      '展开详情',
    );
  },
};

/**
 * §9A 第 3 步：来源不对有**自己的**步骤说明与码，不与其余四步共用一句。
 * ⭐ Phase 1：`fail` 默认展开。
 */
export const PresetImageLineageFail: Story = {
  args: {
    item: {
      id: 'preset-image',
      label: '预制镜像就绪',
      status: 'fail',
      step: 'lineage',
      stepText: '前 2 步已通过，卡在第 3 步（共 5 步） · 来源对不对（是不是平台自己构建的那张）',
      errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
      headline: '这张镜像来源不对，用不了',
      detailText:
        "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自己构建的那张 —— 手动把它加进来同样会被拒。",
      nextStep: '用平台的构建脚本重新构建再推上去。',
      command: 'bash scripts/build-sandbox-image.sh',
      durationText: '88ms',
    },
    ordinal: 8,
    expanded: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⭐ 「卡在第 3 步（共 5 步）」—— 一个孤零零的序号回答不了「前面过了没有」。
    const step = canvas.getByTestId('diagnostic-step-preset-image');
    await expect(step).toHaveTextContent('前 2 步已通过，卡在第 3 步（共 5 步）');
    // ⛔ 「血统」是内部词，上屏说「来源」。
    await expect(step).not.toHaveTextContent('血统');

    await expect(canvas.getByTestId('diagnostic-code-preset-image')).toHaveTextContent(
      'PRESET_IMAGE_NOT_PLATFORM_BUILT',
    );
  },
};

/** `timeout` 与 `fail` 分开：「答不上来」不是「这一项是坏的」；`timeout` 同样默认展开。 */
export const TimedOut: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'timeout',
      headline: '10 秒内没有结果',
      detailText: '这一项这次没有结论，其余项不受影响。',
      nextStep: '看这一项依赖的东西是卡住了还是在报错；再跑一次诊断，看它是不是每次都超时。',
      durationText: '10s',
    },
    ordinal: 5,
    expanded: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('diagnostic-item-outbound-network');
    await expect(row).toHaveTextContent('未得出结论');
    await expect(row).not.toHaveTextContent('失败');
  },
};

/**
 * ⭐ Phase 1：第 ⑤ 项（`outbound-network`）专属的超时时限文案——数字**来自服务端配置**
 * （`timeoutText`，由 `lib/system/diagnoseModel.ts` 算好，见该文件与 `types/system.ts`
 * 的字段注释），⛔ 这条故事里的 `7s` 只是这个 story 传入的示例值，不是组件写死的。
 */
export const TimedOutWithBudget: Story = {
  args: {
    item: {
      id: 'outbound-network',
      label: '外网连通（模型 API / 镜像仓库）',
      status: 'timeout',
      headline: '10 秒内没有结果',
      durationText: '7s',
      timeoutText: '超时时限 7s',
    },
    ordinal: 5,
    expanded: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnostic-timeout-outbound-network')).toHaveTextContent(
      '超时时限 7s',
    );
  },
};

/**
 * ⛔ **markdown 字面量上屏的回归**（本轮 P0）。
 *
 * 全链路**没有 markdown 渲染器**，所以后端一旦写了 `**…**`，用户读到的就是带星号的
 * 源代码。这条故事把一段带星号的文案原样喂进来，断言屏幕上**看得见那两个星号** ——
 * 也就是说：这里不是"渲染不出来"，而是"根本不该有"。⇒ 后端每一项检查的 spec 里都有
 * 一条「上屏文案不许含 `**`」的断言，那才是这条纪律真正的守卫位置。
 */
export const MarkdownIsNotRendered: Story = {
  args: {
    item: {
      id: 'data-root-fs',
      label: '数据目录文件系统',
      status: 'warn',
      headline: '秒级复制用不了，更费磁盘',
      detailText: '这里如果写 **加粗**，用户读到的就是这五个字符本身。',
      durationText: '9ms',
    },
    ordinal: 7,
    expanded: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('diagnostic-detail-data-root-fs')).toHaveTextContent(
      '**加粗**',
    );
  },
};
