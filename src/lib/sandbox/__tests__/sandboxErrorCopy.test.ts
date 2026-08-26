import { describe, it, expect } from 'vitest';
import {
  describeSandboxError,
  isZeroSideEffectRejection,
  zeroSideEffectRejectionMessage,
  SANDBOX_ENDED_COPY,
} from '@/lib/sandbox/sandboxErrorCopy';
// 信封形状取生成物（同被测文件），后端改字段 ⇒ 这里编译期就红。
import type { components } from '@/types/generated/openapi';

type ErrorEnvelope = components['schemas']['ErrorEnvelope'];

/** 错误信封替身。`sideEffectFree` **默认不给** —— 缺席是真实路径，不是异常路径。 */
function env(overrides: Partial<ErrorEnvelope> & Pick<ErrorEnvelope, 'code'>): ErrorEnvelope {
  return { message: '', retryable: false, ...overrides };
}

describe('错误码 → 人话 + 可操作建议（P22 §1）', () => {
  it('每条已知码都同时给「发生了什么」和「现在能做什么」（禁止裸抛错误码）', () => {
    for (const code of [
      'INSTALL_FAILED',
      'IMAGE_CONTRACT_VIOLATION',
      'IMAGE_PULL_FAILED',
      'MANIFEST_INVALID',
      'RESOURCE_EXHAUSTED',
      'PROVIDER_UNAVAILABLE',
      'TIMEOUT',
      'INVALID_STATE',
      'UNKNOWN_PROVIDER',
      'UNKNOWN_RUNTIME',
      'INVALID_IMAGE_REFERENCE',
    ]) {
      const copy = describeSandboxError({ code });
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.advice.length).toBeGreaterThan(0);
      expect(copy.actions.length).toBeGreaterThan(0);
      // 人话面里不出现裸错误码。
      expect(copy.title).not.toContain(code);
    }
  });

  it('INSTALL_FAILED：已落库、中途失败 → **给 [重试]** + 换预装镜像的建议', () => {
    const copy = describeSandboxError({ code: 'INSTALL_FAILED' });
    expect(copy.title).toContain('运行时 CLI 安装失败');
    expect(copy.actions.map((a) => a.key)).toContain('retry');
    expect(copy.actions.some((a) => a.label.includes('镜像'))).toBe(true);
  });

  it('IMAGE_CONTRACT_VIOLATION：缺 tmux → **不给 [重试]**（重试不会改变镜像内容）', () => {
    const copy = describeSandboxError({ code: 'IMAGE_CONTRACT_VIOLATION' });
    expect(copy.title).toContain('缺少 tmux');
    expect(copy.actions.map((a) => a.key)).not.toContain('retry');
    expect(copy.actions).toHaveLength(1);
    expect(copy.actions[0]?.label).toContain('换一张含 tmux 的镜像');
  });

  /**
   * ★ 工作区准备的两个码 —— 后端 2026-08 才真正开始产出它们。
   *
   * 在那之前 `prepare()` 抛的是 Node 的 errno（`ENOSPC` / `EACCES`），后端原样当平台码
   * 用，于是这两条**从来没有到达过这张表**，全部落进 `fallbackCopy`。后端把码归一进闭集
   * 之后，如果这里不补句子，用户看到的**仍然是那段兜底话**——码修准了、话没变，
   * 等于没修。这是 `BRANCH_NOT_FOUND` 那次「两侧各自完整、合起来漏一条」的同一种形状。
   *
   * MUTATION: 删掉 COPY_TABLE 里的 `DISK_INSUFFICIENT` ⇒ 下面第一条红（落回兜底的
   * 「未能获取具体原因」，并带上一个裸 [重试]）。
   */
  it('DISK_INSUFFICIENT：说清要先清理磁盘，且**没有裸 [重试]**（空间没变，重试必然同样失败）', () => {
    const copy = describeSandboxError({ code: 'DISK_INSUFFICIENT' });
    expect(copy.title).toContain('磁盘');
    expect(copy.advice).toContain('清理');
    // 落回兜底的特征串——出现它就说明这条码根本没进表。
    expect(copy.advice).not.toContain('未能获取具体原因');
    // 按钮可以是"清理后重试"，但绝不能是一个什么前提都不说的裸「重试」。
    expect(copy.actions.length).toBeGreaterThan(0);
    expect(copy.actions.some((a) => a.label === '重试')).toBe(false);
  });

  it('WORKSPACE_PREPARE_FAILED：平台侧故障 → 给 [重试]，并指向 traceId 报障', () => {
    const copy = describeSandboxError({ code: 'WORKSPACE_PREPARE_FAILED' });
    expect(copy.title).toContain('工作区');
    expect(copy.advice).not.toContain('未能获取具体原因');
    expect(copy.advice).toContain('traceId');
    expect(copy.actions.some((a) => a.key === 'retry')).toBe(true);
  });

  it('⚠️ errno 不该出现在这张表里 —— 它们是后端要归一掉的东西，不是前端要认的码', () => {
    // 若哪天有人"顺手"给 ENOSPC 补一条文案，那等于承认 errno 会出线，
    // 正好把后端刚收口的那道闭集又捅开一个洞。这里钉住：它只能是未知码。
    const copy = describeSandboxError({ code: 'ENOSPC' });
    expect(copy.advice).toContain('未能获取具体原因');
  });

  /**
   * ★ 钉定 digest 带来的新失败档 —— 它是**钉住 digest 换来的**，今天不存在。
   *
   * 今天镜像坐标是 tag，拉取永远能拉到"某个东西"；镜像切片落地后按 `ref@digest` 拉
   * （04 §7 时刻④），上游把那个 digest GC 掉之后就会出现「tag 还在、版本没了」。
   *
   * ⚠️ 关键在于**两个码给的出路必须不同**，否则单开一个码毫无意义：
   * `IMAGE_PULL_FAILED` 让用户去查地址和网络；`IMAGE_DIGEST_GONE` 明说地址没错、
   * 改地址和重试都没用，出路是 [检查更新]。下面第三条就是钉这个"不同"。
   *
   * MUTATION: 删掉 `IMAGE_DIGEST_GONE` 条目 ⇒ 它落到 `fallbackCopy`，带回一个
   * `[重试]` —— 对着一个"重试一万次也不会变"的失败说"再试一次"，第一条当场红。
   */
  it('IMAGE_DIGEST_GONE：明说地址没错，且**不给 [重试]**（重试拉的还是那个已不存在的 digest）', () => {
    const copy = describeSandboxError({ code: 'IMAGE_DIGEST_GONE' });
    expect(copy.advice).not.toContain('未能获取具体原因'); // 没落到兜底
    expect(copy.actions.some((a) => a.key === 'retry')).toBe(false);
    expect(copy.advice).toContain('检查更新');
  });

  it('两个镜像拉取失败码给的是**不同的出路** —— 否则不必是两个码', () => {
    const pull = describeSandboxError({ code: 'IMAGE_PULL_FAILED' });
    const gone = describeSandboxError({ code: 'IMAGE_DIGEST_GONE' });
    // `IMAGE_PULL_FAILED` 今天的建议仍然成立（tag 坐标下"查地址/查网络"是对的），
    // 这一条同时钉住"不要顺手把它改成模棱两可的话去兼顾两种情况"。
    expect(pull.actions.some((a) => a.key === 'retry')).toBe(true);
    expect(gone.actions.some((a) => a.key === 'retry')).toBe(false);
    expect(pull.advice).not.toBe(gone.advice);
  });

  /**
   * ⭐ 全新部署的第一条错误 —— 它必须与 `INVALID_IMAGE_REFERENCE` **说不同的话**。
   *
   * 门口曾经把两种情况合并成后者，于是「一张镜像都没注册」被说成「你的镜像地址里有
   * 空白或控制字符」。第二条断言就是钉这个区分：合并回一个码，两句话会变成同一句。
   *
   * MUTATION: 删掉 `IMAGE_NOT_REGISTERED` 条目 ⇒ 落回兜底并带出 [重试]，两条都红。
   */
  it('IMAGE_NOT_REGISTERED：指向镜像管理，且**不给 [重试]**（库里没有的东西重试不会出现）', () => {
    const copy = describeSandboxError({ code: 'IMAGE_NOT_REGISTERED' });
    expect(copy.advice).not.toContain('未能获取具体原因');
    expect(copy.advice).toContain('镜像管理');
    expect(copy.actions.some((a) => a.key === 'retry')).toBe(false);
  });

  it('它与 INVALID_IMAGE_REFERENCE 给的是不同的出路 —— 否则不必是两个码', () => {
    const notRegistered = describeSandboxError({ code: 'IMAGE_NOT_REGISTERED' });
    const badRef = describeSandboxError({ code: 'INVALID_IMAGE_REFERENCE' });
    expect(notRegistered.advice).not.toBe(badRef.advice);
    // 「地址不合法」那条谈的是字符；「没有可用镜像」那条不该提字符——用户什么都没填。
    expect(badRef.advice).toContain('控制字符');
    expect(notRegistered.advice).not.toContain('控制字符');
  });

  it('未知码 / 无码：仍给人话 + 可点动作（异步失败拿不到码时的兜底）', () => {
    const unknown = describeSandboxError({ code: 'WHATEVER' });
    expect(unknown.actions.length).toBeGreaterThan(0);
    const noCode = describeSandboxError({});
    expect(noCode.code).toBe('UNKNOWN');
    expect(noCode.actions.length).toBeGreaterThan(0);
  });

  it('ended 与 failed 分开：结束态不复用失败文案', () => {
    expect(SANDBOX_ENDED_COPY.title).not.toContain('❌');
    expect(SANDBOX_ENDED_COPY.actions.map((a) => a.key)).toEqual(['reconfigure']);
  });
});

/**
 * 后端在 `create` 门口做的**零副作用**拒绝，**七条**（04 §5 / 10 §6.8）。
 * 状态码一栏是真实值，**刻意留在 fixture 里**：它是"判据不看状态码"这件事的证物——
 * 七条散在 400/404/409 三个码上，任何"从状态码反推"的写法都必然漏掉其中一部分。
 *
 * ⚠️ **这张名单与 10 §6.8 的表必须同步**。真发生过一次：`BRANCH_NOT_FOUND` 随
 * 「建 Task 选分支」进了文档的表，而这里停在六条 —— 两侧各自都"完整"，
 * 合起来漏了一条，29 条测试照样全绿。漏掉的那条会掉进 `fallbackCopy`，
 * **恰恰带着 [重试]**，对零副作用拒绝说了最不该说的那句话。
 */
const ZERO_SIDE_EFFECT_REJECTIONS = [
  { code: 'UNKNOWN_PROVIDER', httpStatus: 400, message: "unknown provider 'nope'" },
  { code: 'UNKNOWN_RUNTIME', httpStatus: 400, message: "unknown runtime 'shell'" },
  { code: 'INVALID_IMAGE_REFERENCE', httpStatus: 400, message: "invalid image reference 'a b'" },
  { code: 'UNSUPPORTED_CAPABILITY', httpStatus: 409, message: 'provider boxlite 不支持 snapshot' },
  { code: 'PROJECT_NOT_FOUND', httpStatus: 404, message: 'project proj-9 not found' },
  { code: 'PROJECT_NOT_READY', httpStatus: 409, message: "project proj-1 is 'cloning'" },
  { code: 'BRANCH_NOT_FOUND', httpStatus: 400, message: "project p has no branch 'x'" },
] as const;

describe('零副作用拒绝（后端显式声明 sideEffectFree）≠ 创建失败可重试', () => {
  it('七条门口拒绝**全部**认出来（判据读字段，不读 HTTP 状态码）', () => {
    for (const rejection of ZERO_SIDE_EFFECT_REJECTIONS) {
      expect(
        isZeroSideEffectRejection(
          env({ code: rejection.code, message: rejection.message, sideEffectFree: true }),
        ),
      ).toBe(true);
    }
    // 判据不看状态码这件事的证物：七条散在三个状态码上，只有两条是 409。
    // 旧写法 `httpStatus === 409 && code === 'UNSUPPORTED_CAPABILITY'` 只认得其中一条。
    const statuses = new Set(ZERO_SIDE_EFFECT_REJECTIONS.map((r) => r.httpStatus));
    expect([...statuses].sort((a, b) => a - b)).toEqual([400, 404, 409]);
    expect(ZERO_SIDE_EFFECT_REJECTIONS.filter((r) => r.httpStatus === 409)).toHaveLength(2);
  });

  /**
   * ★ 结构性防线：**每一条门口拒绝都必须在 COPY_TABLE 里有自己的文案**。
   *
   * 上面那条用例只验"认得出它是零副作用"，认得出之后仍可能没有文案 ——
   * `BRANCH_NOT_FOUND` 就是这么漏的：`isZeroSideEffectRejection` 读的是
   * `sideEffectFree` 字段（与码无关，所以它一直是对的），而 `COPY_TABLE` 是按码查表，
   * 少一条就掉进带 [重试] 的 `fallbackCopy`。两件事，两条用例。
   *
   * MUTATION：把 `BRANCH_NOT_FOUND` 从 `COPY_TABLE` 删掉 ⇒ 本条红
   *（而上面那条仍然绿 —— 这正是需要两条用例的原因）。
   */
  it('每一条门口拒绝都有自己的文案，且**都不给 [重试]**', () => {
    for (const rejection of ZERO_SIDE_EFFECT_REJECTIONS) {
      const copy = describeSandboxError(
        env({ code: rejection.code, message: rejection.message, sideEffectFree: true }),
      );
      // 掉进 fallback 的特征就是带上了 retry —— 门口拒绝一律不该有它。
      expect(
        copy.actions.map((a) => a.key),
        `${rejection.code} 掉进了 fallbackCopy（带 [重试]），说明 COPY_TABLE 里没有它`,
      ).not.toContain('retry');
      // 文案得是为这条码写的，不是兜底那段。
      expect(copy.title).not.toMatch(/任务启动失败/);
    }
  });

  it('也不认码白名单：前端没见过的新门口拒绝码，只要后端标了就算数', () => {
    // 后端随时会加新的门口检查（04 §5 是个开放的段落）。前端维护一份码名单 = 每加一条就漏一条，
    // 而漏掉的表现恰恰是"告诉用户创建失败了"——最不该出错的那个方向。
    expect(
      isZeroSideEffectRejection(env({ code: 'SOME_FUTURE_DOOR_CHECK', sideEffectFree: true })),
    ).toBe(true);
  });

  it('⚠️ 缺席 = 后端未表态 ⇒ 按**可能有副作用**读（漏标只退化成现状，不误报"什么都没发生"）', () => {
    // 这一条是保守读法的锚点：形状与旧判据唯一认得的那条**完全一致**（能力码 + 409），
    // 差别只在后端没标。旧写法在这里返回 true，新写法必须返回 false。
    expect(isZeroSideEffectRejection(env({ code: 'UNSUPPORTED_CAPABILITY' }))).toBe(false);
    // 显式表态"有副作用"同样不算——`=== true` 而不是真值判断。
    expect(
      isZeroSideEffectRejection(env({ code: 'UNSUPPORTED_CAPABILITY', sideEffectFree: false })),
    ).toBe(false);
  });

  it('已落库、中途失败的码绝不会被当成零副作用', () => {
    expect(isZeroSideEffectRejection(env({ code: 'INSTALL_FAILED' }))).toBe(false);
    expect(isZeroSideEffectRejection(env({ code: 'INVALID_STATE' }))).toBe(false);
    // 就算后端在一个"已落库"的码上误标，判据也只负责转述后端的声明——
    // 这里不做二次猜测（做了就又是一份前端自己的码名单）。
    expect(isZeroSideEffectRejection(env({ code: 'INSTALL_FAILED', sideEffectFree: true }))).toBe(
      true,
    );
  });

  it('就地提示明说"未创建任何任务"，且不含任何重试语义', () => {
    const msg = zeroSideEffectRejectionMessage(
      { message: 'provider boxlite 不支持 snapshot' },
      'create',
    );
    expect(msg).toContain('provider boxlite 不支持 snapshot'); // 后端那句具体的话要透出来
    expect(msg).toContain('未创建任何任务');
    expect(msg).toContain('调整配置');
    for (const banned of ['重试', '重新创建', '再来一次']) {
      expect(msg).not.toContain(banned);
    }
  });

  it('措辞不再是能力校验专属：message 为空时的兜底也不替另外五条说错话', () => {
    const msg = zeroSideEffectRejectionMessage({ message: '' }, 'create');
    expect(msg).toContain('未创建任何任务');
    // 六条里只有 UNSUPPORTED_CAPABILITY 与能力位有关；旧兜底句"请改选运行档位或调整能力要求"
    // 对"非法镜像引用"是错的——用户要改的是镜像地址，不是能力要求。
    expect(msg).not.toContain('能力');
    expect(msg).not.toContain('运行档位');
  });

  it('后端漏标时的**降级**路径：门口拒绝码在失败卡上也有人话，且不劝重试', () => {
    // 走到这里就意味着后端没标 ⇒ 前端不确定有没有落库 ⇒ 只能出失败卡。
    // 但失败卡至少不该劝用户"重试一次"：后端一律 retryable:false，原样重来必被同一道门再拒。
    //
    // ⚠️ 遍历的是**上面那份门口拒绝名单本身**，不是另抄一份码数组：抄一份的话，
    // 名单里加了第七条而这里忘了跟，测试照样全绿——而漏掉的那条会掉进 fallbackCopy，
    // 恰恰带着 [重试]。让两处共用一个来源，"漏收文案"才会以红色的形式出现。
    for (const { code } of ZERO_SIDE_EFFECT_REJECTIONS) {
      const copy = describeSandboxError({ code });
      expect(copy.code).toBe(code);
      expect(copy.actions.map((a) => a.key)).not.toContain('retry');
      expect(copy.actions.length).toBeGreaterThan(0);
      // 兜底文案（'❌ 任务启动失败 / 可以重试一次'）是**没收录**的表现，这几条必须已收录。
      expect(copy.title).not.toBe('❌ 任务启动失败');
    }
  });

  it('降级文案不替后端承诺"什么都没创建"——那句话只属于标了 sideEffectFree 的那条路', () => {
    // 落到 COPY_TABLE ⇔ 后端没标 ⇔ 前端**不知道**有没有落库。此时写"未创建任何任务"
    // 就是在用户看不见的地方猜一个它无从知道的事实，猜错的方向恰好最伤（用户以为没建，
    // 于是又建一个）。就地提示那条路有后端的显式声明撑着，才敢说那句话。
    for (const { code } of ZERO_SIDE_EFFECT_REJECTIONS) {
      const { title, advice } = describeSandboxError({ code });
      for (const banned of ['未创建', '没有创建', '什么都没']) {
        expect(`${title}${advice}`).not.toContain(banned);
      }
    }
  });
});

/**
 * ★ **镜像上下文本轮进 10 §6.8 主表的 11 个码：谁该有顶层文案，谁不该有。**
 *
 * 这不是"补齐文案"那么简单——**配错地方的文案永远不命中，而不命中不会让任何测试变红**
 *（F21-4 §8.3）。所以两个方向都要钉：
 *   · 顶层 `code` 的那三个（`REF_NOT_FOUND` / `REGISTRY_UNREACHABLE` / `MANIFEST_INVALID`）
 *     **必须**在表里，否则掉进 `fallbackCopy`，带回一个对它们全错的 [重试]；
 *   · 只活在 `details[].code` / `warnings[].code` 里的那八个**必须不在**表里——
 *     给它们配顶层文案是白配，还会让下一个人以为顶层查表这条路能拿到它们。
 *
 * `IMAGE_DIGEST_GONE` 也是顶层码，但上一轮就在表里了，语义本轮不动（另有用例守着）。
 */
describe('镜像错误码：顶层的配文案，details[]/warnings[] 里的一律不配（10 §6.8 / F21-4 §8.3）', () => {
  /** 顶层 `code` —— 前端按 `envelope.code` 查表能查到的那些。 */
  const TOP_LEVEL_IMAGE_CODES = ['REF_NOT_FOUND', 'REGISTRY_UNREACHABLE', 'MANIFEST_INVALID'];

  /**
   * **不是顶层码**的八个，连同它们真正住的地方。
   * 拿它们去 `describeSandboxError` 查，正确结果是**查不到**（走兜底）。
   */
  const NON_TOP_LEVEL_IMAGE_CODES = [
    { code: 'IMAGE_TMUX_MISSING', livesIn: 'details[].code（顶层 MANIFEST_INVALID）' },
    { code: 'IMAGE_ENTRYPOINT_INVALID', livesIn: 'details[].code（顶层 MANIFEST_INVALID）' },
    { code: 'ENV_NAME_INVALID', livesIn: 'details[].code（顶层 VALIDATION_FAILED）' },
    { code: 'ENV_NAME_RESERVED', livesIn: 'details[].code（顶层 VALIDATION_FAILED）' },
    { code: 'ENV_LIMIT_EXCEEDED', livesIn: 'details[].code（顶层 VALIDATION_FAILED）' },
    { code: 'ENV_DUPLICATE_KEY', livesIn: 'details[].code（顶层 VALIDATION_FAILED）' },
    { code: 'RUNTIME_NOT_PREINSTALLED', livesIn: 'ValidationOutcome.warnings[].code' },
  ];

  it('三个顶层镜像码都有自己的文案（掉进兜底就说明漏收了）', () => {
    for (const code of TOP_LEVEL_IMAGE_CODES) {
      const copy = describeSandboxError({ code });
      expect(copy.advice, `${code} 掉进了 fallbackCopy`).not.toContain('未能获取具体原因');
      expect(copy.title).not.toBe('❌ 任务启动失败');
      expect(copy.actions.length).toBeGreaterThan(0);
      expect(copy.title).not.toContain(code);
    }
  });

  /**
   * MUTATION：给 `ENV_DUPLICATE_KEY` 在 `COPY_TABLE` 里加一条"看起来很合理"的顶层文案
   * ⇒ 本条红。而在没有这条用例时，那条白配的文案**永远不会被任何路径读到**，
   * 也永远不会有测试变红——它只会让下一个人相信顶层查表能拿到 `ENV_*`。
   */
  it('八个非顶层码**都不在**顶层文案表里（配了也永远查不到）', () => {
    for (const { code, livesIn } of NON_TOP_LEVEL_IMAGE_CODES) {
      const copy = describeSandboxError({ code });
      expect(copy.advice, `${code} 住在 ${livesIn}，不该有顶层文案`).toContain('未能获取具体原因');
    }
  });

  /**
   * `REGISTRY_UNREACHABLE` 是这一组里**唯一** `retryable:true` 的码（10 §6.8 原话），
   * 于是也是唯一该给 [重试] 的。另外两条原样重来必然被同一道门再拒一次。
   */
  it('只有 REGISTRY_UNREACHABLE 给 [重试]，另外两条不给', () => {
    expect(
      describeSandboxError({ code: 'REGISTRY_UNREACHABLE' }).actions.some((a) => a.key === 'retry'),
    ).toBe(true);
    expect(
      describeSandboxError({ code: 'REF_NOT_FOUND' }).actions.some((a) => a.key === 'retry'),
    ).toBe(false);
    expect(
      describeSandboxError({ code: 'MANIFEST_INVALID' }).actions.some((a) => a.key === 'retry'),
    ).toBe(false);
  });

  /**
   * ★ **订正回归**：`MANIFEST_INVALID` 的旧文案描述的是**运行期**的 `IMAGE_CONTRACT_VIOLATION`
   *（「缺少 tmux 等必须项」＝起会话前实测失败），而它自己是**注册期** 422。
   * 10 §6.8 记着这笔账。两个码必须并存、两句话必须各说各的。
   *
   * MUTATION：把 `MANIFEST_INVALID` 的 advice 改回「该镜像未通过平台校验（如缺少 tmux 等必须项）」
   * ⇒ 第一条断言红（它又开始替运行期那个码说话了）。
   */
  it('MANIFEST_INVALID 说的是**注册期不许进库**，不是运行期"任务停了"', () => {
    const registerTime = describeSandboxError({ code: 'MANIFEST_INVALID' });
    const runTime = describeSandboxError({ code: 'IMAGE_CONTRACT_VIOLATION' });

    // 注册期这条不许写死"缺少 tmux"——缺的可能是 entrypoint，具体原因在 details[] 里逐条给。
    expect(registerTime.advice).not.toContain('tmux');
    // 也不许出现"任务/实例已停止"这类措辞：注册页上根本没有实例。
    for (const banned of ['任务', '实例', '停止']) {
      expect(`${registerTime.title}${registerTime.advice}`).not.toContain(banned);
    }
    // 它要说清的是"什么都没落库"（后端 24 §7.2「invalid 不落库」）。
    expect(registerTime.advice).toContain('落库');

    // 运行期那条反过来：它必须说"任务停了"，且仍然点名 tmux（实测缺的就是它）。
    expect(runTime.title).toContain('tmux');
    expect(runTime.title).toContain('任务已停止');
    // 两条文案不许是同一句——那正是"合并成一段话"之后的样子。
    expect(registerTime.advice).not.toBe(runTime.advice);
  });
});
