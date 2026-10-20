import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ConnectivityCheckView } from '@/views/init/ConnectivityCheck.view';
import type { ConnectivityCheckModel } from '@/types/init';

const OPENAI = {
  id: 'api.openai.com',
  target: 'api.openai.com',
  ok: true,
  modelApi: true,
  kindText: '模型 API',
  stateText: '可达 · 351ms',
};
const ANTHROPIC = {
  id: 'api.anthropic.com',
  target: 'api.anthropic.com',
  ok: true,
  modelApi: true,
  kindText: '模型 API',
  stateText: '可达 · 1925ms',
};
const REGISTRY = {
  id: 'localhost:5001',
  target: 'localhost:5001',
  ok: true,
  modelApi: false,
  kindText: '镜像仓库',
  stateText: '可达 · 6ms',
};

function model(over: Partial<ConnectivityCheckModel> = {}): ConnectivityCheckModel {
  return {
    rows: [ANTHROPIC, OPENAI, REGISTRY],
    verdict: 'ok',
    verdictText: '本次探测目标均通过检查。任务实际连通性以其配置和执行结果为准。',
    checkedAtText: '上次检测：2026-08-30 00:11:34（22 小时前）',
    fromHistory: true,
    hasResult: true,
    ...over,
  };
}

const meta: Meta<typeof ConnectivityCheckView> = {
  title: 'Init/ConnectivityCheck',
  component: ConnectivityCheckView,
  parameters: { layout: 'padded' },
  args: { model: model(), isChecking: false, cooldownSec: 0, onRecheck: fn() },
};
export default meta;

type Story = StoryObj<typeof ConnectivityCheckView>;

/** ⭐ 历史结果**带着时刻**，并说清它是历史（进向导不重跑检测，§8 约束 1）。 */
export const AllOkFromHistory: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const line = canvas.getByTestId('connectivity-checked-at');
    await expect(line).toHaveTextContent('22 小时前');
    await expect(line).toHaveTextContent('进向导不重跑');
  },
};

export const Checking: Story = { args: { isChecking: true } };

/** 只有镜像仓库挂了 ⇒ ⚠️ partial，**不是**离线。 */
export const RegistryOnlyDown: Story = {
  args: {
    model: model({
      rows: [ANTHROPIC, OPENAI, { ...REGISTRY, ok: false, stateText: '不可达', hint: '连接超时' }],
      verdict: 'partial',
      verdictText:
        '本次探测的模型 API 目标通过检查，有镜像下载源未通过检查。任务实际连通性以其配置和执行结果为准。',
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connectivity-check')).toHaveAttribute(
      'data-verdict',
      'partial',
    );
    // ⚠️ 否定断言：一台只是内网镜像站没配好的机器，不该被告知「Agent 将不可用」。
    await expect(canvas.getByTestId('connectivity-verdict')).not.toHaveTextContent(
      'Agent 将不可用',
    );
  },
};

export const Offline: Story = {
  args: {
    model: model({
      rows: [
        { ...ANTHROPIC, ok: false, stateText: '不可达' },
        { ...OPENAI, ok: false, stateText: '不可达' },
        REGISTRY,
      ],
      verdict: 'offline',
      verdictText: '本次探测的模型 API 目标均未连通。任务实际连通性以其配置和执行结果为准。',
      fromHistory: false,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connectivity-check')).toHaveAttribute(
      'data-verdict',
      'offline',
    );
    await expect(canvas.getByTestId('connectivity-verdict')).toHaveTextContent(
      '本次探测的模型 API 目标均未连通',
    );
  },
};

/** ⭐ 3s 节流冷却中：显示倒计时而不是一个没有理由的灰按钮。 */
export const RecheckCoolingDown: Story = {
  args: { cooldownSec: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /重新检测/ });
    await expect(button).toBeDisabled();
    await expect(button).toHaveTextContent('3s');
  },
};

/** ⭐ 时刻缺席时**明说**，而不是静默不显示（否则历史结果变成一份没有日期的结论）。 */
export const NoTimestamp: Story = {
  args: { model: model({ checkedAtText: undefined }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connectivity-checked-at')).toHaveTextContent('检测时刻未提供');
  },
};

export const NoResultYet: Story = {
  args: {
    model: model({
      rows: [],
      hasResult: false,
      verdictText: '暂无探测结果，任务实际连通性待确认。',
    }),
  },
};

/** 诊断来源也可能已缓存；时刻缺席不能称作刚刚完成。 */
export const DiagnosticWithoutTimestamp: Story = {
  args: { model: model({ checkedAtText: undefined, fromHistory: false }) },
  play: async ({ canvasElement }) => {
    const line = within(canvasElement).getByTestId('connectivity-checked-at');
    await expect(line).toHaveTextContent('检测时刻未提供');
    await expect(line).toHaveTextContent('诊断检查记录');
    await expect(line).not.toHaveTextContent('刚');
  },
};
