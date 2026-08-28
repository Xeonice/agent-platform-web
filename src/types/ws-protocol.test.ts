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
          const optional = field['safeParse'](undefined).success === true;
          return optional ? `${key}?` : key;
        });

      return fields.length === 0 ? name : `${name}{${fields.join(',')}}`;
    })
    .join(',');
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

  it('长度与 api 侧一致（785 字符）——字面量被改动时最先响的一条', () => {
    expect(WS_PROTOCOL_CANONICAL).toHaveLength(785);
  });
});
