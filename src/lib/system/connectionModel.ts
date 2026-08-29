// 连接状态卡的视图模型（F21-5 §3 / §6）。
//
// ⚠️ **这张卡最大的风险不是漏一行，是编一行。** 运维看板上的每一行都会被当成实测结论，
// 而本页真正能测到的东西比产品原型里画的少 —— 于是本文件把三类事实分得很开：
//
//   · **测到了**（`ok` / `down`）—— REST 是本页自己刚打过的两个请求；终端连接数是全局
//     registry 里真实存在的条目数。
//   · **测不了**（`unknown`）—— `/events` 的心跳延迟与"上次事件推送"。这条通道
//     **只挂在工作台**（`WorkbenchContainer` → `useSandboxEventsSocket`，本仓唯一挂载点），
//     进设置页时它已经随工作台卸载了。
//
// ⛔ **不许为了点亮这一行而在本页新开一条 /events 连接**：那是为了显示一个状态而制造
// 一个状态——测出来的是"我刚开的这条连接通不通"，不是"工作台那条通不通"，而用户读到的
// 是后者。⛔ 也不许把它渲染成 🔴「已断开」：那是**假警报**，每次进设置页都会亮，
// 而假警报比不检查更贵（同 P21-5 §9B 对端口检查那句）。
//
// ⚠️ `unknown` 与 `down` 分开，是诊断那条 `timeout ≠ fail` 纪律在这里的同一形态。
import type {
  ConnectionRowModel,
  ConnectionStatusCardModel,
  ConnectionState,
} from '@/types/system';

/** `15 → '15ms'`、`1500 → '1.5s'`、`null → '—'`（F21-5 §7.1）。 */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${String(Math.round(ms))}ms`;
  return `${String(Math.round(ms / 100) / 10)}s`;
}

export interface ConnectionFacts {
  /** 本页两个 query 的实时结论。`errorCode` 来自错误信封。 */
  rest: { ok: boolean; errorCode?: string };
  /** 全局终端 registry：总条目数与其中处于 `open` 的条数。 */
  terminals: { total: number; connected: number };
  /**
   * `/events` 心跳往返延迟。
   *
   * ⚠️ **`null` = 没有测量，不是 0ms 也不是断开**。本仓今天恒为 `null`（通道没在本页挂载，
   * 且 `eventsSocket` 上没有 ping/pong RTT 采样）。留成参数而不是写死，是因为这一行
   * 在延迟采样落地那天只需要换调用方一个值——而写死会让那天有人先去删一段"永远是 —"的代码。
   */
  eventsLatencyMs: number | null;
}

const EVENTS_UNMEASURED_HINT =
  '/events 只在工作台挂载（本页不另开一条连接：那测的是新连接通不通，不是工作台那条）；' +
  '通道断连时工作台会自行退避重连，无需在此干预';

export function connectionStatusModel(facts: ConnectionFacts): ConnectionStatusCardModel {
  const restState: ConnectionState = facts.rest.ok ? 'ok' : 'down';
  const rows: ConnectionRowModel[] = [
    {
      id: 'rest',
      label: 'REST',
      state: restState,
      valueText: facts.rest.ok ? '正常（本页数据刚取回）' : '请求失败',
      ...(facts.rest.ok || facts.rest.errorCode === undefined
        ? {}
        : { hint: `错误码 ${facts.rest.errorCode}` }),
    },
    {
      id: 'events',
      label: 'WS /events',
      state: facts.eventsLatencyMs === null ? 'unknown' : 'ok',
      valueText:
        facts.eventsLatencyMs === null
          ? '本页未测量'
          : `延迟 ${formatLatency(facts.eventsLatencyMs)}`,
      ...(facts.eventsLatencyMs === null ? { hint: EVENTS_UNMEASURED_HINT } : {}),
    },
    {
      id: 'terminals',
      label: '终端连接',
      state: 'ok',
      // ⚠️ 0 是**事实**不是未知：registry 里确实一个条目都没有（终端实例随工作台卸载销毁）。
      valueText:
        facts.terminals.total === 0
          ? '0 个终端会话'
          : `${String(facts.terminals.total)} 个终端会话（${String(facts.terminals.connected)} 个已连接）`,
    },
  ];
  return { rows };
}
