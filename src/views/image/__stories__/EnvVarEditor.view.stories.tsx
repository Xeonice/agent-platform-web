import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { EnvVarEditorView } from '@/views/image/EnvVarEditor.view';
import type { EnvVarRowModel } from '@/types/image';

const noop = (): void => undefined;

/**
 * 故意传给 view 的"原值"——**安全红线的靶子**（P21-4 §10.2）。
 * view 对 `secretStored` 的行做兜底掩码，所以它必须**永远到不了 DOM**。
 */
const LEAKY_SECRET = 'sk-live-DO-NOT-LEAK-0001';

const plainRows: EnvVarRowModel[] = [
  { id: 'r1', key: 'LOG_LEVEL', value: 'info', secret: false, secretStored: false },
  { id: 'r2', key: 'CACHE_TTL', value: '3600', secret: false, secretStored: false },
];

const meta: Meta<typeof EnvVarEditorView> = {
  title: 'Image/EnvVarEditor',
  component: EnvVarEditorView,
  parameters: { layout: 'padded' },
  args: {
    rows: plainRows,
    errors: [],
    valueByteCounts: [4, 4],
    canAddRow: true,
    onChangeKey: noop,
    onChangeValue: noop,
    onToggleSecret: noop,
    onRemoveRow: noop,
    onAddRow: noop,
  },
};
export default meta;

type Story = StoryObj<typeof EnvVarEditorView>;

/** 空表。 */
export const EmptyTable: Story = {
  args: { rows: [], valueByteCounts: [] },
};

/** 普通变量行（计数器单位是**字节**，不是字符）。 */
export const PlainRows: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByTestId('env-var-row')).toHaveLength(2);
    await expect(canvas.getAllByTestId('value-byte-counter')[0]).toHaveTextContent('4 / 4096 字节');
  },
};

/**
 * 已存 secret 行 —— **play（安全红线）**：即便把原值传了下来，
 * 输入框的 `value` 也必须是空串、placeholder 必须是「（保持不变，输入即覆盖）」，
 * 且 DOM 全文不含原值。摘掉 view 里那句兜底掩码，这条当场红。
 */
export const StoredSecret: Story = {
  args: {
    rows: [
      { id: 'r1', key: 'LOG_LEVEL', value: 'info', secret: false, secretStored: false },
      { id: 'r2', key: 'MY_SECRET', value: LEAKY_SECRET, secret: true, secretStored: true },
    ],
    valueByteCounts: [4, 0],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const secretInput = canvas.getByLabelText<HTMLInputElement>('变量值 2');
    await expect(secretInput.value).toBe('');
    await expect(secretInput).toHaveAttribute('placeholder', '（保持不变，输入即覆盖）');
    await expect(canvasElement.innerHTML).not.toContain(LEAKY_SECRET);
    await expect(canvasElement.textContent).not.toContain(LEAKY_SECRET);
  },
};

/** 黑名单错误行：命中保留名 ⇒ 就地红字「该变量名为系统保留，请使用凭证管理配置」。 */
export const ReservedName: Story = {
  args: {
    rows: [{ id: 'r1', key: 'OPENAI_API_KEY', value: 'sk-x', secret: true, secretStored: false }],
    valueByteCounts: [4],
    errors: [{ index: 0, field: 'key', code: 'ENV_NAME_RESERVED', path: 'env[0].key' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const error = canvas.getByTestId('env-var-row-error');
    await expect(error).toHaveAttribute('data-code', 'ENV_NAME_RESERVED');
    await expect(error).toHaveTextContent('该变量名为系统保留，请使用凭证管理配置');
  },
};

/** 重复 KEY —— play：**两行同时**红边（只标一行等于告诉用户"另一行没问题"）。 */
export const DuplicateKeys: Story = {
  args: {
    rows: [
      { id: 'r1', key: 'LOG_LEVEL', value: 'info', secret: false, secretStored: false },
      { id: 'r2', key: 'LOG_LEVEL', value: 'debug', secret: false, secretStored: false },
    ],
    valueByteCounts: [4, 5],
    errors: [
      { index: 0, field: 'key', code: 'ENV_DUPLICATE_KEY', path: 'env[0].key' },
      { index: 1, field: 'key', code: 'ENV_DUPLICATE_KEY', path: 'env[1].key' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marked = canvas.getAllByTestId('env-var-row-error');
    await expect(marked).toHaveLength(2);
    await expect(marked[0]).toHaveAttribute('data-code', 'ENV_DUPLICATE_KEY');
    await expect(marked[1]).toHaveAttribute('data-code', 'ENV_DUPLICATE_KEY');
  },
};

/**
 * VALUE 超字节上限（1366 个中文 = 4098 字节）——
 * play：计数器转红。⚠️ 这条正是"字符 ≠ 字节"那个坑的界面一侧：计数器写 `value.length` 时它显示 1366。
 */
export const ValueBytesOverflow: Story = {
  args: {
    rows: [
      { id: 'r1', key: 'CN_TEXT', value: '中'.repeat(1366), secret: false, secretStored: false },
    ],
    valueByteCounts: [4098],
    errors: [{ index: 0, field: 'value', code: 'ENV_LIMIT_EXCEEDED', path: 'env[0].value' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const counter = canvas.getByTestId('value-byte-counter');
    await expect(counter).toHaveTextContent('4098 / 4096 字节');
    await expect(counter.className).toMatch(/red/);
  },
};

/** 到 50 条上限 —— play：[+ 添加变量] 置灰。 */
export const AtRowLimit: Story = {
  args: {
    rows: Array.from({ length: 50 }, (_, i) => ({
      id: `r${String(i)}`,
      key: `VAR_${String(i)}`,
      value: 'v',
      secret: false,
      secretStored: false,
    })),
    valueByteCounts: Array.from({ length: 50 }, () => 1),
    canAddRow: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '+ 添加变量' })).toBeDisabled();
  },
};

/** 超过 50 条：整表级错误（`path` 退化为 `env`，没有具体行号）。 */
export const OverRowLimit: Story = {
  args: {
    rows: Array.from({ length: 51 }, (_, i) => ({
      id: `r${String(i)}`,
      key: `VAR_${String(i)}`,
      value: 'v',
      secret: false,
      secretStored: false,
    })),
    valueByteCounts: Array.from({ length: 51 }, () => 1),
    canAddRow: false,
    errors: [{ field: 'rows', code: 'ENV_LIMIT_EXCEEDED', path: 'env' }],
  },
};
