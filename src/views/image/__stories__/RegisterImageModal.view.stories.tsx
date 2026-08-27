import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, within } from 'storybook/test';
import { RegisterImageModalView } from '@/views/image/RegisterImageModal.view';
import type { ImageValidationResultData } from '@/types/image';

const noop = (): void => undefined;

const VALIDATED_URI = 'docker.io/myrepo/ml-agent:v1.0';
const PINNED_SHORT = 'sha256:4b17e…a02';

const meta: Meta<typeof RegisterImageModalView> = {
  title: 'Image/RegisterImageModal',
  component: RegisterImageModalView,
  parameters: { layout: 'fullscreen' },
  args: {
    uri: '',
    onUriChange: noop,
    onValidate: noop,
    onSave: noop,
    onCancel: noop,
    onLocateExisting: noop,
    onViewRequirements: noop,
  },
};
export default meta;

type Story = StoryObj<typeof RegisterImageModalView>;

/** 空表单 —— play：打开后焦点自动落在 URI 输入框（P21-4 §6）。 */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('镜像 URI');
    await expect(document.activeElement).toBe(input);
    // 还没验证 ⇒ [保存] 根本不渲染。
    await expect(canvas.queryByRole('button', { name: '保存' })).toBeNull();
  },
};

/** URI 形状实时校验失败。 */
export const UriFormatError: Story = {
  args: { uri: 'not a valid ref', uriError: '镜像地址格式不正确（形如 registry/repo:tag）' },
};

/** 验证中：[验证] loading，[保存] 不渲染。 */
export const Validating: Story = {
  args: { uri: VALIDATED_URI, validating: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '验证中…' })).toBeDisabled();
    await expect(canvas.queryByRole('button', { name: '保存' })).toBeNull();
  },
};

/** ✅ 通过 ⇒ 出现 [保存]。 */
export const ValidatedOk: Story = {
  args: {
    uri: VALIDATED_URI,
    result: { status: 'valid', pinnedDigestShort: PINNED_SHORT },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '保存' })).toBeEnabled();
  },
};

/** ⚠️ 警告仍可保存（警告不阻断，向导下拉里也仍可选）。 */
export const ValidatedWarning: Story = {
  args: {
    uri: VALIDATED_URI,
    result: {
      status: 'warning',
      pinnedDigestShort: PINNED_SHORT,
      warnings: ['未预装 claude-code，创建时需现装，实测约 12.5 分钟'],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '保存' })).toBeEnabled();
  },
};

/** ❌ 失败 —— play：[保存] **不渲染**（不是渲染出来再置灰），只留 [查看镜像要求] 这条出路。 */
export const ValidatedInvalid: Story = {
  args: {
    uri: VALIDATED_URI,
    result: { status: 'invalid', errors: ['缺少 tmux'] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '保存' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '查看镜像要求' })).toBeInTheDocument();
  },
};

/** 重复注册：**不当错误吓唬用户**，就地提示 + [定位到该镜像]（P21-4 §6）。 */
export const AlreadyRegistered: Story = {
  args: {
    uri: VALIDATED_URI,
    duplicate: { message: '该镜像已注册' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('duplicate-hint')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '定位到该镜像' })).toBeInTheDocument();
  },
};

/**
 * **改动 URI ⇒ 结论整块作废**（P21-4 §5/§6 的 ⏳ 态）。
 *
 * 这个 harness 把容器那一半（`next.trim() !== validatedUri` ⇒ **清掉** `form.result`）搬进 story，
 * 好让 play 能真的敲一个字进去看结果——否则受控组件在 story 里根本不会变。
 * 判定按 trim 后字符串是否变化，**不做等价归一**。
 */
function InvalidationHarness() {
  const [uri, setUri] = useState(VALIDATED_URI);
  const [result, setResult] = useState<ImageValidationResultData | undefined>({
    status: 'valid',
    pinnedDigestShort: PINNED_SHORT,
  });
  const [invalidated, setInvalidated] = useState(false);

  return (
    <RegisterImageModalView
      uri={uri}
      {...(result === undefined ? {} : { result })}
      conclusionInvalidated={invalidated}
      onUriChange={(next) => {
        setUri(next);
        if (next.trim() !== VALIDATED_URI) {
          // **清掉**，不是隐藏——留着等"万一改回来"就是留着一个可能与当前输入不符的绿勾。
          setResult(undefined);
          setInvalidated(true);
        }
      }}
      onValidate={noop}
      onSave={noop}
      onCancel={noop}
    />
  );
}

/**
 * play：改动后**上一次的绿勾与 digest 都从 DOM 消失**、[保存] 不存在、灰字出现；
 * 再把 URI **改回原值**，仍然是作废态——"改回去不复活"是实现形态决定的（result 被清掉了）。
 */
export const ConclusionInvalidated: Story = {
  render: () => <InvalidationHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('镜像 URI');

    // 前置：绿勾与 digest 都在，[保存] 可点。
    await expect(canvas.getByTestId('validation-result')).toHaveAttribute('data-status', 'valid');
    await expect(canvas.getByTestId('pinned-digest')).toHaveTextContent(PINNED_SHORT);
    await expect(canvas.getByRole('button', { name: '保存' })).toBeInTheDocument();

    // 尾部敲一个字符。
    await userEvent.type(input, 'x');

    await expect(canvas.queryByTestId('validation-result')).toBeNull();
    await expect(canvas.queryByTestId('pinned-digest')).toBeNull();
    await expect(canvasElement.textContent).not.toContain(PINNED_SHORT);
    await expect(canvas.queryByRole('button', { name: '保存' })).toBeNull();
    await expect(canvas.getByTestId('conclusion-invalidated')).toHaveTextContent(
      '已修改镜像地址，请重新验证',
    );

    // 改回原值：**仍然是作废态**（结论是被清掉的，不是被藏起来的）。
    await userEvent.clear(input);
    await userEvent.type(input, VALIDATED_URI);
    await expect(canvas.queryByTestId('validation-result')).toBeNull();
    await expect(canvas.queryByRole('button', { name: '保存' })).toBeNull();
  },
};
