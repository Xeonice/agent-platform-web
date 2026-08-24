// 无头 Task 事件流归约（S6 纯函数主战场，12 §3.2）。
// 覆盖：三类事件的渲染分类、session-started 不渲染但 ref 存下来、
// **seq 缺口不容忍**（缺口/落后于 caught_up 都要报警）、重复回放幂等、exitCode 缺席、订阅帧的 fromSeq。
import { describe, it, expect } from 'vitest';
import {
  applyTaskServerFrame,
  buildSubscribeFrame,
  describeSeqAnomaly,
  initialTaskStreamState,
  MAX_STREAM_ITEMS,
  selectSeqAnomaly,
  taskStreamReducer,
  toolCallFailed,
} from '@/lib/task/taskStream';
import type { RuntimeEvent, TaskServerFrame } from '@/types/ws-protocol';
import type { TaskStreamState } from '@/types/taskStream';

const TASK = 't-1';

/** 载荷已逐成员钉死 ⇒ 测试也按 union 构造，形状写错在 tsc 阶段就红。 */
function frameOf(seq: number, event: RuntimeEvent): TaskServerFrame {
  return { type: 'event', taskId: TASK, seq, event };
}

const TS = '2026-08-22T00:00:00.000Z';

/** 最常用的一类：agent 正文。 */
function messageFrame(seq: number, text: string): TaskServerFrame {
  return frameOf(seq, { type: 'agent-message', timestamp: TS, data: { text } });
}

function caughtUp(firstSeq: number, seq: number): TaskServerFrame {
  return { type: 'caught_up', taskId: TASK, firstSeq, seq };
}

function feed(frames: TaskServerFrame[], from = initialTaskStreamState()): TaskStreamState {
  return frames.reduce(applyTaskServerFrame, from);
}

describe('taskStream · 事件渲染分类', () => {
  it('正文 / 工具调用 / 错误分三类', () => {
    const state = feed([
      messageFrame(1, '开始分析仓库'),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'call-1', name: 'read_file', input: { path: 'src/app.ts' } },
      }),
      frameOf(3, { type: 'error', timestamp: TS, data: { message: '解析失败' } }),
    ]);

    expect(state.items.map((i) => i.kind)).toEqual(['message', 'tool', 'error']);
    expect(state.items[0]?.text).toBe('开始分析仓库');
    expect(state.items[1]?.tool?.name).toBe('read_file');
    expect(state.items[1]?.tool?.input).toContain('src/app.ts');
    // 事件级 error **只有 message 没有码**（码在通道级 error 帧上）⇒ 原样透出后端的句子。
    expect(state.items[2]?.text).toBe('解析失败');
    expect(state.items[2]?.code).toBeUndefined();
  });

  it('agent-message 与 stdout-chunk 都归入正文（漏掉前者=agent 正文一条都渲染不出来）', () => {
    const state = feed([
      messageFrame(1, 'agent 的散文'),
      frameOf(2, { type: 'stdout-chunk', timestamp: TS, data: { text: '裸字节' } }),
    ]);
    expect(state.items.map((i) => i.kind)).toEqual(['message', 'message']);
    expect(state.items.map((i) => i.text)).toEqual(['agent 的散文', '裸字节']);
  });

  it('auth-required 归入错误类并带 AUTH_REQUIRED 码', () => {
    const state = feed([
      frameOf(1, { type: 'auth-required', timestamp: TS, data: { method: 'oauth-device' } }),
    ]);
    expect(state.items[0]?.kind).toBe('error');
    expect(state.items[0]?.code).toBe('AUTH_REQUIRED');
    expect(state.items[0]?.text).toContain('oauth-device');
  });

  it('task-complete 是告示（notice），载荷为空且**不含退出码**（那是 exit 帧的事）', () => {
    const state = feed([frameOf(1, { type: 'task-complete', timestamp: TS, data: {} })]);
    expect(state.items[0]?.kind).toBe('notice');
    expect(state.items[0]?.text).toBe('任务执行结束');
  });

  it('timestamp 可能是空串（parseOutput 无 Clock）——不影响渲染', () => {
    const state = feed([frameOf(1, { type: 'agent-message', timestamp: '', data: { text: 'x' } })]);
    expect(state.items).toHaveLength(1);
  });
});

describe('taskStream · tool-call 两帧按 id 配对', () => {
  it('started + completed 合并成**一个**条目（不是两次独立调用）', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'c1', name: 'bash', input: { cmd: 'ls' } },
      }),
      messageFrame(2, '中间还夹了一条正文'),
      frameOf(3, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: 'c1', exitCode: 0, output: 'a.ts\nb.ts' },
      }),
    ]);

    // 三帧 → 两个条目：工具调用只占一条。
    expect(state.items).toHaveLength(2);
    const tool = state.items.find((i) => i.kind === 'tool');
    expect(tool?.tool).toMatchObject({
      callId: 'c1',
      name: 'bash',
      status: 'completed',
      exitCode: 0,
      failed: false,
      output: 'a.ts\nb.ts',
    });
    // 合并不改渲染 key（React 不会把它当成新节点重挂）。key 里带 started 那帧的 seq，
    // 否则同一个 callId 的两次调用会塌成同一个 key（见下面的重复 id 用例）。
    expect(tool?.id).toBe('tool:c1:1');
    const beforeMerge = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'c1', name: 'bash' },
      }),
    ]);
    expect(beforeMerge.items[0]?.id).toBe(tool?.id);
    // 位置保持在 started 到达的地方，不会被挪到末尾。
    expect(state.items[0]?.kind).toBe('tool');
  });

  it('多路并发调用各自按 id 配对，不互相串味', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'a', name: 'read' },
      }),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'b', name: 'write' },
      }),
      frameOf(3, { type: 'tool-call', timestamp: TS, data: { status: 'completed', id: 'b' } }),
    ]);

    expect(state.items).toHaveLength(2);
    expect(state.items[0]?.tool).toMatchObject({ callId: 'a', name: 'read', status: 'started' });
    expect(state.items[1]?.tool).toMatchObject({ callId: 'b', name: 'write', status: 'completed' });
  });

  it('孤立的 completed（回放从中间起，错过 started）⇒ 单独成条并如实标未知，不编工具名', () => {
    const state = feed([
      frameOf(9, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: 'z', exitCode: 1 },
      }),
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.tool).toMatchObject({ callId: 'z', status: 'completed', exitCode: 1 });
    expect(state.items[0]?.tool?.name).toBeUndefined();
    expect(state.items[0]?.text).toContain('未知工具');
  });
});

describe('taskStream · session-started', () => {
  it('不进渲染列表，但 ref 被存下来（续接用）', () => {
    const state = feed([
      frameOf(1, { type: 'session-started', timestamp: TS, data: { ref: 'sess-abc' } }),
      messageFrame(2, 'hello'),
    ]);

    expect(state.sessionRef).toBe('sess-abc');
    // 用户看到的只有 1 条（session-started 是内部事件）。
    expect(state.items).toHaveLength(1);
    expect(state.items[0]?.kind).toBe('message');
    // 但 seq 记账照常推进——否则后续会被误判成缺口。
    expect(state.lastSeq).toBe(2);
  });
});

describe('taskStream · seq 记账（缺口不容忍）', () => {
  it('首帧锚定：序号基准是 0 还是 1 由后端决定，不凭空报缺口', () => {
    const fromZero = feed([messageFrame(0, 'a')]);
    expect(fromZero.seqAnomaly).toBeNull();
    const fromSeven = feed([messageFrame(7, 'a')]);
    expect(fromSeven.seqAnomaly).toBeNull();
  });

  it('连续 seq 一切正常', () => {
    const state = feed([messageFrame(1, 'a'), messageFrame(2, 'b'), messageFrame(3, 'c')]);
    expect(state.seqAnomaly).toBeNull();
    expect(state.items).toHaveLength(3);
  });

  it('跳号 = bug：记 gap 并给人话，但已到的那条仍然渲染（不二次丢数据）', () => {
    const state = feed([
      messageFrame(1, 'a'),
      messageFrame(4, 'd'), // 2、3 丢了
    ]);
    expect(state.seqAnomaly).toEqual({ kind: 'gap', expected: 2, received: 4 });
    expect(state.items).toHaveLength(2);
    expect(describeSeqAnomaly(state.seqAnomaly!)).toContain('缺口');
  });

  it('重复回放（seq ≤ lastSeq）幂等丢弃，且**不**算缺口', () => {
    const state = feed([
      messageFrame(1, 'a'),
      messageFrame(2, 'b'),
      messageFrame(2, 'b'), // 重连窗口内的重叠回放
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.seqAnomaly).toBeNull();
    expect(state.lastSeq).toBe(2);
  });

  it('caught_up 是一次缺口体检：后端说发到 5、我们只收到 2 ⇒ 报警', () => {
    const state = feed([messageFrame(1, 'a'), messageFrame(2, 'b'), caughtUp(1, 5)]);
    expect(state.caughtUp).toBe(true);
    // behind 是**读时现算**的活状态（见下一个用例），不写进粘性的 seqAnomaly。
    const anomaly = selectSeqAnomaly(state);
    expect(anomaly).toEqual({ kind: 'behind-caught-up', expected: 5, received: 2 });
    expect(describeSeqAnomaly(anomaly!)).toContain('丢失');
  });

  it('caught_up 先于它宣称的事件到达 ⇒ **不误报**：事件补齐后异常自己消失', () => {
    // 老实现在收到 caught_up 的当场就定论 ⇒ 只要 caught_up 抢先一步就是一次假报警，
    // 而 seqAnomaly 是粘性的，假警报再也撤不掉。
    const early = feed([caughtUp(1, 3)]);
    expect(selectSeqAnomaly(early)).toEqual({
      kind: 'behind-caught-up',
      expected: 3,
      received: 0,
    });

    const settled = feed([messageFrame(1, 'a'), messageFrame(2, 'b'), messageFrame(3, 'c')], early);
    expect(selectSeqAnomaly(settled)).toBeNull();
    expect(settled.seqAnomaly).toBeNull();
  });

  it('caught_up 与实收一致 ⇒ 无异常', () => {
    const state = feed([messageFrame(1, 'a'), caughtUp(1, 1)]);
    expect(state.caughtUp).toBe(true);
    expect(selectSeqAnomaly(state)).toBeNull();
  });

  it('新一轮订阅作废上一轮的 caught_up 记账（旧 seq 不跟新 fromSeq 混着判）', () => {
    const state = taskStreamReducer(feed([caughtUp(1, 9)]), { kind: 'subscribed', fromSeq: 0 });
    expect(state.caughtUpSeq).toBeNull();
    expect(selectSeqAnomaly(state)).toBeNull();
  });
});

describe('taskStream · 重复的 tool id（S6 review ⑥）', () => {
  // 可达性来自后端：两个解析器都用 `str()` 兜底工具 id，非字符串一律得 ''，
  // 于是**任何两个缺 id 的工具项都会塌成同一个 key**。老实现的 key 就是 `tool:${id}`。
  it('同一个 callId 的两次 started ⇒ 两个条目、两个**不同**的渲染 key（不重复）', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: '', name: 'a' },
      }),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: '', name: 'b' },
      }),
    ]);

    expect(state.items).toHaveLength(2);
    const ids = state.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('两次调用交错完成 ⇒ 各自配对到自己的 started，不互相覆盖', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: '', name: 'a' },
      }),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: '', name: 'b' },
      }),
      frameOf(3, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: '', output: 'first' },
      }),
      frameOf(4, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: '', output: 'second' },
      }),
    ]);

    expect(state.items).toHaveLength(2);
    // 完成半场配对到"最近一个还没完成的 started"：b 先收口，a 后收口。
    expect(state.items[0]?.tool).toMatchObject({
      name: 'a',
      status: 'completed',
      output: 'second',
    });
    expect(state.items[1]?.tool).toMatchObject({ name: 'b', status: 'completed', output: 'first' });
    const ids = state.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('孤立的 completed 连来两条 ⇒ key 依然互不相同', () => {
    const state = feed([
      frameOf(1, { type: 'tool-call', timestamp: TS, data: { status: 'completed', id: '' } }),
      frameOf(2, { type: 'tool-call', timestamp: TS, data: { status: 'completed', id: '' } }),
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]?.id).not.toBe(state.items[1]?.id);
  });
});

describe('taskStream · 条目上限（S6 review ⑤）', () => {
  it('超出上限 ⇒ 丢**最早**的并记账（不静默截断）', () => {
    const frames = Array.from({ length: MAX_STREAM_ITEMS + 3 }, (_, i) =>
      messageFrame(i + 1, `line-${String(i + 1)}`),
    );
    const state = feed(frames);

    expect(state.items).toHaveLength(MAX_STREAM_ITEMS);
    expect(state.droppedItems).toBe(3);
    // 丢的是头，留的是尾（用户要看的是最新输出）。
    expect(state.items[0]?.text).toBe('line-4');
    expect(state.items.at(-1)?.text).toBe(`line-${String(MAX_STREAM_ITEMS + 3)}`);
    // seq 记账不受截断影响（重连仍从真正的最大 seq 续订）。
    expect(state.lastSeq).toBe(MAX_STREAM_ITEMS + 3);
  });

  it('上限内不丢也不记账（不误伤正常任务）', () => {
    const state = feed([messageFrame(1, 'a'), messageFrame(2, 'b')]);
    expect(state.droppedItems).toBe(0);
    expect(state.items).toHaveLength(2);
  });

  it('丢头之后通道级错误项的 key 仍然唯一（不会重新用回 chan:0）', () => {
    const channelError: TaskServerFrame = { type: 'error', taskId: TASK, code: 'REPLAY_FAILED' };
    const frames: TaskServerFrame[] = [
      channelError,
      ...Array.from({ length: MAX_STREAM_ITEMS + 5 }, (_, i) =>
        messageFrame(i + 1, `l${String(i)}`),
      ),
      channelError,
    ];
    const state = feed(frames);
    const ids = state.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('taskStream · 订阅帧（刷新/重连恢复）', () => {
  it('lastSeq=0（刷新后内存为空）⇒ 不带 fromSeq，请后端从头回放', () => {
    expect(buildSubscribeFrame(TASK, 0)).toEqual({ type: 'subscribe', taskId: TASK });
  });

  it('lastSeq>0（断线重连）⇒ 带 fromSeq，只补缺的那截', () => {
    expect(buildSubscribeFrame(TASK, 42)).toEqual({
      type: 'subscribe',
      taskId: TASK,
      fromSeq: 42,
    });
  });
});

describe('taskStream · 终态与通道错误', () => {
  it('exit 带退出码 → 原样保留', () => {
    const state = feed([{ type: 'exit', taskId: TASK, status: 'succeeded', exitCode: 0 }]);
    expect(state.exit).toEqual({ status: 'succeeded', exitCode: 0 });
  });

  it('exit **缺** exitCode → 不补 0、不留 undefined 字段（呈现层据此按非零处理）', () => {
    const state = feed([{ type: 'exit', taskId: TASK, status: 'killed' }]);
    expect(state.exit).toEqual({ status: 'killed' });
    expect(state.exit && 'exitCode' in state.exit).toBe(false);
  });

  it('通道级 error 帧 → 记码 + 追加一条人话错误项', () => {
    const state = feed([{ type: 'error', taskId: TASK, code: 'INTERNAL' }]);
    expect(state.channelErrorCode).toBe('INTERNAL');
    expect(state.items[0]?.kind).toBe('error');
    expect(state.items[0]?.text).not.toBe('INTERNAL'); // 人话，不是裸码
  });

  it('通道级错误说的是**通道**的事：任务没结束就不许说"任务以…结束"', () => {
    // 后端 tasks.gateway 真会发这两个码：找不到任务、回放失败。
    // 它们走的是通道词表，不是终态词表——套终态那句话等于凭空宣告任务结束了。
    const notFound = feed([{ type: 'error', taskId: TASK, code: 'NOT_FOUND' }]);
    expect(notFound.items[0]?.text).toContain('事件通道');
    expect(notFound.items[0]?.text).not.toContain('结束');

    const replay = feed([{ type: 'error', taskId: TASK, code: 'REPLAY_FAILED' }]);
    expect(replay.items[0]?.text).toContain('回放');
    expect(replay.items[0]?.text).not.toContain('结束');
  });

  it('通道词表没收录的码 ⇒ 走**通道语境**的兜底（不是终态语境那句）', () => {
    const state = feed([{ type: 'error', taskId: TASK, code: 'SOMETHING_NEW' }]);
    expect(state.items[0]?.text).toContain('任务事件通道报错');
    expect(state.items[0]?.code).toBe('SOMETHING_NEW');
  });

  it('pong 不改变任何状态（心跳不该造成重渲染）', () => {
    const before = feed([messageFrame(1, 'a')]);
    expect(applyTaskServerFrame(before, { type: 'pong' })).toBe(before);
  });
});

describe('taskStream · reducer', () => {
  it('reset 回到初始态（换任务时不残留上一轮的行）', () => {
    const state = feed([messageFrame(1, 'a')]);
    expect(taskStreamReducer(state, { kind: 'reset' })).toEqual(initialTaskStreamState());
  });
});

describe('taskStream · caught_up.firstSeq（回放被砍头才发现得了）', () => {
  it('回放开头被砍 ⇒ 报 truncated（这是 firstSeq 唯一存在的理由）', () => {
    // 从头订阅（fromSeq=0，期望第一条是 1），后端却只回放得到 25 起。
    const state = [
      { kind: 'subscribed' as const, fromSeq: 0 },
      { kind: 'frame' as const, frame: messageFrame(25, '半截记录') },
      { kind: 'frame' as const, frame: caughtUp(25, 25) },
    ].reduce(taskStreamReducer, initialTaskStreamState());

    expect(state.seqAnomaly).toEqual({ kind: 'truncated', expected: 1, received: 25 });
    expect(describeSeqAnomaly(state.seqAnomaly!)).toContain('开头');
  });

  it('重连补齐（fromSeq=3）+ 回放从 4 起 ⇒ 正常，不误报', () => {
    const state = [
      { kind: 'subscribed' as const, fromSeq: 3 },
      { kind: 'frame' as const, frame: messageFrame(4, 'd') },
      { kind: 'frame' as const, frame: caughtUp(4, 4) },
    ].reduce(taskStreamReducer, initialTaskStreamState());

    expect(state.seqAnomaly).toBeNull();
    expect(state.caughtUp).toBe(true);
  });

  it('空回放的约定（firstSeq = seq + 1）不被误判成截断', () => {
    // 已有到 7，重连后没有新东西：后端回 caught_up{firstSeq: 8, seq: 7}。
    const state = [
      { kind: 'subscribed' as const, fromSeq: 7 },
      { kind: 'frame' as const, frame: caughtUp(8, 7) },
    ].reduce(taskStreamReducer, initialTaskStreamState());

    expect(state.seqAnomaly).toBeNull();
  });

  it('重新 subscribe 会把 caughtUp 复位（重连后又要先回放一轮）', () => {
    const after = [
      { kind: 'subscribed' as const, fromSeq: 0 },
      { kind: 'frame' as const, frame: caughtUp(1, 1) },
      { kind: 'subscribed' as const, fromSeq: 1 },
    ].reduce(taskStreamReducer, initialTaskStreamState());

    expect(after.caughtUp).toBe(false);
    expect(after.subscribedFromSeq).toBe(1);
  });
});

// ————————————————————————————————————————————————————————————————
// 工具调用失败判定：两个来源各司其职，且有个真陷阱
//   · exitCode —— **真实**退出码，只有 codex 给，后端永不合成；
//   · isError  —— "工具自己说它失败了"，只有 claude 给，且只在 true 时出现。
// ⚠️ 写成 `exitCode !== 0` 会把**所有 claude 的成功调用**（没有 exitCode）标成失败。
// ————————————————————————————————————————————————————————————————
describe('toolCallFailed · 失败判定', () => {
  it('claude 成功（两个字段都缺席）⇒ **不是失败**（这就是那个陷阱）', () => {
    expect(toolCallFailed({})).toBe(false);
    // 显式写出"两个键都在但都是 undefined"这一形态，同样不算失败。
    expect(toolCallFailed({ exitCode: undefined, isError: undefined })).toBe(false);
  });

  it('claude 失败（isError:true，且没有 exitCode 键）⇒ 失败', () => {
    expect(toolCallFailed({ isError: true })).toBe(true);
  });

  it('codex 成功（exitCode 0，且没有 isError 键）⇒ 不是失败', () => {
    expect(toolCallFailed({ exitCode: 0 })).toBe(false);
  });

  it('codex 失败（真实非零退出码）⇒ 失败', () => {
    expect(toolCallFailed({ exitCode: 1 })).toBe(true);
    expect(toolCallFailed({ exitCode: 137 })).toBe(true);
  });

  it('isError:false 显式出现时不当失败（契约说只在 true 时出现，这里防御一手）', () => {
    expect(toolCallFailed({ isError: false })).toBe(false);
    expect(toolCallFailed({ isError: false, exitCode: 0 })).toBe(false);
  });
});

describe('taskStream · 工具失败落到条目上', () => {
  it('claude 风格失败：isError 合并成 failed=true，且**不编造退出码**', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'c1', name: 'Edit' },
      }),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: 'c1', isError: true, output: 'file not found' },
      }),
    ]);

    const tool = state.items[0]?.tool;
    expect(tool?.failed).toBe(true);
    // 没有 exitCode 键就是没有——不合成一个 1 出来（那会让真 1 和捏的 1 分不开）。
    expect(tool?.exitCode).toBeUndefined();
    expect(tool?.output).toBe('file not found');
  });

  it('claude 风格成功：两个字段都缺席 ⇒ failed=false', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'c2', name: 'Read' },
      }),
      frameOf(2, { type: 'tool-call', timestamp: TS, data: { status: 'completed', id: 'c2' } }),
    ]);
    expect(state.items[0]?.tool?.failed).toBe(false);
  });

  it('codex 风格失败：真实非零退出码 ⇒ failed=true 且退出码原样保留', () => {
    const state = feed([
      frameOf(1, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'started', id: 'c3', name: 'bash' },
      }),
      frameOf(2, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: 'c3', exitCode: 2 },
      }),
    ]);
    expect(state.items[0]?.tool).toMatchObject({ failed: true, exitCode: 2 });
  });

  it('孤立的 completed 也照样判失败（回放从中间起）', () => {
    const state = feed([
      frameOf(9, {
        type: 'tool-call',
        timestamp: TS,
        data: { status: 'completed', id: 'z', isError: true },
      }),
    ]);
    expect(state.items[0]?.tool?.failed).toBe(true);
  });
});
