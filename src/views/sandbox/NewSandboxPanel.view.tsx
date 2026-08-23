// 新建沙箱入口：runtime 单选 + provider 单选 + 任务指令（可选）+ [发起任务并打开终端]。
// 纯展示、props 驱动、零副作用。
//
// ⚠️ **两个开放注册表，一套做法**（14 §10.3 ①）：`runtime` 与 `provider` 都是后端运行时注册的开放集，
// 列表项 / 默认选中 / 能力位一律由 container 从服务端响应注入 —— 视图既不枚举取值，也不兜底默认值。
// 历史教训：runtime 这一半曾被写成前端常量 `S2_DEFAULT_RUNTIME = 'shell'`，后端注册表里根本没有
// 这个键 ⇒ 从这个入口建的沙箱一律死在 `unknown runtime 'shell'`，而四道防线一道都没拦住（14 §10.1）。
//
// ⚠️ 安全红线（15 §3.5）：任务指令的值由 **container 的局部 state** 持有并经 props 传入，
// 视图不得把它写进任何 store / storage；container 提交即清空。
import type { RuntimeDto } from '@/types/runtimeCredential';
import type { SandboxProvider, SandboxProviderDto } from '@/types/sandbox';
import { INITIAL_PROMPT_MAX_LENGTH } from '@/types/sandbox';
import { Button } from '@/components/ui/button';

export interface NewSandboxPanelProps {
  /**
   * 服务端 registry 下发的可选 runtime（`GET /api/runtimes`，扁平数组；空数组 = 后端没注册 runtime）。
   * 视图不挑默认值，**container 也不挑**：平台没有「默认 runtime」概念（04 §8）。
   */
  runtimes: readonly RuntimeDto[];
  /**
   * 当前选中 runtime id；`''` = **尚未选中**。
   * 两种情况都会是 `''`：根本没得选（加载中/失败/空 registry），或**用户还没选**——
   * runtime 是必选项、不预选。两种情况的提示是两句不同的话，见 `noRuntimes` / `runtimeUnchosen`。
   */
  runtime: string;
  onSelectRuntime: (runtime: string) => void;
  /** runtime 列表加载中：出骨架并禁用创建（不静默展示空列表）。 */
  loadingRuntimes: boolean;
  /** runtime 列表加载失败文案（非空即出可重试提示，不静默降级为空列表）。 */
  runtimesErrorMessage?: string;
  onRetryRuntimes: () => void;

  /**
   * 服务端 registry 下发的可选档位（扁平数组，含 capabilities 与 isDefault；
   * 空数组 = 后端没注册 provider）。默认选中由 container 依 isDefault 算好后经 `provider` 传入。
   */
  providers: readonly SandboxProviderDto[];
  /** 当前选中 provider 名；'' 表示尚无可选项（加载中/失败/空 registry）。 */
  provider: SandboxProvider;
  onSelectProvider: (provider: SandboxProvider) => void;
  onCreate: () => void;
  creating: boolean;
  /** provider 列表加载中：出骨架并禁用创建（不静默展示空列表）。 */
  loadingProviders: boolean;
  /** provider 列表加载失败文案（非空即出可重试提示，不静默降级为空列表）。 */
  providersErrorMessage?: string;
  onRetryProviders: () => void;
  /** 非空 → 禁用创建并展示原因（如所选 provider 不支持终端，capabilities.spawnTty === false）。 */
  createDisabledReason?: string;
  /** 一般创建失败文案（已落库、可重试那一类）。 */
  errorMessage?: string;
  /**
   * 「零副作用」拒绝的**就地**提示（409 能力静态校验）：请求在落库前被拒，
   * 没有任务被创建 ⇒ 这里只提示改选，**不出现任何"重试/重新创建"入口**。
   */
  rejectionMessage?: string;

  // —— 任务指令（P20 §3.2 / P21-2 §6）——
  /** 当前输入值（container 局部 state；绝不来自 store）。 */
  initialPrompt: string;
  onInitialPromptChange: (value: string) => void;
}

/** 逐 provider 的能力注记：今天只有 spawnTty 对 UI 有意义（终端是核心链路），其余能力位留给后续 UI。 */
function capabilityNote(info: SandboxProviderDto): string | null {
  return info.capabilities.spawnTty ? null : '不支持终端';
}

export function NewSandboxPanelView({
  runtimes,
  runtime,
  onSelectRuntime,
  loadingRuntimes,
  runtimesErrorMessage,
  onRetryRuntimes,
  providers,
  provider,
  onSelectProvider,
  onCreate,
  creating,
  loadingProviders,
  providersErrorMessage,
  onRetryProviders,
  createDisabledReason,
  errorMessage,
  rejectionMessage,
  initialPrompt,
  onInitialPromptChange,
}: NewSandboxPanelProps) {
  const loadFailed = providersErrorMessage !== undefined && providersErrorMessage !== '';
  const noProviders = !loadingProviders && !loadFailed && providers.length === 0;
  const runtimesLoadFailed = runtimesErrorMessage !== undefined && runtimesErrorMessage !== '';
  const noRuntimes = !loadingRuntimes && !runtimesLoadFailed && runtimes.length === 0;
  /**
   * 有得选、但用户还没选。与 `noRuntimes`（根本没得选）是两回事，提示也必须是两句话：
   * 一句说"你还有一步没做"，另一句说"这个平台现在做不了这件事"。
   */
  const runtimeUnchosen =
    !loadingRuntimes && !runtimesLoadFailed && runtimes.length > 0 && runtime === '';
  // 用 Array.from 数码点，与后端 8000 的口径（UTF-8 码点）一致，emoji 不被算成两个。
  const promptLength = Array.from(initialPrompt).length;
  const promptTooLong = promptLength > INITIAL_PROMPT_MAX_LENGTH;
  const createDisabled =
    creating ||
    loadingProviders ||
    loadFailed ||
    noProviders ||
    provider === '' ||
    // runtime 与 provider 同权：两个开放注册表任一没就绪，请求就发不出去 ——
    // 与其发一个必被后端拒的 runtime，不如把按钮禁着并说明原因（14 §10.3 ②的前端一侧）。
    loadingRuntimes ||
    runtimesLoadFailed ||
    noRuntimes ||
    runtime === '' ||
    promptTooLong ||
    createDisabledReason !== undefined;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-center">
      <div>
        <h2 className="text-lg font-semibold">发起任务</h2>
        {/* 终端不再是"开工开关"：agent 会话由后端在 provision 的「启动实例」阶段起好（03 §4.3），
            打开终端只是 attach 已存在的会话——文案据此改写（S5 裁决 T-2）。 */}
        <p className="mt-1 text-sm text-muted-foreground">
          创建一个沙箱运行 agent；填了任务指令则 agent <strong>启动时即执行</strong>
          ，不必等你打开终端
        </p>
      </div>

      {/* runtime 与 provider 是**两个各自独立**的开放注册表：前者决定跑哪个 agent CLI
          （codex / claude-code / 第三方注册的），后者决定跑在哪种沙箱上。两组都由服务端下发。 */}
      <fieldset className="flex flex-col gap-2" disabled={creating}>
        <legend className="mb-1 text-xs text-muted-foreground">运行时 (runtime) · 必选</legend>

        {loadingRuntimes && (
          <div
            aria-busy="true"
            aria-label="正在加载可选运行时"
            data-testid="runtimes-skeleton"
            className="flex flex-col gap-2"
          >
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
        )}

        {runtimesLoadFailed && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-400">
              运行时加载失败：{runtimesErrorMessage}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                onRetryRuntimes();
              }}
            >
              重试加载运行时
            </Button>
          </div>
        )}

        {noRuntimes && (
          <p role="alert" className="text-sm text-muted-foreground">
            后端未注册任何 runtime，暂无法创建沙箱。
          </p>
        )}

        {!loadingRuntimes &&
          !runtimesLoadFailed &&
          runtimes.map((rt) => (
            <label key={rt.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="sandbox-runtime"
                value={rt.id}
                checked={runtime === rt.id}
                onChange={() => {
                  onSelectRuntime(rt.id);
                }}
              />
              <span className="font-mono">{rt.id}</span>
              <span className="text-muted-foreground">
                — {rt.displayName}（{rt.vendor}）
              </span>
            </label>
          ))}

        {/* 首屏就会出现（runtime 不预选）⇒ 这是**待办提示**而不是错误，故不挂 role="alert"：
            一进面板就朝屏幕阅读器喊一句 alert，等于把"正常的下一步"报成了故障。 */}
        {runtimeUnchosen && (
          <p className="text-xs text-muted-foreground">
            请选择一个运行时 —— 平台没有默认运行时，必须显式指定
          </p>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={creating}>
        <legend className="mb-1 text-xs text-muted-foreground">运行档位 (provider)</legend>

        {loadingProviders && (
          <div
            aria-busy="true"
            aria-label="正在加载可选运行档位"
            data-testid="providers-skeleton"
            className="flex flex-col gap-2"
          >
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
            <span className="h-4 w-40 animate-pulse rounded bg-muted" />
          </div>
        )}

        {loadFailed && (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-400">
              运行档位加载失败：{providersErrorMessage}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                onRetryProviders();
              }}
            >
              重试加载运行档位
            </Button>
          </div>
        )}

        {noProviders && (
          <p role="alert" className="text-sm text-muted-foreground">
            后端未注册任何 provider，暂无法创建沙箱。
          </p>
        )}

        {!loadingProviders &&
          !loadFailed &&
          providers.map((p) => {
            const note = capabilityNote(p);
            return (
              <label key={p.name} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sandbox-provider"
                  value={p.name}
                  checked={provider === p.name}
                  onChange={() => {
                    onSelectProvider(p.name);
                  }}
                />
                <span className="font-mono">{p.name}</span>
                {note !== null && <span className="text-muted-foreground">— {note}</span>}
                {p.isDefault && <span className="text-xs text-muted-foreground">(默认)</span>}
              </label>
            );
          })}
      </fieldset>

      <div className="w-full max-w-sm text-left">
        <label htmlFor="initial-prompt" className="text-xs text-muted-foreground">
          任务指令（可选）
        </label>
        <textarea
          id="initial-prompt"
          value={initialPrompt}
          onChange={(e) => {
            onInitialPromptChange(e.target.value);
          }}
          disabled={creating}
          rows={3}
          aria-invalid={promptTooLong}
          aria-describedby="initial-prompt-counter"
          placeholder="分析这个仓库的架构并输出摘要…（可选；填了则 agent 启动时即执行）"
          className="mt-1 w-full resize-y rounded border border-input bg-background p-2 text-sm"
        />
        <p
          id="initial-prompt-counter"
          {...(promptTooLong ? { role: 'alert' as const } : {})}
          className={
            promptTooLong ? 'mt-1 text-xs text-red-400' : 'mt-1 text-xs text-muted-foreground'
          }
        >
          {String(promptLength)}/{String(INITIAL_PROMPT_MAX_LENGTH)}
          {promptTooLong ? ' —— 已超出上限，请精简后再发起' : ''}
        </p>
      </div>

      {/* ⚠️ 这两条**语义相反**（"确定没落库" vs "不知道有没有落库"），却渲染成同一种节点，
          此前只差一个颜色 class——测试想区分它们就只能去匹配文案，于是文案一改测试就红，
          而链路根本没变。挂上 testid 让"走了哪条路"成为可断言的结构事实。 */}
      {rejectionMessage !== undefined && rejectionMessage !== '' && (
        <p data-testid="create-rejection" role="alert" className="max-w-sm text-sm text-amber-400">
          {rejectionMessage}
        </p>
      )}

      {errorMessage !== undefined && errorMessage !== '' && (
        <p data-testid="create-failure" role="alert" className="max-w-sm text-sm text-red-400">
          {errorMessage}
        </p>
      )}

      {createDisabledReason !== undefined && (
        <p role="alert" className="max-w-sm text-sm text-amber-400">
          {createDisabledReason}
        </p>
      )}

      <Button
        onClick={() => {
          onCreate();
        }}
        disabled={createDisabled}
      >
        {creating ? '创建中…' : '发起任务并打开终端'}
      </Button>
    </div>
  );
}
