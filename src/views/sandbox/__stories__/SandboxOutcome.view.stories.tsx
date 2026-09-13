import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { SandboxOutcomeView } from '@/views/sandbox/SandboxOutcome.view';

const noop = (): void => undefined;
/** 剪贴板与提示都在 container（07 §3 规则 2）；story 里给个替身即可让按钮渲染出来。 */
const copyNoop = (): void => undefined;

const meta: Meta<typeof SandboxOutcomeView> = {
  title: 'Sandbox/Outcome',
  component: SandboxOutcomeView,
  parameters: { layout: 'fullscreen' },
  args: { onAction: noop, onCopyDiagnostics: copyNoop, tone: 'failed', severity: 'fail' },
};
export default meta;

type Story = StoryObj<typeof SandboxOutcomeView>;

/**
 * `INSTALL_FAILED`（P22 §1）：**已落库、`starting` 段中途失败** ⇒ 走正常失败态，给 [重试]。
 */
export const InstallFailed: Story = {
  args: {
    title: 'Agent 的命令行工具没能装上（这张镜像里没有预装它）',
    advice:
      '安装是在「启动运行环境」这一步做的，失败时任务已经停下了。可以重试一次；反复失败就换一张预装了这个工具的镜像 —— 没预装的镜像现装可能要十几分钟。',
    actions: [
      { key: 'retry', label: '重试' },
      { key: 'reconfigure', label: '换一张预装该工具的镜像' },
    ],
    diagnosticCode: 'INSTALL_FAILED',
    taskName: '分析这个仓库的架构并输出…',
  },
  /**
   * ⭐ **诊断码收进 [复制诊断信息]，正文不出现码**（2026-09-11，用户已裁决）。
   *
   * 卡片底部此前常驻一行「诊断码：INSTALL_FAILED」，而**同一份视图第 5 行的注释**明写
   * 「错误码只作为 data 属性留给诊断/测试，不当正文显示给用户」，P22 §1 也禁止裸抛错误码
   * —— 三份口径并存。现在码只在 `data-code` 与复制出来的那段文本里。
   *
   * MUTATION: 把 `<p>诊断码：{diagnosticCode}</p>` 加回去 ⇒ 第一条断言红。
   */
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 正文里一个码都不出现。
    await expect(canvasElement.textContent).not.toContain('诊断码');
    await expect(canvasElement.textContent).not.toContain('INSTALL_FAILED');
    // 但排障拿得到：data-code 留着，按钮把码/细节一起打包。
    await expect(canvas.getByTestId('sandbox-outcome')).toHaveAttribute(
      'data-code',
      'INSTALL_FAILED',
    );
    await expect(canvas.getByTestId('copy-diagnostics')).toHaveAttribute(
      'data-diagnostic-text',
      expect.stringContaining('INSTALL_FAILED'),
    );
    // ⭐ 图标语义真的换成了 severity='fail' 对应的那一个（lucide `X` → class
    // `lucide-x`），不是仍然靠标题里的字面 emoji 字符——那个字符已经被拆走了。
    const icon = canvasElement.querySelector('[data-outcome-severity="fail"]');
    await expect(icon).not.toBeNull();
    await expect(icon).toHaveClass('lucide-x');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
  },
};

/**
 * `IMAGE_CONTRACT_VIOLATION`（P22 §1）：镜像实测缺 tmux。
 * **刻意不给 [重试]**——重试不会改变镜像内容，唯一出路是换镜像。
 */
export const ImageContractViolation: Story = {
  args: {
    title: '这张镜像缺少 tmux，任务已停止',
    advice:
      '注册这张镜像时校验是过的，真正启动时实测发现里面没有 tmux（镜像换了版本，或者上游改了内容）。tmux 不能少：没有它，平台一重启就会丢掉正在跑的 agent 会话，所以这里不做静默降级。换一张带 tmux 的镜像再发起。',
    actions: [{ key: 'reconfigure', label: '换一张含 tmux 的镜像' }],
    diagnosticCode: 'IMAGE_CONTRACT_VIOLATION',
    // failureMessage：后端已把码与自由文本拆成两列，这里只原样展示细节（不从中 parse 码）。
    detail: 'command -v tmux exited 1',
  },
};

/**
 * 未知/缺码时的兜底：仍给人话 + 可点动作（P22 §1 禁止裸抛错误码）。
 *
 * ⚠️ 标题是**中性**的：这张表也被镜像管理页复用，写死「任务启动失败」会在一个
 * 从未涉及任何任务的注册弹窗上说一件没发生过的事。
 */
export const UnknownFailure: Story = {
  args: {
    title: '操作没有完成',
    advice: '未能获取具体原因，可以重试一次；若持续失败请查看系统状态。',
    actions: [
      { key: 'retry', label: '重试' },
      { key: 'reconfigure', label: '返回重新配置' },
    ],
    diagnosticCode: 'UNKNOWN',
  },
};

/**
 * 正常结束（非失败）：不出红字告警。
 *
 * ⚠️ 两处本轮改过：
 *  · 界面上不说「沙箱」（P21-1 §9）；
 *  · **明说新的一轮不接上次进度** —— 「回收后重启」不是「断线重连」，后者才恢复现场。
 *  · ⛔ **不再传 `diagnosticCode`**：这一支此前传的是原始 status，卡片上会渲染出
 *    「诊断码：stopped」—— 那不是任何错误码，用户拿着它报障只会浪费两边时间。
 */
export const Ended: Story = {
  args: {
    tone: 'ended',
    severity: 'info',
    title: '任务已停止',
    advice:
      '这个任务的运行环境已经回收了。可以再发起一个 —— 那是全新的一轮，从头开始，不会接着上次的进度。',
    actions: [{ key: 'reconfigure', label: '发起新任务' }],
  },
  play: async ({ canvasElement }) => {
    // 正常停止不该出现任何"诊断码"，也不该冒出一个原始 status。
    await expect(canvasElement.textContent).not.toContain('诊断码');
    await expect(canvasElement.textContent).not.toContain('stopped');
    await expect(within(canvasElement).queryByTestId('copy-diagnostics')).toBeNull();
    // ⭐ severity='info' → lucide `Info`（class `lucide-info`）——与失败态的
    // `lucide-x` 是两个不同的图标，不是同一张图标换了颜色。
    const icon = canvasElement.querySelector('[data-outcome-severity="info"]');
    await expect(icon).not.toBeNull();
    await expect(icon).toHaveClass('lucide-info');
  },
};
