// WS 帧形状的**自洽**门禁：`WS_PROTOCOL_CANONICAL` 这段字面量必须和本文件里的 zod schema
// 逐帧逐字段一致。
//
// 它和主仓 `scripts/docs-check.mjs` 的 B4 是一对：
//   · B4      —— api 字面量 == web 字面量（跨仓逐字节）
//   · 本文件  —— web 字面量 == web zod schema（从 schema 反推再比对）
// 两条合起来，传递地钉住「api 声明的帧形状 == web 运行时真正校验的帧形状」。
//
// 为什么非要反推而不是手写几条 `toContain`：手写断言只能证明"我记得检查过这几条"，
// 反推证明的是"每一条、每一个字段、每一个可选标记都对得上"。WS 面没有 codegen，
// 这是唯一能替代它的东西。
import { describe, it, expect } from 'vitest';
import {
  SandboxEventSchema,
  TaskClientFrameSchema,
  TaskServerFrameSchema,
  TerminalClientFrameSchema,
  TerminalServerFrameSchema,
  WS_PROTOCOL_CANONICAL,
} from '@/types/ws-protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 从一个 `z.discriminatedUnion(判别键, [z.object(...)])` 反推出 canonical 里的那一段。
 * 规则与 api 侧的写法一致：`帧名{字段,可选字段?}`，判别键本身不列（它就是帧名），
 * 无字段的帧不带花括号（`ping` / `pong`）。
 */
function describeUnion(discriminator: string, schema: unknown): string {
  if (!isRecord(schema)) throw new Error('不是 zod schema');
  const options: unknown = schema['options'];
  if (!Array.isArray(options)) throw new Error('不是 discriminatedUnion');

  return options
    .map((option: unknown) => {
      if (!isRecord(option)) throw new Error('union 成员不是 zod object');
      const shape: unknown = option['shape'];
      if (!isRecord(shape)) throw new Error('union 成员没有 shape');

      const tag: unknown = shape[discriminator];
      if (!isRecord(tag) || typeof tag['value'] !== 'string') {
        throw new Error(`判别键 ${discriminator} 不是字面量`);
      }
      const name: string = tag['value'];

      const fields = Object.keys(shape)
        .filter((key) => key !== discriminator)
        .map((key) => {
          const field: unknown = shape[key];
          if (!isRecord(field) || typeof field['safeParse'] !== 'function') {
            throw new Error(`字段 ${key} 不是 zod schema`);
          }
          // 「可选」= 这个字段自己接受 undefined。比翻 zod 内部的 typeName 稳。
          const optional = acceptsUndefined(field);
          // ⚠️ **数组元素是对象时要把元素形状也写出来**（`name[f1,f2?]`）。
          //    否则 `shells: string[]` 与 `shells: {shellId,runtimeId?}[]` 在 canonical
          //    里长得一模一样 —— 而那正是跨仓对账（docs:check B4）唯一能看见的东西，
          //    元素形状漂了它一声不吭。2026-09 加 `runtimeId?` 时就撞上了这一点。
          const inner = describeArrayElement(field);
          const name = inner === null ? key : `${key}[${inner}]`;
          return optional ? `${name}?` : name;
        });

      return fields.length === 0 ? name : `${name}{${fields.join(',')}}`;
    })
    .join(',');
}

/**
 * 字段是「（可空的）对象数组」时，返回元素的字段串；否则 `null`。
 *
 * 只认这一种嵌套是刻意的：canonical 是一份**给人对账用**的扁平描述，不是第二套 schema。
 * 今天只有 `shells` 一个字段需要它，多认一层就够，⛔ 不要把它做成通用序列化器。
 */
function describeArrayElement(field: Record<string, unknown>): string | null {
  let node: unknown = field;
  // `.nullable()` / `.optional()` 包了一层就先剥掉
  for (let depth = 0; depth < 4; depth += 1) {
    const unwrap = isRecord(node) ? node['unwrap'] : undefined;
    if (typeof unwrap !== 'function') break;
    node = unwrap.call(node);
  }
  if (!isRecord(node)) return null;
  const element: unknown = node['element'];
  if (!isRecord(element)) return null;
  const shape: unknown = element['shape'];
  if (!isRecord(shape)) return null;
  return Object.keys(shape)
    .map((k) => (acceptsUndefined(shape[k]) ? `${k}?` : k))
    .join(',');
}

/** 「这个 zod 字段自己接受 undefined 吗」——比翻内部 typeName 稳（与上面同一口径）。 */
function acceptsUndefined(field: unknown): boolean {
  if (!isRecord(field)) return false;
  const safeParse = field['safeParse'];
  if (typeof safeParse !== 'function') return false;
  const result: unknown = safeParse.call(field, undefined);
  return isRecord(result) && result['success'] === true;
}

/** canonical 的分段：`通道:帧,帧,…`，段间用 `|`。 */
function segment(channel: string): string {
  const found = WS_PROTOCOL_CANONICAL.split('|').find((s) => s.startsWith(`${channel}:`));
  if (found === undefined) throw new Error(`canonical 里没有 ${channel} 这一段`);
  return found.slice(channel.length + 1);
}

describe('WS_PROTOCOL_CANONICAL ↔ zod schema 自洽', () => {
  it.each([
    ['terminal.client', 'type', TerminalClientFrameSchema],
    ['terminal.server', 'type', TerminalServerFrameSchema],
    ['events', 'event', SandboxEventSchema],
    ['tasks.client', 'type', TaskClientFrameSchema],
    ['tasks.server', 'type', TaskServerFrameSchema],
  ])('%s：字面量与 schema 逐帧逐字段一致', (channel, discriminator, schema) => {
    expect(describeUnion(discriminator, schema)).toBe(segment(channel));
  });

  it('五个通道段一个不少（漏掉一段等于那条通道没人对账）', () => {
    expect(WS_PROTOCOL_CANONICAL.split('|').map((s) => s.slice(0, s.indexOf(':')))).toEqual([
      'terminal.client',
      'terminal.server',
      'events',
      'tasks.client',
      'tasks.server',
    ]);
  });

  // 集成 reviewer 特意点名的一帧：`caught_up` 是**三**个字段，`firstSeq` 是唯一
  // 能发现"回放被砍头"的手段，少抄它会让缺失的开头看起来像"这条流本来就从这里开始"。
  it('caught_up 三个字段一个都不少', () => {
    expect(WS_PROTOCOL_CANONICAL).toContain('caught_up{taskId,firstSeq,seq}');
  });

  // 785 → 815：多终端标签（06 §5）给 `/terminal` 加了 `close_shell{shellId}` 与
  // `session{...,shellId?}`。
  // 815 → 830：刷新后恢复标签（06 §5.5）加了 `shells{shells}`。
  // 830 → 850：标签能选跑什么 CLI（06 §5.6）——清单元素从裸 id 变成
  //            `{shellId, runtimeId?}`，canonical 里写成 `shells[shellId,runtimeId?]`。
  // ⚠️ 改这个数字的同时必须确认 api 侧那份逐字相同 —— 只改这里能让本条变绿，
  // 而两仓的字面量已经漂了（那才是 docs:check B4 要拦的东西）。
  it('长度与 api 侧一致（850 字符）——字面量被改动时最先响的一条', () => {
    expect(WS_PROTOCOL_CANONICAL).toHaveLength(850);
  });

  /**
   * ⭐ 多标签那两处改动的形状（06 §5 / 08 §5）。
   *
   * `close_shell` 是协议里**唯一**能销毁一个 tmux 会话的帧，所以它单独钉：
   * ⛔ 载荷必须是 `shellId`，不能退化成"关掉我这条连接对应的那个" —— 被 LRU 淘汰的
   * 标签没有连接（08 §5.2），而用户照样会点它的 [×]。
   */
  /**
   * ⭐ `shells` 的三态（06 §5.5）。`null` 不是凑数的第三个值：
   * `[...]` 有这些 / `[]` 确认没有 / `null` **问不出来**。
   * ⛔ zod 若把它收窄成 `z.array(...)`（不 nullable），第三态在入口就被判成非法帧丢掉 ——
   * 于是"查不到"永远说不出口，界面退回"你没有开过终端"这句假话。
   */
  it('刷新恢复：shells 帧三态都能解析，null 与 [] 不是一回事', () => {
    const parse = (v: unknown): boolean =>
      TerminalServerFrameSchema.safeParse({ type: 'shells', shells: v }).success;
    expect(parse([{ shellId: 'a'.repeat(32) }])).toBe(true);
    // 带 runtimeId（06 §5.6：这个标签里跑的是哪个 CLI）
    expect(parse([{ shellId: 'a'.repeat(32), runtimeId: 'codex' }])).toBe(true);
    // ⛔ 裸 id 不再是合法元素 —— 它没地方放 runtimeId，刷新后标签名就叫不对。
    expect(parse(['a'.repeat(32)])).toBe(false);
    expect(parse([])).toBe(true);
    expect(parse(null)).toBe(true);
    // 不是数组也不是 null 的一律挡在入口外。
    expect(parse(undefined)).toBe(false);
    expect(parse('nope')).toBe(false);
    expect(WS_PROTOCOL_CANONICAL).toContain('shells{shells[shellId,runtimeId?]}');
  });

  it('多标签：close_shell 带 shellId，session 首帧可带 shellId', () => {
    expect(WS_PROTOCOL_CANONICAL).toContain('close_shell{shellId}');
    expect(WS_PROTOCOL_CANONICAL).toContain('session{socketSessionKey,shellId?}');
    expect(TerminalClientFrameSchema.safeParse({ type: 'close_shell', shellId: 'a' }).success).toBe(
      true,
    );
    // agent 连接的首帧**不带** shellId（缺席 ≠ 空串）——两种都要能解析。
    expect(
      TerminalServerFrameSchema.safeParse({ type: 'session', socketSessionKey: 'k' }).success,
    ).toBe(true);
    expect(
      TerminalServerFrameSchema.safeParse({ type: 'session', socketSessionKey: 'k', shellId: 's' })
        .success,
    ).toBe(true);
  });
});
