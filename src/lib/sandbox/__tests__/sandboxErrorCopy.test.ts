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
