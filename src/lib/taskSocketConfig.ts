// /tasks 通道的连接描述（纯函数，可单测）。与 lib/terminalSocket、lib/sandboxLifecycle 的
// buildEventsSocketUri 同一模式：origin 归一化在一处，namespace 常量不散落。
import { normalizeOrigin } from '@/lib/terminalSocket';

export const TASKS_NAMESPACE = '/tasks';

/**
 * 跨仓帧协议版本标识（14 §2.5 的 X-Schema-Hash 握手纪律）。
 * /tasks 是手工同步的通道，握手带上版本号 ⇒ 双端帧形状漂移时握手期就能发现，
 * 而不是等到某条帧被 zod 静默丢弃。后端若暂不校验，多带一个 query 参数无副作用。
 */
export const WS_TASKS_SCHEMA_HASH = 'sb-tasks-v1';

/** `<origin>/tasks`：交给 io() 作为连接 uri。 */
export function buildTasksSocketUri(base: string): string {
  return `${normalizeOrigin(base)}${TASKS_NAMESPACE}`;
}

/**
 * 握手 query。两个键，两件事：
 *  · `xSchemaHash` —— 帧协议版本标识（见上）。
 *  · `sandboxId` —— **订阅归属校验的依据**。taskId 仍然走 `subscribe` 帧而不是 query
 *    （一条连接可以换订阅目标），但"这条连接在看哪个沙箱"必须在握手期就说清楚：
 *    后端 `/tasks` 的 subscribe 拿它跟 `task.sandboxId` 对表，与 REST 的 `requireTask`
 *    是同一条寻址规则。**不声明的连接等于绕过这条校验**——后端此前只能写成"带了就查、
 *    没带放行"，正是因为老前端一个字都不带。`/terminal` 从第一天起就是这么定域的，
 *    这里只是把 `/tasks` 补齐到同一水平。
 *
 * ⚠️ **它是握手 query，不是帧字段**：`WS_PROTOCOL_CANONICAL` 描述的是帧形状，握手参数
 * 不在其内 ⇒ 加这个键**不动 canonical**，跨仓对账（docs:check B4）也不受影响。
 * 反过来说：若哪天有人想把 sandboxId 塞进 `subscribe` 帧，那就是改帧形状，必须两仓同时改 canonical。
 *
 * ⚠️ **发布顺序**（本批不存在这个坑，但拆开发布时会）：后端把该参数从「带了就查」改成
 * **必填**与本改动**同批落地**，所以中间没有版本差窗口。将来若两仓分开发，唯一安全的顺序是
 * 「先发前端、后发后端」——多带一个 query 参数对老后端零副作用；反过来先发后端，
 * 所有还没更新的前端会在握手期被整条拒掉（连不上，不是降级）。
 */
export function buildTasksSocketQuery(
  sandboxId: string,
  schemaHash = WS_TASKS_SCHEMA_HASH,
): Record<string, string> {
  return { sandboxId, xSchemaHash: schemaHash };
}
