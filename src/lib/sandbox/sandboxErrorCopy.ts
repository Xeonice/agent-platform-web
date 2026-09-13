// SYNC WITH product/22-异常场景与产品补充要求.md §1（错误码 → 用户语义映射）——修改需与产品口径对表。
//
// P22 §1 的原则：**每条错误必须同时给「发生了什么（人话）」和「现在能做什么（按钮）」，禁止裸抛错误码**。
// 因此本表的每一条都强制带 `actions`（至少一条），由 view 渲染成按钮。纯函数、零依赖，可单测。
// 注意分层：lib 只能依赖 lib/type（07 §4.1），故错误信封形状直接取生成物，不经 services。
//
// ⚠️⚠️ **这张表里的 `title` / `advice` 是纯文本，不是 Markdown。**
// 三个消费点（`SandboxOutcome.view` / `TaskOutcome.view` / `NewSandboxPanel.view`）都是
// `<p>{advice}</p>`，全仓**没有任何 markdown 渲染器** —— 写 `**重点**` 的结果是屏幕上真的
// 出现两颗星号。要强调就**改句序、把重点放句首**，不要加标记。
// （这条曾经在全表 11 处同时犯，连同 `SandboxTerminalContainer` 的 `createDisabledReason`。）
//
// ⚠️ 上屏口径（本轮统一，见 P21-1 §9 / P22 §1）：
//   · runtime            → 「Agent」
//   · provider / 运行档位 → 「这台机器的沙箱环境」；**界面上已经没有这个开关了**
//     （`NewSandboxPanel.view` 的单选组已删，选择权收回后端）⇒ ⛔ 文案不许再叫用户「改选档位」。
//   · 沙箱 / 容器（指一次运行） → 「任务」
//   · 实例 → 「运行环境」；工作区 → 「代码副本」；基线 → 「项目当前的代码」
//   · digest / 钉定 → 「锁定的那一版」；坐标 / repository / tag → 「镜像地址 / 名字与版本」
//   · 落库 → 「创建」；后端 → 「平台」
import type { components } from '@/types/generated/openapi';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** 失败卡上可点的动作。container 负责把 key 接到真实 handler。 */
export interface SandboxErrorAction {
  /** `retry` = 用同样的配置再来一次；`reconfigure` = 回到新建入口改配置（换镜像/换分支/换 Agent）。 */
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
    title: '❌ Agent 的命令行工具没能装上（这张镜像里没有预装它）',
    advice:
      '安装是在「启动运行环境」这一步做的，失败时任务已经停下了。可以重试一次；反复失败就换一张预装了这个工具的镜像 —— 没预装的镜像现装可能要十几分钟。',
    actions: [RETRY, { key: 'reconfigure', label: '换一张预装该工具的镜像' }],
  },
  IMAGE_CONTRACT_VIOLATION: {
    title: '❌ 这张镜像缺少 tmux，任务已停止',
    advice:
      '注册这张镜像时校验是过的，真正启动时实测发现里面没有 tmux（镜像换了版本，或者上游改了内容）。tmux 不能少：没有它，平台一重启就会丢掉正在跑的 agent 会话，所以这里不做静默降级。换一张带 tmux 的镜像再发起。',
    // ⚠️ P22 §1 明写**不给 [重试]**：重试不会改变镜像内容，只是再失败一次。
    actions: [{ key: 'reconfigure', label: '换一张含 tmux 的镜像' }],
  },

  // —— 门口拒绝（后端标 `sideEffectFree: true`）的**降级**文案 ——
  //
  // ⚠️ 正常路径上这几条**根本走不到这张表**：它们带着标记，由 `isZeroSideEffectRejection`
  // 拦去「就地提示改配置」那条路。会落到这里只有一种情形——**后端漏标**（标记 optional，
  // 缺席按保守读法当作可能有副作用）。所以这几段话必须在"不确定有没有创建"的前提下依然成立：
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
    title: '❌ 平台没有登记这台机器的沙箱环境',
    advice:
      '这次要用的沙箱环境不在平台的注册表里 —— 它被下线了，或者页面上的信息已经过期。⚠️ 界面上没有这个开关，你改不了它：先刷新页面看看还在不在；仍然不在，就要请管理员到平台侧确认。原样重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '刷新后重新发起' }],
  },
  /**
   * ⚠️ 与 `lib/taskOutcome.ts` 里的同名码**不是重复**：那张表讲的是"任务跑到一半发现
   * Agent 没了"（任务终态），这里讲的是"创建请求在门口就被拒"。同一个事实、两个语境，
   * 各自的出路句子不同——合并会让其中一句在另一条路上说假话。
   */
  UNKNOWN_RUNTIME: {
    title: '❌ 平台没有登记这个 Agent',
    advice:
      '这个 Agent 不在平台的注册表里。常见于第三方模块带进来的 Agent：平台重启之后那个模块没有再加载。装回那个模块，或者改选注册表里还在的 Agent —— 选同一个重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '改选 Agent' }],
  },
  /**
   * 项目相关的两条与上面三条同为门口拒绝，但**出路不在这个面板里**——用户要去的是
   * 项目那一侧，而不是改这里的任何一个选项。所以 actions 给的是 `reconfigure`
   * 语义上的「去看项目」，不是「改配置」。
   */
  PROJECT_NOT_FOUND: {
    title: '❌ 找不到这个项目（多半已经被删了）',
    advice:
      '平台里查不到这个项目 —— 通常是它已经被删除，而页面上的项目列表还停在删除之前。刷新之后从现有项目里重新选一个。用同一个项目重来只会再被拒一次。',
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
    title: '❌ 这个项目现在还不能接任务',
    advice:
      '项目的代码还没准备好：要么还在克隆，要么克隆失败了。到项目页看它现在是哪一种 —— 还在克隆就等它完成；失败了就先重试克隆，或者把它改成空项目。在那之前，这个项目上发起任何任务都会被同样拒掉。',
    actions: [{ key: 'reconfigure', label: '去项目页查看状态' }],
  },
  /**
   * 分支不存在（随「建 Task 选分支」加入，10 §6.8 第七行）。
   *
   * 出路是**改选分支**而不是重试：分支列表读的是项目本地那份代码
   * （完整克隆之后不触网，03 §7.2★），所以"列表里有、门口说没有"只有两种可能——
   * 远端删了分支而本地还没同步，或者用户手填了一个不存在的名字。两者都不是重试能解决的。
   */
  BRANCH_NOT_FOUND: {
    title: '❌ 项目里没有这个分支',
    advice:
      '项目当前的代码里找不到这个分支 —— 可能远端已经删掉了它，而项目这边还停在同步之前。改选一个列表里有的分支；如果确信远端还有，先到项目上做一次[重新同步]再回来选。重来同一个分支名只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '改选分支' }],
  },
  /**
   * 能力位不匹配。**出路有两条**且指向相反的方向（换机器 / 降要求），文案不替用户选，
   * 只把两条都摆出来。
   *
   * ⚠️ 旧文案让用户「改选运行档位」—— 那个开关已经不存在了（选择权收回后端）。
   * 一条指向不存在的操作的提示，比不提示更贵：它让人在界面上找一个找不到的东西。
   */
  UNSUPPORTED_CAPABILITY: {
    title: '❌ 这台机器的沙箱环境做不了这次任务要的事',
    advice:
      '这次任务要用到快照或者无头运行，而这台机器上的沙箱环境不提供这一项。两条路：换一台能做这件事的机器，或者去掉这项要求、改发普通任务。两样都不改的话，重来只会再被同一道门拒一次。',
    actions: [{ key: 'reconfigure', label: '回去调整任务要求' }],
  },
  /**
   * ⭐ **全新部署会看到的第一条错误。**
   *
   * 镜像切片把建 Task 的门口改成「只接受注册过、已经锁定到具体某一版的镜像」（04 §7 时刻③），
   * 而全新部署的 `images` 表是空的。平台开机会尝试自动播种一张自带镜像
   * （`ImageSeeder`），但**离线部署 / registry 不可达时那次播种会失败且刻意不阻断启动**
   * —— 那时用户拿到的就是这条。
   *
   * ⚠️ **它与 `INVALID_IMAGE_REFERENCE` 是两个码，不能合并**：那条说的是「你写的地址
   * 本身不合法」，出路是改地址；这条说的是「地址没问题，但平台没有一张活的镜像在这个
   * 地址上」，出路是去镜像管理。门口原本硬写前者，于是什么都没填的新用户会被告知
   * 「你的镜像地址里有空白或控制字符」。
   *
   * 「尚未注册」与「所有版本都已停用」共用本码：两者的按钮是同一个（去镜像管理让某个
   * 版本变活），具体是哪一种由后端 message 说明，走 `detail` 小字。
   */
  IMAGE_NOT_REGISTERED: {
    title: '❌ 平台还没有一张能用的镜像',
    advice:
      '镜像地址本身没有问题。平台只跑注册过、并且已经锁定到具体某一版的镜像，而这个地址上现在没有一张是活的（还没注册，或者所有版本都被停用了）。到镜像管理注册一张，或者把某个停用的版本启用回来。',
    // 不给 [重试]：库里没有的东西，重试一万次也不会出现。
    actions: [{ key: 'reconfigure', label: '去镜像管理' }],
  },
  INVALID_IMAGE_REFERENCE: {
    title: '❌ 镜像地址里混进了空白或控制字符',
    advice:
      '这个地址里有空格、换行或者看不见的控制字符，平台不会把它拼进容器命令。检查一下是不是误粘了换行，改好再填。原样重来只会再被拒一次。',
    actions: [{ key: 'reconfigure', label: '检查镜像地址' }],
  },
  /**
   * ⭐ **两档镜像不可互换 —— 所以这条 ⛔ 不给 [重试]。**
   *
   * 它此前**根本不在这张表里**，于是掉进 `fallbackCopy`：标题「任务启动失败」＋一个裸
   * [重试]，而重试用的还是同一张镜像、同一台机器，必然再失败一次。这正是本文件上面那段
   * 注释（`BRANCH_NOT_FOUND` 那次）专门警告过的漏收形状，只是换了一个码。
   *
   * 出路只有一条：去镜像管理换一张为这台机器做的镜像。
   */
  IMAGE_PROVIDER_MISMATCH: {
    title: '❌ 这张镜像不是给这台机器的沙箱环境做的',
    advice:
      '两种沙箱环境的底座不是同一张镜像，互相换不了。重试用的还是同一张镜像、同一台机器，结果不会变 —— 到镜像管理换一张为这台机器做的镜像，再发起。',
    actions: [{ key: 'reconfigure', label: '去镜像管理换一张' }],
  },

  // —— 代码副本准备阶段（03 §7.6）。2026-08 之前这两个码**根本到不了这里** ——
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
    title: '❌ 磁盘空间不够，代码副本没能准备出来',
    advice:
      '平台要把项目当前的代码复制一份给这个任务用，而目标磁盘的剩余空间不够。先去清理磁盘再回来重试 —— 空间没变之前，重试多少次都是同一个结果。',
    // ⚠️ 不给裸 [重试]：后端 `retryable: false`（10 §6.8），因为原样重来必然同样失败。
    // 但"清理之后再重试"是真出路，所以按钮留着、**把前置条件写进 label**——
    // 让按钮自己说清它什么时候才有意义，而不是配一个会骗人的「重试」。
    actions: [{ key: 'retry', label: '清理磁盘后重试' }],
  },
  WORKSPACE_PREPARE_FAILED: {
    title: '❌ 代码副本没能准备出来（平台这边的问题）',
    advice:
      '平台在把项目当前的代码复制成这个任务的代码副本时出错了：权限、目录状态或者文件系统的问题。这一步发生在运行环境创建之前，所以没有留下任何容器。可以重试一次；反复失败就把这张卡上的诊断信息一起交给管理员。',
    actions: [RETRY, { key: 'reconfigure', label: '返回重新配置' }],
  },

  // —— 既有码（P22 §1 同表）——
  /**
   * ⚠️ 这条建议**只在「镜像地址是一个 tag」的今天成立**，而那正好要变。
   *
   * 镜像切片落地后拉取按锁定的那一版进行（04 §7 时刻④），于是多出一种今天**根本
   * 不存在**的失败：名字还在、还能解析，但锁定的那一版被上游删了/GC 了。
   * 那时「检查网络与镜像地址」是**错的**——地址完全正确，出路是去镜像管理点
   * [检查更新] 换到新版本。
   *
   * ⚠️ **不能靠拆这一条的文案来区分**：后端给的是同一个 `IMAGE_PULL_FAILED`，
   * 而本仓明令禁止从 message 散文里 parse 码（13 §2.1 `failure_code` 那行）。
   * 「用户该做什么」不同就该是**不同的码** —— 所以下面单列 `IMAGE_DIGEST_GONE`，
   * 而不是在这里加一句模棱两可的话去同时兼顾两种情况。
   */
  IMAGE_PULL_FAILED: {
    title: '❌ 没能把镜像拉下来（网络不通，或者镜像名写错了）',
    advice: '先确认平台这台机器能连上镜像仓库，再检查镜像地址有没有写错，然后重试。',
    actions: [RETRY, { key: 'reconfigure', label: '检查镜像地址' }],
  },
  /**
   * ⏳ **预登记文案：这个码今天不会到达**（镜像上下文整个不存在，10 §6.8「已定案、
   * 但今天没有产出方」子表）。写在这里不是提前量，是因为它落地那天**必须**已经在：
   * 落到 `fallbackCopy` 会给出 `[重试]`，而重试拉的还是那个已经不存在的版本 ——
   * 对一个"重试一万次也不会变"的失败说"再试一次"，正是 `DISK_INSUFFICIENT` 那条
   * 刚修过的错。
   *
   * ⚠️ 与 `IMAGE_PULL_FAILED` 是**两个码而不是两段文案**，理由见上一条。
   */
  IMAGE_DIGEST_GONE: {
    title: '❌ 这张镜像锁定的那一版，仓库里已经没有了',
    advice:
      '镜像地址没有写错。平台按注册时锁定的那一版去拉，而上游已经把那一版删掉或者回收了。改地址和重试都帮不上忙 —— 到镜像管理对这张镜像点[检查更新]，确认新版本之后再发起。',
    // 刻意不给 [重试]：拉的还是同一个已不存在的版本，重试只是把同一句话再说一遍。
    actions: [{ key: 'reconfigure', label: '去镜像管理检查更新' }],
  },
  // —— 镜像上下文（2026-08 落地）：本轮进 10 §6.8 主表的 11 个码里，**只有下面三个是顶层 `code`** ——
  //
  // 另外八个住在别处，**给它们配顶层文案是白配的**（F21-4 §8.3 把这条说死了：
  // 「码的归属决定它走哪条渲染路径，混在一张表里查会得到一个永不命中的分支，
  //  而这种分支不会让任何测试变红」）：
  //   · 四个 `ENV_*` + `IMAGE_TMUX_MISSING` + `IMAGE_ENTRYPOINT_INVALID`
  //     → `details[].code`（顶层分别是 `VALIDATION_FAILED` / `MANIFEST_INVALID`）；
  //     前端的消费点是 `lib/image/mapEnvErrorResponse.ts`（逐行红字）与 ❌ 档的 `errors[]` 列表。
  //   · `RUNTIME_NOT_PREINSTALLED` → `ValidationOutcome.warnings[].code`，**连 error 都不是**，
  //     它的落点是 ⚠️ 档卡片上的后果说明。
  //   · `IMAGE_DIGEST_GONE` 顶层，但**上一轮已经在表里**（见上），语义不动。
  // 下面的测试按这份归属逐条对，两个方向都钉：该在的必须在，不该在的必须不在。

  /**
   * ⚠️ **本条 2026-08 订正过，订正的是"它描述的根本不是这个码"。**
   *
   * 原文写的是「镜像未通过平台校验（如缺少 tmux 等必须项），请改用合格镜像」——那描述的是
   * **运行期**的 `IMAGE_CONTRACT_VIOLATION`（起会话前 `command -v tmux` 未命中 ⇒ 运行环境转 `failed`，
   * 走 WS），而不是**注册期**的 `MANIFEST_INVALID`(422)。10 §6.8 把这笔账记下了。
   *
   * 两个码**必须并存**（04 §7：注册期判定不免除运行期实测），所以两条文案要各说各的：
   * 一条说「这张镜像不许进库」，一条说「你的 Task 刚刚因此停了」。合并的后果很具体——
   * 注册弹窗上会出现「任务已停止」这种**根本没有运行环境**的措辞。
   *
   * ⚠️ 具体缺哪一项（`IMAGE_TMUX_MISSING` / `IMAGE_ENTRYPOINT_INVALID`）在 `details[]` 里逐条给，
   * **不在这句话里**：这里写死"缺少 tmux"就会在缺的是 entrypoint 时说错话。
   */
  MANIFEST_INVALID: {
    title: '❌ 这张镜像不满足平台要求，没有注册进来',
    advice:
      '平台在注册之前跑了一次校验，判定不通过，所以没有创建任何记录（不会留下一条半成品）。具体差在哪几条就列在上面的验证结果里；照着改镜像、或者换一张合格的，再点[验证]。',
    // 不给 [重试]：原样重来必然被同一道校验再拒一次（后端 `retryable:false`）。
    actions: [{ key: 'reconfigure', label: '查看镜像要求' }],
  },
  /**
   * `ImageSpecProvider.resolve()` 在 registry 里找不到这个镜像（404）。
   * 注册 / 预检 / 重验证**三个入口**都会走到它（04 §10.4 IS-02）。
   *
   * ⚠️ 与 `REGISTRY_UNREACHABLE` 是两个码而不是两段文案，理由与
   * `IMAGE_PULL_FAILED` / `IMAGE_DIGEST_GONE` 那一对完全相同：**用户该做的事不同**。
   * 这里是"名字/权限有问题，改地址"；那里是"网络有问题，等一下重试"。
   * 合成一条就只能写出"检查地址或稍后重试"这种两边都不落地的话。
   */
  REF_NOT_FOUND: {
    title: '❌ 镜像仓库里没有这个名字或这个版本',
    advice:
      '仓库能连上，但里面找不到它 —— 名字拼错了、版本被删了，或者这是个私有仓库而平台没有拉取凭证。重试帮不上忙：先确认名字与版本的拼写、以及这张镜像对平台可见，再重新验证。',
    actions: [{ key: 'reconfigure', label: '检查镜像地址' }],
  },
  /**
   * `resolve()` 出网失败（502）。⚠️ **本组唯一 `retryable:true` 的码**（10 §6.8 原话），
   * 因此也是这三条里**唯一该渲染 [重试]** 的一条。
   *
   * ⚠️ 别顺手把 [重试] 抄给上面两条：`MANIFEST_INVALID` 与 `REF_NOT_FOUND` 原样重来必然
   * 得到同一个结果，那个按钮只是把同一句话再说一遍——`DISK_INSUFFICIENT` 刚修过同一个错。
   */
  REGISTRY_UNREACHABLE: {
    title: '🔴 连不上镜像仓库',
    advice:
      '平台没能确认这个地址对应的是哪一版镜像：仓库现在够不着（网络、DNS、代理，或者仓库自己在抖）。这一步发生在创建之前，所以这次没有留下任何东西。稍后重试一次；一直失败就检查平台这台机器到这个仓库通不通。',
    actions: [RETRY, { key: 'reconfigure', label: '检查镜像地址' }],
  },
  RESOURCE_EXHAUSTED: {
    title: '❌ 同时在跑的任务太多，资源不够了',
    advice: '停掉几个不用的任务把资源让出来，或者过一会儿再试。',
    actions: [
      { key: 'retry', label: '稍后重试' },
      { key: 'reconfigure', label: '返回任务列表' },
    ],
  },
  /**
   * ⚠️ **这里的"运行时"指的是容器运行时，与 Agent 同名不同物** —— 旧标题写「运行时无响应」，
   * 而同一屏上「运行时」还被用来指 Agent，是全屏最容易误读的一处。改成「容器服务」。
   *
   * ⚠️ 旧标题还带着问号（「容器服务未启动？」），把猜测当结论摆在标题上。
   * 标题只陈述平台确实知道的那件事（连不上），把"去查什么"放进 advice 并点名到具体的东西。
   */
  PROVIDER_UNAVAILABLE: {
    title: '🔴 容器服务没有响应',
    advice:
      '平台连不上这台机器上的容器服务。先确认 Docker Desktop 或 OrbStack 这类容器服务已经在运行，起来之后再重试。',
    actions: [RETRY],
  },
  /**
   * ⚠️ **超时 ≠ 不可达**：这里只知道"在限定时间内没做完"，不知道对面到底通不通。
   * 文案不许把前者说成后者。
   */
  TIMEOUT: {
    title: '⏱️ 这一步等太久，平台先停下了',
    advice:
      '超时只说明这次在限定时间内没做完，不等于对面连不上。可以重试；一直超时就看看容器服务是不是负载过高。',
    actions: [RETRY],
  },
  INVALID_STATE: {
    title: '⚠️ 现在的状态不允许做这件事',
    advice: '这个任务的状态在你操作之前已经变了。刷新一下，按新的状态再操作。',
    actions: [{ key: 'retry', label: '刷新重试' }],
  },
};

/**
 * 「零副作用」＝后端**显式声明**"这次请求什么都没改变"（`ErrorEnvelope.sideEffectFree`）。
 *
 * ⚠️ 这是本文件最要紧的一条区分：能力静态校验、未知沙箱环境 / 未知 Agent、非法镜像引用
 * 这些**门口拒绝**发生在解析项目 / 创建记录 / 进调度之前（10 §6.1 / 04 §5），前端**拿不到
 * sandbox id、列表里也不会留下 failed 记录** ⇒ 它们**不能**走"创建失败可重试"的失败卡路径
 *（那条路径预设"已创建、中途失败"，会渲染出一个并不存在的任务）。
 * 正确呈现：**就地**在新建入口提示改配置，用户改完再点创建。
 * 对照：`INSTALL_FAILED` 是已创建、`starting` 中途失败 ⇒ 走正常失败态。
 *
 * ── 为什么读字段，而不是从 HTTP 码反推 ──────────────────────────────────────────
 * 旧判据是 `httpStatus === 409 && code === 'UNSUPPORTED_CAPABILITY'`。而零副作用的门口拒绝
 * 一共七条，其中只有它是 409：未知沙箱环境 / 未知 Agent / 非法镜像引用是 400，
 * `PROJECT_NOT_FOUND` 是 404、`PROJECT_NOT_READY` 是 409 但码不同 ⇒ 除能力校验外的其余各条
 * **一直**被渲染成"创建失败，可重试"，而它们什么都没创建。这个洞不是哪个新码带来的，
 * 是"从状态码反推语义"这个做法本身带来的。`retryable` 的契约注释早就写着同一条纪律
 *（"the frontend renders [retry] off it, **not off the HTTP status code**"），
 * `sideEffectFree` 是它的同族：**语义由后端声明，前端不猜**。
 *
 * ── 缺席 ＝ 未表态，按「**可能**有副作用」读 ─────────────────────────────────────
 * 字段是 optional 的。缺席时返回 `false`（走失败卡）而不是 `true`，方向是刻意选的：
 * 后端漏标一处，用户只是**退化回今天的样子**（多一张可重试的失败卡，顶多白点一次重试）；
 * 反过来把缺席当成零副作用，就会在一个**真的建了半截**的任务上告诉用户"本次请求未创建任何
 * 任务"——那是在说假话，而且是会让人放心走开、事后才发现有个僵尸任务的那种假话。
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
 *     的是终态表那句"…**本轮无法继续**…重跑同一个 Agent 只会再失败一次"——而实际上
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
  /** 后端 message 为空时的兜底原因。**不提能力位**——门口拒绝里只有一条与能力有关。 */
  fallbackReason: string;
  /** 收尾：出路 ＋ "这次什么都没发生"在**本语境**里的说法。绝不含"重试/重新创建"。 */
  tail: string;
}

const ZERO_SIDE_EFFECT_PHRASING = {
  create: {
    lead: '无法用当前配置创建',
    fallbackReason: '当前配置不被平台接受',
    // 「调整配置」而不是「改选沙箱环境或调整能力要求」：后者是能力校验专属措辞，
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

/**
 * 未收录码的兜底：仍给人话 + 一个可点动作（P22 §1 禁止裸抛错误码）。
 *
 * ⚠️ **标题必须是中性的**：`describeSandboxError` 不只服务任务发起卡，镜像管理页也在复用它
 * （注册 / 预检 / 重验证三个入口的顶层码都走这张表）。写死「任务启动失败」的话，
 * 一个从未涉及任何任务的镜像注册弹窗上会冒出"任务启动失败"——说的是一件没发生过的事。
 */
function fallbackCopy(code: string, message?: string): SandboxErrorCopy {
  return {
    code,
    title: '❌ 操作没有完成',
    advice:
      message !== undefined && message !== ''
        ? message
        : '未能获取具体原因，可以重试一次；若持续失败请查看系统状态。',
    actions: [RETRY, { key: 'reconfigure', label: '返回重新配置' }],
  };
}

/**
 * 任务**已停止**（非失败）时的呈现——与失败区分，不出红字错误码。
 *
 * ⚠️ 两条纪律落在这两句话里：
 *   · P21-1 §9「界面上永不出现 sandbox / 容器 措辞」⇒ 说「任务」，不说「沙箱」；
 *   · **「回收后重启」不是「断线重连」**：新发起的是全新一轮，从头开始，
 *     ⛔ 不许暗示它会接上上次的进度。这一句必须明写，否则用户会当成"继续"。
 */
export const SANDBOX_ENDED_COPY: SandboxErrorCopy = {
  code: 'ENDED',
  title: '任务已停止',
  advice:
    '这个任务的运行环境已经回收了。可以再发起一个 —— 那是全新的一轮，从头开始，不会接着上次的进度。',
  actions: [{ key: 'reconfigure', label: '发起新任务' }],
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
