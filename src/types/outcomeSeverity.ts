// 结果类文案（沙箱失败卡 / 任务终态卡）的语义严重度。
//
// ⚠️ 架构口径（design/design-notes.md「lib 返回语义状态，view 负责渲染成图标」同一条纪律
// 在 `StatusPill` 上的先例）：`lib/sandbox/sandboxErrorCopy.ts`、`lib/task/taskOutcome.ts`
// 过去把「这条文案该配哪个图标」编码成 `title` 字符串里的一个字面 emoji 字符
// （如 `'❌ 平台没有登记这台机器的沙箱环境'`）。这是把表现层塞进了纯逻辑层：
// lib 不该知道"图标长什么样"，只该说清"这是哪一类结果"。
//
// 本类型就是拆出来的那个"哪一类"。取值特意与 `components/ui/status-pill.tsx` 的
// `StatusPillStatus` 用同一套字面量（子集）——两者故意同名，方便调用方按需选择
// `<OutcomeIcon severity=…>`（裸图标，用在一句话标题前）还是 `<StatusPill status=…>`
// （八态徽标，用在列表/卡片的状态位），互认时不必转换。
//
// ⛔ `lib/` 只产出这个字符串字面量，不导入、不返回任何图标组件——`type` 层允许被
// `lib`/`component`/`view` 同时依赖（07 §4.1 分层方向），是两边唯一合法的交汇点。
export type OutcomeSeverity = 'ok' | 'info' | 'warn' | 'fail' | 'timeout';
