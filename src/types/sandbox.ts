// 沙箱 provider 领域类型。REST 权威形状一律来自后端生成物（generate:api → openapi.d.ts），
// 与 runtimeCredential.ts 同构，杜绝手写漂移。
import type { components } from '@/types/generated/openapi';

/**
 * provider 标识：后端是**开放 registry**（第三方可注册），前端不得枚举闭集。
 * 历史：S1 曾在此写死 `SANDBOX_PROVIDERS = ['aio','boxlite']` + `DEFAULT_SANDBOX_PROVIDER`，
 * 导致后端注册的第三方 provider 在 UI 里根本看不见 —— 已改为服务端数据驱动（GET /api/providers）。
 * 值透传进 CreateSandboxDto.provider（生成物里就是自由字符串）。
 */
export type SandboxProvider = string;

/** GET /api/providers 数组项：name + 能力位 + 是否默认档（**默认档在每项上，无顶层字段**）。 */
export type SandboxProviderDto = components['schemas']['ProviderResponseDto'];

/**
 * 沙箱响应形状（POST /api/sandboxes 与 GET /api/sandboxes/:id 同形）。
 *
 * 落在 types/ 而不是只在 service 里的原因：**mocks/ 也要用它**（boundaries 只允许 mock → type），
 * 而 12 §3.4 要求替身的形状从生成类型派生并用显式返回类型咬住。同一个别名两边共用 ⇒
 * 后端给 DTO 加必填字段时，生产代码与替身**同时**报红（`provider` 就是这么漏进 mock 的）。
 */
export type SandboxDto = components['schemas']['SandboxResponseDto'];

/**
 * 逐 provider 能力位（**7 位全 required**）：驱动按能力显隐。
 *
 * 前端**今天真正消费的只有两位**，其余五位一律只是原样透传（列在这里是为了让下一个人
 * 一眼看见边界，而不是去 grep 才发现某一位其实没人读）：
 *  · `spawnTty`     —— `SandboxTerminalContainer`：false ⇒ 禁用建沙箱入口并给出原因。
 *  · `headlessTask` —— 按沙箱 DTO 的 `provider` 反查该档位：false ⇒ 无头任务入口置灰 + 原因。
 *    这一位同时管住作业面与文件面（04 §2.6）——两者必然同进同退，「能跑任务但取不回产物」
 *    不是可交付的一半。S6 已落地，两个内置 provider 现在都声明 `true`。
 *  · `volumeMount` / `updateResources` / `pauseResume` / `snapshot` / `watchEvents`
 *    —— **没有任何 UI 读它们**。
 *
 * ⚠️ 后一组不读，是**故意**的，不是漏了：能力位说的是「这个档位支不支持」，
 * 不等于「平台已经把这个功能做出来了」。快照/暂停/改配额今天连 REST 端点都没有，
 * 前端要是顺手按 `capabilities.snapshot` 长出一个按钮，用户点下去只会撞到 404 ——
 * 而且这个按钮会随后端换一版 provider 实现**自己冒出来**，没人改过一行前端代码。
 * 所以加这类入口的判据是「端点存在 + 有人验过」，能力位只是它的**前置条件**，不是触发器。
 */
export type SandboxProviderCapabilities = SandboxProviderDto['capabilities'];

/**
 * 建沙箱时的能力静态校验诉求（CreateSandboxDto.require，不满足 → 409）。
 * 本期**不发送**（没有对应 UI 入口）；此别名只是把口子在类型上标出来，
 * 后续若加「必须支持快照/暂停」之类的勾选，直接填进 createSandbox 的 body 即可。
 */
export type SandboxCapabilityRequire = NonNullable<
  components['schemas']['CreateSandboxDto']['require']
>;

/**
 * 任务指令（`CreateSandboxDto.initialPrompt`）长度上限：**8000 字符**
 * （SYNC WITH shared/10 §7.3 「≤8000 字符」与 13 §2.1.1 的 CHECK；P21-2 §6 要求就地计数）。
 *
 * ⏳ 契约里现在**已经有** `maxLength: 8000` 了（后端 B 轮补的），但 `openapi-typescript`
 * 会把 `maxLength` 这类**值约束**拍平——生成物里它仍然只是 `string`（14 §10.5 ③，
 * 与 `TASK_TIMEOUT_OPTIONS` 那四档闭集丢成 `number` 是同一回事）。
 * 所以这份常量还是只能前端自留一份，**代价照旧要说清楚**：后端把上限改成别的值时，
 * 这里不会有任何编译错误，界面只是静默地按旧上限计数。
 *
 * 放 types/ 是为了 view（不能 import lib）与 container 共用同一个常量——view 层不得再写死一份。
 */
export const INITIAL_PROMPT_MAX_LENGTH = 8000;
