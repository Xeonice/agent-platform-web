// 新建任务弹窗的内容（F21-2 §N.1「单弹窗一屏」）：runtime / provider / **分支** / 指令 + [创建]。
// 纯展示、props 驱动、零副作用；外壳（overlay + 标题 + [✕]）由 `ModalShell.view` 提供。
//
// ⚠️ **它此前不是弹窗**：`SandboxTerminalContainer` 在 `sandboxId===null || socketConfig===null`
// 时**兜底渲染**它——不是被"打开"的，是条件为假时自己出现的，于是"创建"根本不是一个动作
// （F21-2 §N.0）。本轮它有了显式入口（工作台 [+ 新任务]）并搬进真弹层。
//
// ⚠️ **鉴权闸门就地展开、不跳步**：`authGateSlot` 一直就在这份 props 里——鉴权面板早就是
// 内嵌的，代码本来就在往单弹窗走；从未存在过的 `WizardShell`/`ConfirmConfig`/`CreationProgress`
// 两步壳本轮不再补建（F21-2 §3：那棵组件树 20 个里 15 个不存在）。
//
// ⚠️ **两个开放注册表，一套做法**（14 §10.3 ①）：`runtime` 与 `provider` 都是后端运行时注册的开放集，
// 列表项 / 默认选中 / 能力位一律由 container 从服务端响应注入 —— 视图既不枚举取值，也不兜底默认值。
// 历史教训：runtime 这一半曾被写成前端常量 `S2_DEFAULT_RUNTIME = 'shell'`，后端注册表里根本没有
// 这个键 ⇒ 从这个入口建的沙箱一律死在 `unknown runtime 'shell'`，而四道防线一道都没拦住（14 §10.1）。
//
// ⚠️ 安全红线（15 §3.5）：任务指令的值由 **container 的局部 state** 持有并经 props 传入，
// 视图不得把它写进任何 store / storage；container 提交即清空。
import type { ReactNode } from 'react';
import type { RuntimeDto } from '@/types/runtimeCredential';
import type { SandboxProviderDto } from '@/types/sandbox';
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
   * 后端为**这台宿主**选定的档位（`GET /api/providers` 里 `isDefault` 那条）；
   * `undefined` = 还没就绪（加载中 / 失败 / 后端一个 provider 都没注册）。
   *
   * ⚠️ **这里不再让用户选档位**：`AioSandboxProvider extends DockerContainerBackend`
   * ——aio 就是 docker 容器；boxlite 是微 VM（macOS 上走 Apple Hypervisor.framework）。
   * 哪个跑得起来是**宿主平台**的事实，不是用户的偏好：Mac 上选 aio 只会撞上
   * 「没有 Docker」。选择权收回后端（`provider-registry.ts` 的 `hostPreferredProvider`），
   * 前端**只读**它——而且只用来判能力位（如 `spawnTty`），发请求时连传都不传，
   * 免得「选哪个」有第二个知情者。
   */
  hostProvider?: SandboxProviderDto;
  onCreate: () => void;
  creating: boolean;
  /** provider 尚在加载：禁用创建并说明（**不静默**——按钮禁着却不给理由是最难查的那种）。 */
  loadingProviders: boolean;
  /** provider 加载失败文案（非空即出可重试提示，不静默降级）。 */
  providersErrorMessage?: string;
  onRetryProviders: () => void;
  /** 非空 → 禁用创建并展示原因（如所选 provider 不支持终端，capabilities.spawnTty === false）。 */
  createDisabledReason?: string;

  // —— 分支选择器（F21-2 §N.1，本轮新增）——
  /**
   * 是否渲染分支选择器。**空项目一律 false**——没有 git，谈不上分支
   *（§9.1 #17：这条是"不渲染"，不是"渲染一个空下拉"）。
   */
  showBranchPicker: boolean;
  /** 可选分支（来自 `GET /api/projects/:id/branches`，读的是**本地**引用，不触网）。 */
  branches: readonly string[];
  /**
   * 当前所选分支；`''` = **没选**。
   * ⚠️ 没选不是"有问题"，是**缺省 = 基线当前分支**（§9.4 ④）：container 据此
   * 在请求体里**不带** `branch` 字段，由后端走缺省 —— 前端不自作主张填值。
   */
  branch: string;
  onSelectBranch: (branch: string) => void;
  /** 分支列表加载中（骨架；**不禁用创建**——分支是可选覆盖，缺省永远在）。 */
  loadingBranches: boolean;
  /**
   * 分支列表取不到时的说明。**降级为"用基线分支"，不拦创建**：
   * 把一个可选项的加载失败升级成阻断，等于让一条本不该存在的失败路径拦住核心链路。
   */
  branchesErrorMessage?: string;

  /** 弹层上下文：任务归属的项目名（弹窗内**没有**项目下拉，归属继承左侧树选中项，§9.0）。 */
  projectName?: string;
  /** [取消]（与 ModalShell 的 [✕] / Esc 同一个动作）。 */
  onCancel?: () => void;

  // —— 鉴权拦截（P20 §5.1 三分支）——
  /**
   * 分支②/③的**无编号拦截面板**。由 container 注入（视图不认识 AuthGateContainer,
   * 也不判凭证状态——那是 container 读 `GET /api/runtimes` 的 `credentialStatus` 决定的）。
   *
   * ⚠️ 它在场即**发起被拦住**:没有可注入的凭证却让人点发起,后端只能记一条
   * `NO_CREDENTIAL` 的 WARN、让 agent 裸跑,用户在终端里看见 CLI 自己的登录菜单,
   * 而平台从头到尾没提示过一句。这正是本轮修掉的那条链路。
   */
  authGateSlot?: ReactNode;
  /** 分支①：已有生效凭证时的正面确认——"将以 a***@gm 身份运行"（P20 §5.1）。 */
  runtimeIdentityNotice?: string;
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

export function NewSandboxPanelView({
  runtimes,
  runtime,
  onSelectRuntime,
  loadingRuntimes,
  runtimesErrorMessage,
  onRetryRuntimes,
  hostProvider,
  onCreate,
  creating,
  loadingProviders,
  providersErrorMessage,
  onRetryProviders,
  createDisabledReason,
  showBranchPicker,
  branches,
  branch,
  onSelectBranch,
  loadingBranches,
  branchesErrorMessage,
  projectName,
  onCancel,
  authGateSlot,
  runtimeIdentityNotice,
  errorMessage,
  rejectionMessage,
  initialPrompt,
  onInitialPromptChange,
}: NewSandboxPanelProps) {
  const loadFailed = providersErrorMessage !== undefined && providersErrorMessage !== '';
  const noProviders = !loadingProviders && !loadFailed && hostProvider === undefined;
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
    // runtime 与 provider 同权：两个开放注册表任一没就绪，请求就发不出去 ——
    // 与其发一个必被后端拒的 runtime，不如把按钮禁着并说明原因（14 §10.3 ②的前端一侧）。
    loadingRuntimes ||
    runtimesLoadFailed ||
    noRuntimes ||
    runtime === '' ||
    promptTooLong ||
    // 分支②/③：该 runtime 没有可注入的凭证 ⇒ 先过闸门,再谈发起。
    authGateSlot !== undefined ||
    createDisabledReason !== undefined;

  return (
    <div
      data-testid="new-sandbox-panel"
      className="flex flex-col items-center gap-5 p-6 text-center"
    >
      <div>
        {/* 终端不再是"开工开关"：agent 会话由后端在 provision 的「启动实例」阶段起好（03 §4.3），
            打开终端只是 attach 已存在的会话——文案据此改写（S5 裁决 T-2）。 */}
        <p className="text-sm text-muted-foreground">
          {projectName === undefined || projectName === ''
            ? '创建一个沙箱运行 agent'
            : `在「${projectName}」中创建一个沙箱运行 agent`}
          ；填了任务指令则 agent <strong>启动时即执行</strong>，不必等你打开终端
        </p>
      </div>

      {/* runtime 是开放注册表：跑哪个 agent CLI（codex / claude-code / 第三方注册的）由服务端下发。
          ⚠️ 曾经与它并列的还有一组「运行档位 (provider)」单选——**已删**：跑在哪种沙箱上
          是宿主平台的事实，不是用户的偏好（详见下面那段注释）。 */}
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

      {runtimeIdentityNotice !== undefined && (
        <p data-testid="runtime-identity" className="text-xs text-muted-foreground">
          {runtimeIdentityNotice}
        </p>
      )}

      {authGateSlot !== undefined && (
        <div data-testid="auth-gate" className="w-full max-w-md text-left">
          {authGateSlot}
        </div>
      )}
      {/*
        ⚠️ **这里曾经是「运行档位 (provider)」单选组，现在故意什么都不渲染。**

        aio 是 docker 容器（`AioSandboxProvider extends DockerContainerBackend`），
        boxlite 是微 VM（macOS 上走 Apple Hypervisor.framework）。哪个跑得起来是
        **宿主平台的事实**，不是用户的偏好——Mac 上选 aio 只会撞上「没有 Docker」，
        而报出来的错还是「镜像尚未注册」，指不到真正的原因。选择权因此收回后端
        （`provider-registry.ts` 的 `hostPreferredProvider`）。

        ⚠️ 但**异常态仍然要说话**：加载中 / 失败 / 后端一个 provider 都没注册时，
        创建按钮是禁着的——禁着却不给理由，是最难查的那种 UI。
      */}
      {(loadingProviders || loadFailed || noProviders) && (
        <div className="flex flex-col items-center gap-2 text-sm">
          {loadingProviders && (
            <span
              aria-busy="true"
              aria-label="正在确认运行环境"
              data-testid="providers-skeleton"
              className="h-4 w-40 animate-pulse rounded bg-muted"
            />
          )}

          {loadFailed && (
            <div className="flex flex-col items-center gap-2">
              <p role="alert" className="text-red-400">
                运行环境确认失败：{providersErrorMessage}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  onRetryProviders();
                }}
              >
                重试
              </Button>
            </div>
          )}

          {noProviders && (
            <p role="alert" className="text-muted-foreground">
              后端未注册任何沙箱运行环境，暂无法创建沙箱。
            </p>
          )}
        </div>
      )}

      {/*
        分支选择器（F21-2 §N.1）。三条否定性语义都在这一块里：
         · **空项目整块不渲染**（没有 git，谈不上分支）——`showBranchPicker` 为假时连 DOM 都没有；
         · **缺省 = 基线当前分支**：默认选项的 value 是 `''`，container 据此不带 `branch` 字段；
         · **不触网**：选项来自后端读本地引用（`git branch -r`），没有"配 Git 凭证"这条分支。
        加载失败也**不禁用创建**：分支是可选覆盖，缺省永远在。
      */}
      {showBranchPicker && (
        <div className="w-full max-w-sm text-left" data-testid="branch-picker">
          <label htmlFor="sandbox-branch" className="text-xs text-muted-foreground">
            分支（可选）
          </label>
          {loadingBranches ? (
            <div
              aria-busy="true"
              aria-label="正在加载可选分支"
              data-testid="branches-skeleton"
              className="mt-1 h-8 w-full animate-pulse rounded bg-muted"
            />
          ) : (
            <select
              id="sandbox-branch"
              value={branch}
              disabled={creating}
              onChange={(e) => {
                onSelectBranch(e.target.value);
              }}
              className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="">跟随基线当前分支（默认）</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          {branchesErrorMessage !== undefined && branchesErrorMessage !== '' && (
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              分支列表暂不可用（{branchesErrorMessage}），将使用基线当前分支创建。
            </p>
          )}
        </div>
      )}

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

      <div className="flex gap-2">
        {onCancel !== undefined && (
          <Button
            type="button"
            variant="ghost"
            disabled={creating}
            onClick={() => {
              onCancel();
            }}
          >
            取消
          </Button>
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
    </div>
  );
}
