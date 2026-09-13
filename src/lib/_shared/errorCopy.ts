// 后端错误信封 → 用户能读的一句话。**按 `code` 查表，⛔ 不渲染 `envelope.message`。**
//
// ★ **这条纪律本仓已经裁决过一次，只是没铺开。**
//   `hooks/project/useProjectBranches.ts` 里写着：「失败原因按 code 查人话表，不直接渲染
//   message」—— 重新同步那条路照做了，而项目动作与自动化那几处没跟上。它们写的都是
//   `message !== '' ? message : 中文兜底`，而 `message` **永远非空**（后端每一处 throw
//   都带着一句话），于是那个中文兜底一次都没执行过，用户看到的一律是后端的英文原话：
//
//     project limit reached (max 50)
//     git project requires repoUrl (I-PRJ)
//     project … is not ready for a task (clone_status=cloning)
//     timezone 'UTC+8' is not an IANA time zone name (I-AUT-9). Fixed-offset spellings…
//
//   这些句子是写给排查的人看的：带内部不变量编号、带数据库字段名和枚举值。
//
// ⚠️ **兜底不回落到 message。** 未知码给一句通用话 + `traceId` —— traceId 才是用户
//   报障时真正用得上的东西（10 §6.8：「用户报障时报的那个」），而一句他看不懂的英文
//   既不能自助、也不方便转述。
//
// ⚠️ **码表按上下文分层**：同一个码在不同动作上要说不同的话（`INVALID_STATE` 在
//   [重试克隆] 上是"这个项目现在不是失败状态"，在 [改为空项目] 上是另一句）。所以
//   `describeErrorCode` 收一个 `overrides`：调用点知道自己发的是哪个请求，那是**它**
//   才有的信息，⛔ 不要试图从状态码或 message 里把它猜回来。
//
// ⚠️ **本文件不 import `services/`**（boundaries：`lib` 只许依赖 `lib` / `type`）。
//   于是"这是不是一个 ApiErrorException"由 hook 判定，本文件只收**已经拆开的信封字段**。
//   这一层分工顺带也是对的：判别异常类型是传输层的事，选文案是纯函数的事。

/** 全站通用的码 → 人话（各上下文再用 `overrides` 覆盖/补充）。 */
export const SHARED_ERROR_COPY: Readonly<Record<string, string>> = {
  UNAUTHORIZED: '登录状态失效了，请重新解锁后再试。',
  PASSCODE_REQUIRED: '需要先解锁这台机器。',
  FORBIDDEN: '没有权限做这件事。',
  PAYLOAD_TOO_LARGE: '内容太大了，服务端没有接收。',
  TIMEOUT: '这次请求超时了，可以再试一次。',
  UPSTREAM_UNAVAILABLE: '上游服务暂时连不上，稍后再试。',
  INTERNAL: '服务出错了，稍后再试。',
  VALIDATION_FAILED: '提交的内容不合要求，请检查后再试。',
};

export interface DescribeErrorCodeOptions {
  /** 本上下文特有的码 → 人话；同码时**盖过** `SHARED_ERROR_COPY`。 */
  overrides?: Readonly<Record<string, string>>;
  /** 查不到码时的那句话。⛔ 不要传后端 message 进来。 */
  fallback: string;
  /** 后端信封里的 traceId（有就附在兜底句后面）。 */
  traceId?: string | undefined;
}

/**
 * 信封里的 `code` → 一句人话。
 *
 * @param code `undefined` ⇒ 根本不是一次后端应答（网络断了、fetch 自己抛了）⇒ 走 `fallback`
 *             之外的另一句，由调用点决定；这里统一按"查不到"处理。
 */
export function describeErrorCode(
  code: string | undefined,
  { overrides, fallback, traceId }: DescribeErrorCodeOptions,
): string {
  const known = code === undefined ? undefined : (overrides?.[code] ?? SHARED_ERROR_COPY[code]);
  if (known !== undefined) return known;

  // 未知码：给通用话 + traceId。⛔ 不回落到 `envelope.message`——那是英文/内部编号，
  // 而 traceId 是用户能照着念、我们能照着查的那一个。
  return traceId === undefined || traceId === ''
    ? fallback
    : `${fallback}（报障时请提供 traceId：${traceId}）`;
}
