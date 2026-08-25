// SYNC WITH product/22-异常场景与产品补充要求.md §1（错误码 → 用户语义映射）——修改需与产品口径对表。
//
// P22 §1 的原则：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本表的每一条都强制带 `actions`（至少一条），由 view 渲染成按钮。纯函数、零依赖，可单测。
// 注意分层：lib 只能依赖 lib/type（07 §4.1），故错误信封形状直接取生成物，不经 services。
import type { components } from '@/types/generated/openapi';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** 失败卡上可点的动作。container 负责把 key 接到真实 handler。 */
export interface SandboxErrorAction {
  /** `retry` = 用同样的配置再来一次；`reconfigure` = 回到新建入口改配置（换镜像/换档位）。 */
  key: 'retry' | 'reconfigure';
  label: string;
}

export interface SandboxErrorCopy {
  /** 原始错误码（诊断用；不直接展示给用户，展示的是 title/advice）。 */
  code: string;
  /** 人话：发生了什么。 */
  title: string;
  /** 现在能做什么 / 为什么会这样。 */
  advice: string;
  actions: readonly SandboxErrorAction[];
  /**
   * 后端给的**自由文本**失败细节（`SandboxResponseDto.failureMessage`），排障用小字。
   * ⚠️ 只原样透出，**不参与任何判定**——码与文本已由后端拆成两列，禁止从这里 parse 码。
   */
  detail?: string;
}

const RETRY: SandboxErrorAction = { key: 'retry', label: '重试' };

/**
 * P22 §1 表的前端落点。只列**本切片链路上真会触达用户**的码；
 * 未收录的码走 `fallbackCopy`（仍然给人话 + 一个可点动作，不裸抛码）。
 */
const COPY_TABLE: Record<string, Omit<SandboxErrorCopy, 'code'>> = {
  // —— S5 新增两条 ——
  INSTALL_FAILED: {
    title: '❌ 运行时 CLI 安装失败（该镜像未预装，现装未成功）',
    advice:
      '安装发生在「启动实例」阶段内，失败时任务已停止。可以重试一次；反复失败建议换一张**预装该 CLI**的镜像（未预装的镜像现装可能耗时十几分钟）。',
    actions: [RETRY, { key: 'reconfigure', label: '换一张预装该 CLI 的镜像' }],
  },
  IMAGE_CONTRACT_VIOLATION: {
    title: '❌ 镜像不满足平台约定（缺少 tmux），任务已停止',
    advice:
      '这张镜像注册时通过了校验，但真正启动时实测发现缺 tmux（镜像换了 tag 或上游变更）。tmux 是必须项——没有它，平台一重启就会丢掉正在跑的 agent 会话，因此不做静默降级。',
    // ⚠️ P22 §1 明写**不给 [重试]**：重试不会改变镜像内容，只是再失败一次。
    actions: [{ key: 'reconfigure', label: '换一张含 tmux 的镜像' }],
  },

  // —— 门口拒绝（后端标 `sideEffectFree: true`）的**降级**文案 ——
  //
  // ⚠️ 正常路径上这几条**根本走不到这张表**：它们带着标记，由 `isZeroSideEffectRejection`
  // 拦去「就地提示改配置」那条路。会落到这里只有一种情形——**后端漏标**（标记 optional，
  // 缺席按保守读法当作可能有副作用）。所以这几段话必须在"不确定有没有落库"的前提下依然成立：
  // 只说码本身的事实与出路，**不承诺"什么都没创建"**（那句话只属于就地提示那条路）。
  //
  // ⏳ **待产品确认**（P22 §1 是文案权威）：后端明确不替前端写产品文案，以下为前端按码义暂拟。
  //
  // 七条都**不给 [重试]**：后端一律 `retryable: false`，原样重来必然再被同一道门拒一次
  //（与 `IMAGE_CONTRACT_VIOLATION` 同理——重试不改变被拒的那个输入）。
  //
  // 收录**齐这七条**本身就是要求的一部分：漏收一条不是"少一段话"，而是它掉进 `fallbackCopy`
  // ——那段兜底带着 `[重试]`，正好对门口拒绝说了最不该说的那句话。下面的测试按名单逐条守着。
  //
  // ⚠️ **这件事真发生过**：`BRANCH_NOT_FOUND` 随「建 Task 选分支」进了 10 §6.8 的清单，
  // 而这里停在六条 —— 两侧名单各自都"完整"，合起来漏了一条，测试照样全绿。
  // 下面那条 `每一条都必须在这张表里` 的用例（按 10 §6.8 逐条对）就是为此加的。
  UNKNOWN_PROVIDER: {
    title: '❌ 运行档位不存在（平台没有注册这个 provider）',
    advice:
      '所选运行档位不在平台注册表里（档位被下线，或页面上的档位列表已经过期）。刷新后改选一个仍然存在的档位——用同一个档位名重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '改选运行档位' }],
  },
  /**
   * ⚠️ 与 `lib/taskOutcome.ts` 里的同名码**不是重复**：那张表讲的是"任务跑到一半发现
   * runtime 没了"（任务终态），这里讲的是"创建请求在门口就被拒"。同一个事实、两个语境，
   * 各自的出路句子不同——合并会让其中一句在另一条路上说假话。
   */
  UNKNOWN_RUNTIME: {
    title: '❌ Runtime 不存在（平台没有注册这个 runtime）',
    advice:
      '这个 runtime 不在平台注册表里（常见于随第三方模块注册的 runtime：平台重启后该模块没有再加载）。请装回该模块，或改选注册表里仍有的 runtime——重来同一个 runtime 只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '改选 runtime' }],
  },
  /**
   * 项目相关的两条与上面三条同为门口拒绝，但**出路不在这个面板里**——用户要去的是
   * 项目那一侧，而不是改这里的任何一个选项。所以 actions 给的是 `reconfigure`
   * 语义上的「去看项目」，不是「改配置」。
   */
  PROJECT_NOT_FOUND: {
    title: '❌ 项目不存在（可能已被删除）',
    advice:
      '这个项目在平台里查不到——通常是它已经被删除，而当前页面上的项目列表还是删除之前的。刷新后从现有项目里重新选一个；用同一个项目重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '刷新并改选项目' }],
  },
  /**
   * ⚠️ 同一个码有**两种子情形**，而这张表是**静态**的、拿不到后端那句带 `clone_status=…`
   * 的 message（正常路径上那句话由「就地提示」那条路透出）。所以这段话必须对两种都成立——
   * **不要写死成"等一会儿就好"**，克隆失败时那是一句假话。
   *
   * 这两种是**穷尽**的：后端 `CLONE_STATUSES = ['cloning','ready','failed']`，去掉 `ready`
   * 就只剩这两个。给的两条出路也不是拍脑袋——正是 `failed` 仅有的两条合法迁移
   * （`failed → cloning` 重试克隆 / `failed → ready` 转空项目）。
   *
   * 不给 [重试] 与后端的理由同源：项目得先**变成** ready，原样重发这个请求多少次都不会
   * 让它变（`resolveProject` 处的注释）。"仍在克隆"看着像"待会儿能成"，但那要等的是
   * 另一件事完成，不是这个按钮该承担的语义。
   */
  PROJECT_NOT_READY: {
    title: '❌ 项目还不能接受任务',
    advice:
      '项目的代码基线还没准备好：要么仍在克隆，要么克隆失败了。到项目页看它当前的状态——仍在克隆就等它完成，失败了就先重试克隆或改成空项目。**在那之前，这个项目上发起任何任务都会被同样拒掉。**',
    actions: [{ key: 'reconfigure', label: '去项目页查看状态' }],
  },
  /**
   * 分支不存在（随「建 Task 选分支」加入，10 §6.8 第七行）。
   *
   * 出路是**改选分支**而不是重试：分支列表读的是基线里的本地引用
   * （完整克隆之后不触网，03 §7.2★），所以"列表里有、门口说没有"只有两种可能——
   * 远端删了分支而基线还没同步，或者用户手填了一个不存在的名字。两者都不是重试能解决的。
   */
  BRANCH_NOT_FOUND: {
    title: '❌ 这个分支不在项目基线里',
    advice:
      '所选分支在项目的代码基线里找不到（可能是远端已删除，而基线还停在同步之前）。改选一个基线里有的分支；如果确信远端有，先到项目上做一次[重新同步]再回来选。**重来同一个分支名只会再被拒一次。**',
    actions: [{ key: 'reconfigure', label: '改选分支' }],
  },
  /**
   * 能力位不匹配。**出路有两条**且指向相反的方向（换 provider / 降要求），文案不替用户选，
   * 只把两条都摆出来——`SandboxRequestDto` 里这两样是同一个表单上的两个字段。
   */
  UNSUPPORTED_CAPABILITY: {
    title: '❌ 所选运行档位不具备本次任务要的能力',
    advice:
      '这个 provider 的能力位里没有本次任务要用到的那一项（如快照、无头任务）。要么改选一个具备该能力的运行档位，要么去掉这项能力要求——两者都不改的话，重来只会再被同一道门拒一次。',
    actions: [{ key: 'reconfigure', label: '改选运行档位或调整能力要求' }],
  },
  INVALID_IMAGE_REFERENCE: {
    title: '❌ 镜像地址不合法（含空白或控制字符）',
    advice:
      '镜像地址里出现了空格、换行或不可见的控制字符，平台不会把它拼进容器运行时调用。请检查是否误粘了换行或不可见字符后重填——原样重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '检查镜像地址' }],
  },

  // —— 工作区准备阶段（03 §7.6）。2026-08 之前这两个码**根本到不了这里** ——
  //
  // ⚠️ 后端当时抛的是 Node 的 errno：`prepare()` 的 fs 错误直接出线，`failureOf` 读
  // `error.code` 拿到 `ENOSPC` / `EACCES` 就当平台码用了。于是**磁盘写满**这件事——
  // 全部失败里用户处置最明确的一件——落到本文件的 `fallbackCopy`，得到的是
  // 「未能获取具体原因，可以重试一次」外加一个 [重试] 按钮。
  //
  // 后端把码归一进闭集之后，这两条才真的会走到这张表。**只改后端是白改的**：码准了而
  // 表里没有对应的句子，用户看到的还是同一段兜底话——这正是 `BRANCH_NOT_FOUND` 那次
  // 「两侧各自完整、合起来漏一条」的同一种形状。
  DISK_INSUFFICIENT: {
    title: '❌ 磁盘空间不足，工作区没能准备出来',
    advice:
      '平台要把项目基线复制一份给这个任务用，而目标磁盘的剩余空间不够。**先去清理磁盘再回来重试**——空间没变之前，重试多少次都是同样的结果。',
    // ⚠️ 不给裸 [重试]：后端 `retryable: false`（10 §6.8），因为原样重来必然同样失败。
    // 但"清理之后再重试"是真出路，所以按钮留着、**把前置条件写进 label**——
    // 让按钮自己说清它什么时候才有意义，而不是配一个会骗人的「重试」。
    actions: [{ key: 'retry', label: '清理磁盘后重试' }],
  },
  WORKSPACE_PREPARE_FAILED: {
    title: '❌ 工作区准备失败（平台侧）',
    advice:
      '平台在把项目基线复制成本次任务的工作区时出错了（权限、目录状态或文件系统问题）。这一步在实例创建之前，所以没有残留的容器。可以重试一次；反复失败请带上下方的 traceId 报障。',
    actions: [RETRY, { key: 'reconfigure', label: '返回重新配置' }],
  },

  // —— 既有码（P22 §1 同表）——
  IMAGE_PULL_FAILED: {
    title: '❌ 镜像拉取失败（网络或镜像名错误）',
    advice: '检查网络与镜像地址后重试。',
    actions: [RETRY, { key: 'reconfigure', label: '检查镜像地址' }],
  },
  MANIFEST_INVALID: {
    title: '❌ 镜像不满足平台约定',
    advice: '该镜像未通过平台校验（如缺少 tmux 等必须项），请改用合格镜像。',
    actions: [{ key: 'reconfigure', label: '换一张镜像' }],
  },
  RESOURCE_EXHAUSTED: {
    title: '❌ 当前任务较多，资源暂时不足',
    advice: '停止部分任务释放资源，或稍后重试。',
    actions: [
      { key: 'retry', label: '稍后重试' },
      { key: 'reconfigure', label: '返回任务列表' },
    ],
  },
  PROVIDER_UNAVAILABLE: {
    title: '🔴 运行时无响应（容器服务未启动？）',
    advice: '容器服务可能未启动，确认后重试。',
    actions: [RETRY],
  },
  TIMEOUT: {
    title: '⏱️ 操作超时',
    advice: '可以重试；若持续超时请检查容器服务负载。',
    actions: [RETRY],
  },
  INVALID_STATE: {
    title: '⚠️ 当前状态不允许此操作',
    advice: '状态已变化，刷新后按新状态操作。',
    actions: [{ key: 'retry', label: '刷新重试' }],
  },
};

/**
 * 「零副作用」＝后端**显式声明**"这次请求什么都没改变"（`ErrorEnvelope.sideEffectFree`）。
 *
 * ⚠️ 这是本文件最要紧的一条区分：能力静态校验、未知 provider / 未知 runtime、非法镜像引用
 * 这些**门口拒绝**发生在解析项目 / 落库 / 进调度之前（10 §6.1 / 04 §5），前端**拿不到
 * sandbox id、列表里也不会留下 failed 记录** ⇒ 它们**不能**走"创建失败可重试"的失败卡路径
 *（那条路径预设"已落库、中途失败"，会渲染出一个并不存在的任务）。
 * 正确呈现：**就地**在新建入口提示改配置，用户改完再点创建。
 * 对照：`INSTALL_FAILED` 是已落库、`starting` 中途失败 ⇒ 走正常失败态。
 *
 * ── 为什么读字段，而不是从 HTTP 码反推 ──────────────────────────────────────────
 * 旧判据是 `httpStatus === 409 && code === 'UNSUPPORTED_CAPABILITY'`。而零副作用的门口拒绝
 * 一共六条，其中只有它是 409：未知 provider / 未知 runtime / 非法镜像引用是 400，
 * `PROJECT_NOT_FOUND` 是 404、`PROJECT_NOT_READY` 是 409 但码不同 ⇒ 除能力校验外的五条
 * **一直**被渲染成"创建失败，可重试"，而它们什么都没创建。这个洞不是哪个新码带来的，
 * 是"从状态码反推语义"这个做法本身带来的。`retryable` 的契约注释早就写着同一条纪律
 *（"the frontend renders [retry] off it, **not off the HTTP status code**"），
 * `sideEffectFree` 是它的同族：**语义由后端声明，前端不猜**。
 *
 * ── 缺席 ＝ 未表态，按「**可能**有副作用」读 ─────────────────────────────────────
 * 字段是 optional 的。缺席时返回 `false`（走失败卡）而不是 `true`，方向是刻意选的：
 * 后端漏标一处，用户只是**退化回今天的样子**（多一张可重试的失败卡，顶多白点一次重试）；
 * 反过来把缺席当成零副作用，就会在一个**真的建了半截**的任务上告诉用户"本次请求未创建任何
 * 任务"——那是在说假话，而且是会让人放心走开、事后才发现有个僵尸沙箱的那种假话。
 *
 * ── ⚠️ 这个判据只服务**创建**语境 ───────────────────────────────────────────────
 * `sideEffectFree` 说的是"这次请求什么都没改变"，**它没说"什么都没创建"**——后者只是
 * 创建语境下的一个特例。同一个标记换个动作意思就变，最容易出事的是**终止**：终止请求被拒时
 * 它的意思是"这次终止**没生效**，任务大概率还在跑"，把创建那句"本次请求未创建任何任务"
 * 搬过去就是驴唇不对马嘴，而且正好把用户往反方向推。
 * 防线不止这段注释：`zeroSideEffectRejectionMessage` 的 `context` 是**必填闭集**，
 * 新增一个语境必须先给它写一句自己的话，漏写当场 tsc 红（见下）。
 *
 * ── 已知的一处邻近混用（本轮**刻意不动**，属产品口径）───────────────────────────
 * `hooks/useAgentTask.ts` 的 `useTaskErrorMessage` 让**发起失败 / 终止失败 / 任务结束**
 * 三个语境共用 `lib/taskOutcome.ts` 那张**任务终态**表。后果两条：
 *   · 一旦 `UNKNOWN_RUNTIME` 走到**发起**路径（后端 `assertRunnable` 就在门口拒），用户看到
 *     的是终态表那句"…**本轮无法继续**…重跑同一个 runtime 只会再失败一次"——而实际上
 *     **根本没有"本轮"**，什么都没发起；
 *   · **终止**语境下同一个标记的正确读法是"这次终止没产生任何效果"，不是"什么都没创建"。
 * 两条都要动用户可见文案，故留给下一轮；在那之前，下面那道 `context` 闭集就是
 * "别顺手把创建的措辞复用到 cancel 那条路上"的编译期防线。
 */
export function isZeroSideEffectRejection(error: Pick<ErrorEnvelope, 'sideEffectFree'>): boolean {
  // `=== true` 而不是真值判断：`undefined`（未表态）与 `false`（表态说有副作用）都必须落到 false。
  return error.sideEffectFree === true;
}

/**
 * 零副作用拒绝落在**哪个动作**上。刻意做成**必填闭集**而不是可选参数——见上面
 * 「这个判据只服务创建语境」那段：加一个语境（比如终止）必须在 `ZERO_SIDE_EFFECT_PHRASING`
 * 里给它写一句自己的话，漏写 ⇒ `satisfies Record<…>` 当场 tsc 红。
 */
export type ZeroSideEffectContext = 'create';

interface ZeroSideEffectPhrasing {
  /** 开头：这次**什么动作**没做成。 */
  lead: string;
  /** 后端 message 为空时的兜底原因。**不提能力位**——六条门口拒绝里只有一条与能力有关。 */
  fallbackReason: string;
  /** 收尾：出路 ＋ "这次什么都没发生"在**本语境**里的说法。绝不含"重试/重新创建"。 */
  tail: string;
}

const ZERO_SIDE_EFFECT_PHRASING = {
  create: {
    lead: '无法用当前配置创建',
    fallbackReason: '当前配置不被平台接受',
    // 「调整配置」而不是「改选运行档位或调整能力要求」：后者是能力校验专属措辞，
    // 对"非法镜像引用"这类拒绝是错的（用户要改的是镜像地址，不是能力要求）。
    tail: '请调整配置后再试（本次请求未创建任何任务）。',
  },
} satisfies Record<ZeroSideEffectContext, ZeroSideEffectPhrasing>;

/** 零副作用拒绝的**就地**提示文案（不含任何"重试/重新创建"语义）。 */
export function zeroSideEffectRejectionMessage(
  error: Pick<ErrorEnvelope, 'message'>,
  context: ZeroSideEffectContext,
): string {
  const phrasing = ZERO_SIDE_EFFECT_PHRASING[context];
  const reason = error.message !== '' ? error.message : phrasing.fallbackReason;
  return `${phrasing.lead}：${reason}。${phrasing.tail}`;
}

/** 未收录码的兜底：仍给人话 + 一个可点动作（P22 §1 禁止裸抛错误码）。 */
function fallbackCopy(code: string, message?: string): SandboxErrorCopy {
  return {
    code,
    title: '❌ 任务启动失败',
    advice:
      message !== undefined && message !== ''
        ? message
        : '未能获取具体原因，可以重试一次；若持续失败请查看系统状态。',
    actions: [RETRY, { key: 'reconfigure', label: '返回重新配置' }],
  };
}

/** 沙箱**已停止**（非失败）时的呈现——与失败区分，不出红字错误码。 */
export const SANDBOX_ENDED_COPY: SandboxErrorCopy = {
  code: 'ENDED',
  title: '沙箱已停止',
  advice: '该任务的沙箱已结束，可以重新创建一个。',
  actions: [{ key: 'reconfigure', label: '重新创建' }],
};

/**
 * 错误码 → 人话 + 可操作建议。
 *
 * `code` 的来源只有两条（两者写同一个 store 字段，故此处只需处理一份）：
 *   · WS `sandbox.status_changed.errorCode`（即时）；
 *   · REST `SandboxResponseDto.failureCode`（刷新恢复）。
 * `code` 缺失（旧数据/异常路径）仍必须返回一份可渲染的兜底文案，不裸抛码。
 *
 * `detail` = `failureMessage`（自由文本），原样带出给排障小字用。
 */
export function describeSandboxError(input: {
  code?: string;
  message?: string;
  detail?: string;
}): SandboxErrorCopy {
  const code = input.code ?? '';
  const detail = input.detail === undefined || input.detail === '' ? {} : { detail: input.detail };
  const entry = COPY_TABLE[code];
  if (entry === undefined) {
    return { ...fallbackCopy(code === '' ? 'UNKNOWN' : code, input.message), ...detail };
  }
  return { code, ...entry, ...detail };
}
