import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PresetImageCheckView } from '@/views/init/PresetImageCheck.view';
import type { PresetImageChainModel, PresetImageStepModel } from '@/types/init';

// ⚠️ story 是 `view` 元素，不能 import `lib/`（boundaries）。这里手搭 model，
// 派生逻辑自己的用例在 `lib/system/__tests__/presetImageChain.test.ts`。
const LABELS: [PresetImageStepModel['step'], string][] = [
  ['config', '配置：`SANDBOX_DEFAULT_IMAGE` 配了没有'],
  ['registry', 'registry：配的那张镜像能不能解析到'],
  ['lineage', '血统：它是不是平台自建的那一张（不是上游镜像）'],
  ['registration', '注册：进没进平台、`validationStatus` 是不是 valid'],
  ['staged', '本机铺开：rootfs 铺好没有（只影响首个任务的耗时）'],
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
          blockedText:
            '预制镜像尚未就绪 —— 可以 [稍后配置] 继续完成初始化，平台能进、项目能建，但**在此之前无法发起任何任务**（新建任务会被直接拒绝）。修好后回系统状态页重跑诊断即可。',
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
  },
};

export const Checking: Story = {
  args: {
    model: { phase: 'running', steps: chain('config', 'pending').steps, ready: false },
    isChecking: true,
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
      summary:
        '预制镜像已就绪，但尚未在本机铺开 —— 首个任务需要数分钟准备镜像（13GB 镜像实测冷启动约 190 秒）',
      action: '不需要任何操作：第一个任务会自动把镜像铺开，需要数分钟，之后每次 3–4 秒。',
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
  },
};

/** ⭐ 第 3 步血统失败：**只有那一步是 ❌**，且文案必须说清「注册也会被拒」。 */
export const LineageFailed: Story = {
  args: {
    model: chain('lineage', 'fail', {
      summary: "'ghcr.io/agent-infra/sandbox:latest' 是上游镜像，不是平台自建的那张",
      errorCode: 'PRESET_IMAGE_NOT_PLATFORM_BUILT',
      action:
        '换成平台自建的那一张：上游镜像只是平台镜像的 `FROM`，**拿它去注册也会被血统检查拒** —— 不是少做一步注册。',
      fixCommand:
        'bash scripts/build-sandbox-image.sh && docker push <registry>/platform/sandbox:<tag>',
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
    await expect(canvas.getByTestId('preset-step-action-lineage')).toHaveTextContent(
      '注册也会被血统检查拒',
    );
    // ⭐ 唯一一处「放行了但功能不可用」必须写出来。
    await expect(canvas.getByTestId('preset-image-blocked')).toHaveTextContent('无法发起任何任务');

    await userEvent.click(canvas.getByRole('button', { name: '复制' }));
    await expect(args.onCopyFix).toHaveBeenCalledWith(
      'bash scripts/build-sandbox-image.sh && docker push <registry>/platform/sandbox:<tag>',
    );
  },
};

/** 第 1 步未配置：修复动作是"改配置"，与其余四步完全不同。 */
export const NotConfigured: Story = {
  args: {
    model: chain('config', 'fail', {
      summary: '`SANDBOX_DEFAULT_IMAGE` 没有配置，回落到内置默认 `alpine:3.20`',
      errorCode: 'PRESET_IMAGE_NOT_CONFIGURED',
      action: '改配置：把 `SANDBOX_DEFAULT_IMAGE` 指向你自己构建并推上 registry 的那张平台镜像。',
      fixCommand: 'SANDBOX_DEFAULT_IMAGE=<registry>/platform/sandbox:<tag>',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-step-action-config')).toHaveTextContent('改配置');
    // 与血统那一步的动作**不是同一句**（合成一句就是把诊断退化成一个红灯）。
    await expect(canvas.getByTestId('preset-step-action-config')).not.toHaveTextContent('血统');
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

export const Provisioning: Story = {
  args: {
    model: provisionable(),
    isProvisioning: true,
    provisionStatusText: '推送到 registry：Pushing 9d6e6fb71054 · 87%',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('preset-provision-button')).toBeDisabled();
    await expect(canvas.getByTestId('preset-provision-status')).toHaveTextContent('87%');
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
