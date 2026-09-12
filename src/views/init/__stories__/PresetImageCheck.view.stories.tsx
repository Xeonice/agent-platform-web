import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PresetImageCheckView } from '@/views/init/PresetImageCheck.view';
import type { PresetImageChainModel, PresetImageStepModel } from '@/types/init';

// ⚠️ story 是 `view` 元素，不能 import `lib/`（boundaries）。这里手搭 model，
// 派生逻辑自己的用例在 `lib/system/__tests__/presetImageChain.test.ts`。
const LABELS: [PresetImageStepModel['step'], string][] = [
  ['config', '该用哪张镜像（没指定 = 平台按你的机器自动选）'],
  ['registry', '镜像仓库里有没有这张镜像'],
  ['lineage', '来源对不对：是不是平台自己构建的那一张'],
  ['registration', '平台检查过没有、能不能选用'],
  ['staged', '有没有下载到本机（只影响首个任务的耗时）'],
];

function chain(
  stopAt: PresetImageStepModel['step'],
  state: PresetImageStepModel['state'],
  extra: Partial<PresetImageStepModel> = {},
): PresetImageChainModel {
  const stopIndex = LABELS.findIndex(([s]) => s === stopAt);
  const steps: PresetImageStepModel[] = LABELS.map(([step, label], i) => {
    if (i < stopIndex) return { step, ordinal: i + 1, label, state: 'pass' };
    if (i > stopIndex) return { step, ordinal: i + 1, label, state: 'pending' };
    return { step, ordinal: i + 1, label, state, ...extra };
  });
  const ready = state !== 'fail';
  return {
    phase: 'done',
    steps,
    ready,
    ...(ready
      ? {}
      : {
          // ⛔ 一个 markdown 星号都不许有：全链路是纯文本渲染，写了就原样上屏。
          //    要强调就改句序 —— 把「无法发起任何任务」放到句首。
          blockedText:
            '在此之前无法发起任何任务：预制镜像还没就绪。可以 [稍后配置] 继续完成初始化，平台能进、项目能建，但新建任务会被直接拒绝。修好后回系统状态页重跑诊断即可。',
        }),
  };
}

const meta: Meta<typeof PresetImageCheckView> = {
  title: 'Init/PresetImageCheck',
  component: PresetImageCheckView,
  parameters: { layout: 'padded' },
  args: {
    model: chain('staged', 'pass'),
    isChecking: false,
    cooldownSec: 0,
    onRecheck: fn(),
    onCopyFix: fn(),
    onProvision: fn(),
    isProvisioning: false,
  },
};
export default meta;

type Story = StoryObj<typeof PresetImageCheckView>;

export const AllPassed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-image-check')).toHaveAttribute('data-ready', 'true');
    await expect(canvas.queryByTestId('preset-image-blocked')).toBeNull();
    // ⚠️ 状态用 `StatusPill`：通过 ⇒ `ok`（design/design-notes.md §2）。
    await expect(
      canvas.getByTestId('preset-step-staged').querySelector('[data-status="ok"]'),
    ).not.toBeNull();
  },
};

export const Checking: Story = {
  args: {
    model: { phase: 'running', steps: chain('config', 'pending').steps, ready: false },
    isChecking: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // ⚠️ 整轮一起转：正在检查中的 `pending` 步骤用会转的 `pending`（灰底 + loader），
    // ⛔ 不是「链停下、没被检查到」那个 `unknown`（虚线灰）——两者产品事实不同。
    const configStep = canvas.getByTestId('preset-step-config');
    await expect(configStep.querySelector('[data-status="pending"]')).not.toBeNull();
    await expect(configStep).toHaveTextContent('检查中…');
  },
};

/**
 * ⭐ **链停下之后，后面几步是"没被检查"，不是"检查中"、也不是"失败了"**——`unknown`
 * （虚线灰边框，design/design-notes.md §2："无样本/未知，≠ 0，≠ 失败"）。
 */
export const StoppedStepsAreUnknownNotPending: Story = {
  args: { model: chain('lineage', 'fail') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const registration = canvas.getByTestId('preset-step-registration');
    await expect(registration).toHaveAttribute('data-state', 'pending');
    await expect(registration.querySelector('[data-status="unknown"]')).not.toBeNull();
    await expect(registration.querySelector('[data-status="pending"]')).toBeNull();
    await expect(registration).toHaveTextContent('未检查');
  },
};

/**
 * ⭐ **第 5 步 `staged` 是 ℹ️「提示」，不是 ⚠️ 也不是 ❌**（F21-8 §7A ②）。
 *
 * 渲染成警告会让用户去"修"一个不需要修的东西——而他能想到的修法是删了重推，那会让情况更糟。
 */
export const StagedIsInfoNotWarning: Story = {
  args: {
    model: chain('staged', 'info', {
      summary: '镜像还没下载到本机',
      // ⚠️ 证据（含**按档**的体积/耗时）在第二层，⛔ 不与结论挤在一行。
      detail:
        '镜像本身没问题，只是这台机器上还没有它的副本（镜像压缩后约 0.3GB，通常十几秒到一分钟）。',
      action: '不需要任何操作：第一个任务会自动把镜像下载好（耗时见上一行）。',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId('preset-step-staged');
    await expect(row).toHaveAttribute('data-state', 'info');
    await expect(row).toHaveTextContent('提示');
    // ⚠️ 三条否定断言是这条 story 的全部意义。
    await expect(row).not.toHaveTextContent('未通过');
    await expect(row).not.toHaveTextContent('警告');
    await expect(canvas.queryByTestId('preset-image-blocked')).toBeNull();
    // ⭐ 序号自带上下文：「共 5 步」在屏幕上，⛔ 不是孤零零一个「第 5 步」。
    await expect(row).toHaveTextContent('第 5 步（共 5 步）');
    // ⛔ 耗时那句只在第二层出现一次，⛔ 不许两处各写一个数字互相打架。
    await expect(canvas.getByTestId('preset-step-detail-staged')).toHaveTextContent('0.3GB');
    await expect(canvas.getByTestId('preset-step-action-staged')).not.toHaveTextContent('GB');
  },
};

/** ⭐ 第 3 步血统失败：**只有那一步是 ❌**，且文案必须说清「注册也会被拒」。 */
export const LineageFailed: Story = {
  args: {
    model: chain('lineage', 'fail', {
      summary: '这张镜像来源不对，用不了',
      detail: "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自己构建的那张。",
      errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
      action:
        '换成平台自己构建的那一张：上游镜像只是平台镜像的起点，拿它手动加进来同样会被拒 —— 不是少做一步。',
      fixCommand:
        'bash scripts/build-sandbox-image.sh && docker push <镜像仓库>/platform/sandbox:<标签>',
    }),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // ⛔ 五步不许合成一个红灯：其余四步不能也是 fail。
    await expect(canvas.getByTestId('preset-step-lineage')).toHaveAttribute('data-state', 'fail');
    await expect(canvas.getByTestId('preset-step-config')).toHaveAttribute('data-state', 'pass');
    await expect(canvas.getByTestId('preset-step-registration')).toHaveAttribute(
      'data-state',
      'pending',
    );
    // ⛔ 「血统」是内部词，上屏说「来源」；但「手动加进来也会被拒」那半句不许省 ——
    //    不说清楚，用户会以为只是少做了一步，照着去做再撞一次墙。
    await expect(canvas.getByTestId('preset-step-action-lineage')).toHaveTextContent(
      '手动加进来同样会被拒',
    );
    await expect(canvas.getByTestId('preset-step-action-lineage')).not.toHaveTextContent('血统');
    // ⭐ 唯一一处「放行了但功能不可用」必须写出来。
    await expect(canvas.getByTestId('preset-image-blocked')).toHaveTextContent('无法发起任何任务');

    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyFix).toHaveBeenCalledWith(
      'bash scripts/build-sandbox-image.sh && docker push <镜像仓库>/platform/sandbox:<标签>',
    );
  },
};

/** 第 1 步未配置：修复动作是"改配置"，与其余四步完全不同。 */
export const NotConfigured: Story = {
  args: {
    model: chain('config', 'fail', {
      summary: '不知道该用哪张镜像，建不了任务',
      detail: '这台机器的沙箱环境是 acme-vm，平台既没有为它发布预制镜像，也没有人指定过一张。',
      errorCode: 'PRESET_IMAGE_NOT_CONFIGURED',
      action:
        '给这台机器的沙箱环境单独指定一张镜像。别动 SANDBOX_DEFAULT_IMAGE —— 它是两种环境共用的总开关。',
      fixCommand: 'SANDBOX_BOXLITE_IMAGE=<镜像仓库>/platform/sandbox:<标签>',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-step-action-config')).toHaveTextContent('指定一张镜像');
    // 与来源那一步的动作**不是同一句**（合成一句就是把诊断退化成一个红灯）。
    await expect(canvas.getByTestId('preset-step-action-config')).not.toHaveTextContent('来源');
  },
};

export const Aborted: Story = {
  args: {
    model: {
      phase: 'aborted',
      steps: chain('config', 'pending').steps,
      ready: false,
      abortedText: '镜像检查中断：这一轮没有拿到结论，可点 [重新检测] 重跑。',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 第 2 步「能自己搬」（P21-8 §2 ⇒ 新判据，2026-09-05）
// ─────────────────────────────────────────────────────────────────────────────

/** 第 2 步失败 + 平台够得着那些字节 ⇒ 给按钮，⛔ 不给命令。 */
function provisionable() {
  const c = chain('registry', 'fail');
  const step = c.steps.find((s) => s.step === 'registry');
  if (step !== undefined) {
    delete step.fixCommand;
    step.provision = {
      from: '本机 docker 镜像库',
      to: 'localhost:5001',
      sizeBytes: null,
      why: "'localhost:5001/platform/sandbox:v2' 的字节已经在本机 docker 镜像库里，只是没推到 registry —— 平台自己推上去即可，不出网、不重建",
    };
  }
  return c;
}

export const Provisionable: Story = {
  args: { model: provisionable() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-provision-button')).toBeVisible();
    // ⛔ 能自己搬时**不许**还渲染那条 `docker build` 命令：两个都给等于让用户在
    //    「点按钮」和「敲命令」之间选，而正确答案只有一个。
    await expect(canvas.queryByText(/docker build/)).toBeNull();
  },
};

export const ProvisionableWithSize: Story = {
  args: {
    model: (() => {
      const c = provisionable();
      const step = c.steps.find((s) => s.step === 'registry');
      if (step?.provision !== undefined) {
        step.provision = {
          ...step.provision,
          from: '发布资产 cap-boxlite-sandbox-v0.26.0-linux-arm64.oci.tar.zst',
          sizeBytes: 430_725_526,
        };
      }
      return c;
    })(),
  },
  play: async ({ canvasElement }) => {
    // ⚠️ **按之前就把代价说清**：多少字节、从哪到哪。
    await expect(within(canvasElement).getByText(/411 MB/)).toBeVisible();
  },
};

/**
 * ⭐ **进度是真实的 `Progress` + 计时器，数据源来自真实的 provision 事件流**
 * （design/design-notes.md §1 问题 3 · §4 Phase 2 第 3 条）——⛔ 不是原型里那个自转的
 * `setInterval` 演示。两个数字各自独立：百分比来自 `progress`，用时来自挂钟时间。
 */
export const Provisioning: Story = {
  args: {
    model: provisionable(),
    isProvisioning: true,
    provisionStatusText: '推送到 registry：Pushing 9d6e6fb71054 · 87%',
    provisionProgress: 0.87,
    provisionElapsedSeconds: 99,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-provision-button')).toBeDisabled();
    await expect(canvas.getByTestId('preset-provision-status')).toHaveTextContent('87%');
    await expect(canvas.getByTestId('preset-provision-percent')).toHaveTextContent('87%');
    const bar = canvas
      .getByTestId('preset-provision-progress')
      .querySelector('[role="progressbar"]');
    await expect(bar).not.toBeNull();
    // ⚠️ 已用时是**独立于百分比**的第二个数字——两个都在跳，才是"没有卡死"的证据。
    await expect(canvas.getByTestId('preset-provision-elapsed')).toHaveTextContent('1 分 39 秒');
  },
};

/**
 * ⭐ **进度给不出分母 ⇒ 画不确定态，⛔ 不许显示一个停在原地的假百分比**（`progress: null`
 * 是合法取值——docker 的进度帧不一定带 `total`，见 `usePresetImageProvision.ts`）。
 */
export const ProvisioningWithoutKnownProgress: Story = {
  args: {
    model: provisionable(),
    isProvisioning: true,
    provisionStatusText: '推送到 registry：Pushing 9d6e6fb71054',
    provisionProgress: null,
    provisionElapsedSeconds: 12,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const block = canvas.getByTestId('preset-provision-progress');
    // 否定断言：⛔ 不许出现任何百分比数字或进度条。
    await expect(canvas.queryByTestId('preset-provision-percent')).toBeNull();
    await expect(block.querySelector('[role="progressbar"]')).toBeNull();
    await expect(block).toHaveTextContent('进度未知');
    // 已用时仍然是真的——它与"给不出百分比"是两件独立的事。
    await expect(canvas.getByTestId('preset-provision-elapsed')).toHaveTextContent('12 秒');
  },
};

export const ProvisionFailed: Story = {
  args: {
    model: provisionable(),
    provisionError: '校验 sha256 对不上：⛔ 已停在校验这一步，没有装载',
    provisionStatusText: '校验 sha256：正在校验（411 MB）…',
  },
  play: async ({ canvasElement }) => {
    // ⛔ 失败**在哪一步**必须看得出来 —— 五个阶段的下一步各不相同。
    await expect(within(canvasElement).getByTestId('preset-provision-error')).toHaveTextContent(
      '校验',
    );
  },
};
