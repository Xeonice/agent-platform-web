// F21-7 §7.2：空草稿 · 完整填充 · prompt 超 8000 · webhook 启用 · cron 置灰 · 并发/保留期。
// play：名称为空时 [保存规则] disabled。
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { AutomationFormView, type AutomationFormFields } from '@/views/project/AutomationForm.view';

const DELIVERY_NOTE =
  '投递超时 10 秒；失败重试 2 次（间隔 5 秒、25 秒）。两次重试仍失败只记一条投递失败，不影响规则的启用状态。';

const EMPTY: AutomationFormFields = {
  name: '',
  description: '',
  runtime: '',
  prompt: '',
  scheduleKind: 'daily',
  scheduleConfig: { time: '08:00' },
  timezone: 'Asia/Shanghai',
  timezoneTouched: false,
  timeoutMinutes: 120,
  artifactRetentionDays: 7,
  webhookEnabled: false,
  webhookUrl: '',
  triggerOn: 'failure',
};

const FILLED: AutomationFormFields = {
  ...EMPTY,
  name: '每天凌晨数据分析',
  description: '汇总昨天的错误日志',
  runtime: 'codex',
  prompt: '汇总昨天的错误日志，输出一份 markdown 报告到 reports/。',
};

const meta: Meta<typeof AutomationFormView> = {
  title: 'Project/AutomationForm',
  component: AutomationFormView,
  parameters: { layout: 'fullscreen' },
  args: {
    mode: 'create',
    draft: FILLED,
    errors: {},
    canSave: true,
    saving: false,
    promptCount: 27,
    schedulePreview: '每天 08:00（Asia/Shanghai）',
    runtimeOptions: [
      { id: 'codex', label: 'Codex' },
      { id: 'claude-code', label: 'Claude Code' },
    ],
    webhookDeliveryNote: DELIVERY_NOTE,
    webhookTestPhase: 'idle',
    onPatch: fn(),
    onTimeZoneChange: fn(),
    onTestWebhook: fn(),
    onSave: fn(),
    onCancel: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof AutomationFormView>;

export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('form-save')).toBeEnabled();
    // 默认 ◉2h（P21-7 §3.2）。
    await expect(canvas.getByTestId('form-timeout-120')).toBeChecked();
    // 预览里带时区。
    await expect(canvas.getByTestId('form-schedule-preview')).toHaveTextContent('Asia/Shanghai');
  },
};

/** ⭐ play：名称为空 → [保存规则] disabled（§7.2 明确要求的那条）。 */
export const EmptyDraft: Story = {
  args: {
    draft: EMPTY,
    errors: { name: '请填写规则名称。', prompt: '请填写任务内容。', runtime: '请选择 runtime。' },
    canSave: false,
    promptCount: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('form-save')).toBeDisabled();
    await expect(canvas.getByTestId('form-name-error')).toBeInTheDocument();
  },
};

/** ⭐ prompt 超 8000：红字计数 + 禁用保存（与向导任务指令同一上限同一算法）。 */
export const PromptTooLong: Story = {
  args: {
    draft: { ...FILLED, prompt: 'a'.repeat(8001) },
    errors: { prompt: '任务内容超出 8000 字符上限。' },
    canSave: false,
    promptCount: 8001,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('form-prompt-count')).toHaveTextContent('8001 / 8000');
    await expect(canvas.getByTestId('form-prompt-error')).toBeInTheDocument();
    await expect(canvas.getByTestId('form-save')).toBeDisabled();
  },
};

/** webhook 启用：URL + 三个 triggerOn + [测试连接]。 */
export const WebhookEnabled: Story = {
  args: {
    draft: { ...FILLED, webhookEnabled: true, webhookUrl: 'https://example.com/hook' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('webhook-url')).toBeInTheDocument();
    await expect(canvas.getByTestId('webhook-test')).toBeInTheDocument();
  },
};

/**
 * ⭐ 高级选项：并发模式（MVP 唯一可选 = 跳过）与成果保留期（3/7/30，默认 7）。
 * F21-7 §9.3 把这两项列为「无 variant」的缺口 —— 这条就是补它。
 */
export const AdvancedOptions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // `<details>` 默认折叠；play 里先摊开再断言（setAttribute 不需要类型断言）。
    canvas.getByTestId('form-advanced').setAttribute('open', '');

    await expect(canvas.getByTestId('form-concurrency-skip')).toBeChecked();
    await expect(canvas.getByTestId('form-concurrency-queue')).toBeDisabled();
    await expect(canvas.getByTestId('form-concurrency-parallel')).toBeDisabled();

    await expect(canvas.getByTestId('form-retention-7')).toBeChecked();
    await expect(canvas.getByTestId('form-retention-3')).toBeInTheDocument();
    await expect(canvas.getByTestId('form-retention-30')).toBeInTheDocument();
    // ⭐ 与已落地的保留卷互链：成果不是另开一套存储（F21-7 §10.4）。
    await expect(canvas.getByTestId('form-retention-note')).toHaveTextContent('已保留卷');
  },
};

/** ⭐ 编辑态：时区旁边说明"不动它就不会重传"（I-AUT-9 的界面落点）。 */
export const EditMode: Story = {
  args: { mode: 'edit' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/不动它，保存时就不会重传/)).toBeInTheDocument();
  },
};

/** 自定义 cron 是 v1.2，Tab 置灰。 */
export const CustomCronDisabled: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('schedule-kind-cron')).toBeDisabled();
  },
};

export const Saving: Story = {
  args: { saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('form-save')).toBeDisabled();
    await expect(canvas.getByTestId('form-cancel')).toBeDisabled();
  },
};
