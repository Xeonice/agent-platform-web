// SSE 帧形状的**自洽**门禁：`SSE_PROTOCOL_CANONICAL` 这段字面量必须和本文件里的 zod schema
// 逐帧逐字段一致。与 `ws-protocol.test.ts` 是同一套写法、同一个理由。
//
// 它和主仓 `scripts/docs-check.mjs` 的 B5 是一对：
//   · B5      —— api 字面量 == web 字面量（跨仓逐字节）
//   · 本文件  —— web 字面量 == web zod schema（从 schema 反推再比对）
// 两条合起来，传递地钉住「api 声明的帧形状 == web 运行时真正校验的帧形状」。
//
// ⚠️ **少了本文件，B5 全绿也证明不了什么**：两仓可以各自把字面量抄得一模一样，而 web 的
// zod schema 与它各说各话——那时候「后端发的帧」与「前端校验的帧」中间没有任何东西看着。
// SSE 面比 WS 面更需要这一条：WS 至少有三处手抄互相对照，SSE 在 B5 落地前是「一份手抄、
// 零守卫」。
//
// 为什么非要反推而不是手写几条 `toContain`：手写断言只能证明"我记得检查过这几条"，
// 反推证明的是"每一条、每一个字段、每一个可选标记都对得上"。
import { describe, it, expect } from 'vitest';
import {
  DIAGNOSE_CHECK_IDS,
  DIAGNOSE_STATUSES,
  DiagnoseCheckFrameSchema,
  DiagnoseCheckIdSchema,
  DiagnoseServerFrameSchema,
  DiagnoseStatusSchema,
  PRESET_IMAGE_CODES,
  PRESET_IMAGE_STEPS,
  PresetImageStepSchema,
  SSE_DIAGNOSE_SCHEMA_HASH,
  SSE_PROTOCOL_CANONICAL,
} from '@/types/sse-protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asSchema(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value) || typeof value['safeParse'] !== 'function') {
    throw new Error(`${what} 不是 zod schema`);
  }
  return value;
}

/** 「可选」= 这个字段自己接受 `undefined`。比翻 zod 内部的 typeName 稳。 */
function acceptsUndefined(schema: Record<string, unknown>): boolean {
  const safeParse = schema['safeParse'];
  if (typeof safeParse !== 'function') throw new Error('不是 zod schema');
  const result: unknown = safeParse.call(schema, undefined);
  return isRecord(result) && result['success'] === true;
}

/**
 * 一个字段在 canonical 里的写法。
 *
 * 两种形态（api 侧的写法就这两种）：
 *  · 标量 / 记录  → `name` 或 `name?`
 *  · 对象数组     → `name[{子字段,…}]`（`start.checks` 是唯一一个）
 *
 * ⚠️ 判据是「元素自己有没有 `shape`」而不是「有没有 `element`」：zod 的 `ZodRecord` 也带
 * `element`（它是 valueType），`detail: z.record(z.string(), z.unknown())` 会因此被误判成
 * 数组。`z.unknown()` 没有 `shape`，于是它安全地落回标量分支。
 */
function describeField(name: string, field: unknown): string {
  const schema = asSchema(field, `字段 ${name}`);
  const suffix = acceptsUndefined(schema) ? '?' : '';
  const element: unknown = schema['element'];
  if (isRecord(element) && isRecord(element['shape'])) {
    const shape = element['shape'];
    const inner = Object.keys(shape)
      .map((key) => describeField(key, shape[key]))
      .join(',');
    return `${name}[{${inner}}]${suffix}`;
  }
  return `${name}${suffix}`;
}

/**
 * 从一个 `z.discriminatedUnion(判别键, [z.object(...)])` 反推出 canonical 里的那一段。
 * 规则与 api 侧的写法一致：`帧名{字段,可选字段?}`，判别键本身不列（它就是帧名）。
 */
function describeUnion(discriminator: string, schema: unknown): string {
  const union = asSchema(schema, 'union');
  const options: unknown = union['options'];
  if (!Array.isArray(options)) throw new Error('不是 discriminatedUnion');

  return options
    .map((option: unknown) => {
      const member = asSchema(option, 'union 成员');
      const shape: unknown = member['shape'];
      if (!isRecord(shape)) throw new Error('union 成员没有 shape');

      const tag: unknown = shape[discriminator];
      if (!isRecord(tag) || typeof tag['value'] !== 'string') {
        throw new Error(`判别键 ${discriminator} 不是字面量`);
      }
      const name: string = tag['value'];

      const fields = Object.keys(shape)
        .filter((key) => key !== discriminator)
        .map((key) => describeField(key, shape[key]));

      return fields.length === 0 ? name : `${name}{${fields.join(',')}}`;
    })
    .join(',');
}

/** 从一个 `z.enum([...])` 反推出 canonical 里那一段的取值列表。 */
function describeEnum(schema: unknown): string {
  const enumSchema = asSchema(schema, 'enum');
  const options: unknown = enumSchema['options'];
  if (!Array.isArray(options)) throw new Error('不是 z.enum');
  return options.map((o: unknown) => String(o)).join(',');
}

/** canonical 的分段：`段名:内容`，段间用 `|`。 */
function segment(name: string): string {
  const found = SSE_PROTOCOL_CANONICAL.split('|').find((s) => s.startsWith(`${name}:`));
  if (found === undefined) throw new Error(`canonical 里没有 ${name} 这一段`);
  return found.slice(name.length + 1);
}

describe('SSE_PROTOCOL_CANONICAL ↔ zod schema 自洽', () => {
  it('diagnose.server：字面量与 schema 逐帧逐字段一致（含 start.checks 的子字段）', () => {
    expect(describeUnion('event', DiagnoseServerFrameSchema)).toBe(segment('diagnose.server'));
  });

  it('diagnose.status：字面量与 zod enum 逐值同序', () => {
    // ⚠️ 同序而不是同集合：`info` 与 `timeout` 是两个最容易被"合并进 warn / fail"的取值，
    //    而按集合断言时，把它们从枚举里删掉再从字面量里删掉，两边照样一致。
    expect(describeEnum(DiagnoseStatusSchema)).toBe(segment('diagnose.status'));
    expect(DIAGNOSE_STATUSES).toContain('info');
    expect(DIAGNOSE_STATUSES).toContain('timeout');
  });

  it('diagnose.checks：八项 id 与**顺序**都对得上（顺序本身是产品要求）', () => {
    // 首帧 `start` 按这个顺序下发、前端照它渲染占位；只断言集合会让一次重排安静通过。
    expect(describeEnum(DiagnoseCheckIdSchema)).toBe(segment('diagnose.checks'));
    expect(DIAGNOSE_CHECK_IDS).toHaveLength(8);
    expect(DIAGNOSE_CHECK_IDS[7]).toBe('preset-image');
  });

  it('diagnose.preset-image.steps：五步与 zod enum 一致', () => {
    expect(describeEnum(PresetImageStepSchema)).toBe(segment('diagnose.preset-image.steps'));
    // ⛔ 五步不许合成一条（P21-5 §9A）；第 5 步 `staged` 不是失败。
    expect(PRESET_IMAGE_STEPS).toHaveLength(5);
    expect(PRESET_IMAGE_STEPS[4]).toBe('staged');
  });

  it('diagnose.preset-image.codes：四个码与常量一致，且第 5 步没有码', () => {
    expect(PRESET_IMAGE_CODES.join(',')).toBe(segment('diagnose.preset-image.codes'));
    expect(PRESET_IMAGE_CODES).toHaveLength(4);
    expect(PRESET_IMAGE_CODES.some((c) => c.toLowerCase().includes('staged'))).toBe(false);
    expect(new Set<string>(PRESET_IMAGE_CODES).size).toBe(PRESET_IMAGE_CODES.length);
  });

  it('⭐ `errorCode` 是**开放集合**不是 enum —— 后端多一个码不许放大成整帧校验失败', () => {
    // ⚠️ 这条是本文件唯一一条"schema 必须**不**收窄"的断言，也是最容易被"顺手改严"
    //    掉的一条：把 `z.string()` 换成 `z.enum(PRESET_IMAGE_CODES)` 之后，上面每一条
    //    都还是绿的（canonical 里那一段本来就列着这四个码），而真后端新增一个码那天，
    //    前端会因为一个「后端多说了一句」把**整帧**丢掉——一个字都渲染不出来。
    const frame = {
      event: 'check' as const,
      id: 'preset-image' as const,
      label: '预制镜像就绪',
      status: 'fail' as const,
      summary: '未来的某个新码',
      errorCode: 'PRESET_IMAGE_SOMETHING_NEW_2027',
      durationMs: 12,
    };
    const parsed = DiagnoseCheckFrameSchema.safeParse(frame);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.errorCode).toBe('PRESET_IMAGE_SOMETHING_NEW_2027');
  });

  it('九个段一个不少、且顺序固定（漏掉一段等于那一组取值没人对账）', () => {
    expect(SSE_PROTOCOL_CANONICAL.split('|').map((s) => s.slice(0, s.indexOf(':')))).toEqual([
      'diagnose.server',
      'diagnose.status',
      'diagnose.checks',
      'diagnose.preset-image.steps',
      'diagnose.preset-image.codes',
      // 2026-09-05 新增：预制镜像搬运流（P21-8 §2 ⇒ 新判据）。
      // ⚠️ 这四段与上面五段共用同一个 canonical，因为它们走**同一个 SSE 写出口**
      //    （`SseWriter`）——两条流各持一份 canonical 会让「改帧形状必须两边同时改」
      //    这条纪律出现一个只对其中一条生效的缺口。
      'provision.server',
      'provision.stages',
      'provision.status',
      'provision.codes',
    ]);
  });

  it('长度与 api 侧一致（795 字符）——字面量被改动时最先响的一条', () => {
    expect(SSE_PROTOCOL_CANONICAL).toHaveLength(795);
  });

  it('schema hash 是钉死的字面量（它是告知不是门，但版本本身不许悄悄变）', () => {
    expect(SSE_DIAGNOSE_SCHEMA_HASH).toBe('sb-diagnose-v1');
  });
});
