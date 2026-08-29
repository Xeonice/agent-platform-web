// 系统状态页与初始化向导的 REST + SSE（F21-5 §4/§5 / F21-8 / 10 §6.6.1 / 27 §295-296）。
//
// 本文件是 `/api/system/*` **全部八个端点**的唯一出口：审计两条（list / export）、
// 状态与初始化六条（init-status / init / settings×2 / resources / providers / diagnose）。
// ⚠️ 六条一次写全而不是"哪一轮用得到写哪条"：F21-5（四张卡）与 F21-8（初始化向导）
// 共用这一层，分两轮写的代价不是多敲几行，而是第二轮的人**大概率不会回来读第一轮的
// 约定**，于是 `init` 会被再实现一份、形状略有不同。
//
// ⚠️ **审计那两条的纪律都在"发不发请求"上，不在"怎么发"上**：
//
//  ① `since` / `before` **互斥由前端当场挡**（28 §9）。让后端回 400 也对，但那是一次
//     可以在前端消灭的往返，而且错误会发生在**离成因最远的地方**——网络面板里一条 400，
//     成因却是十几帧之前某个 hook 同时算出了两个游标。这里抛，栈直接指着调用点。
//  ② `exportAudit()` **不解析 body，也不 fetch**（F21-5 §4）。包是 tar.gz，几十 MB，
//     前端读它没有任何用途；用一次浏览器导航把 `Content-Disposition` 交给浏览器，
//     内存里不留副本。⚠️ 一旦有人"顺手"改成 `fetch` + `blob()`，界面完全正常，
//     只是 50MB 包会整个进 JS 堆——`system.service.test.ts` 有一条断言守着它。
//     ⚠️ 而这次导航**必须去新标签页**（`target="_blank"`）：成功时响应带
//     `Content-Disposition: attachment`，浏览器下载、开的那个标签页当场自己关掉，用户无感；
//     **失败时后端刻意保留了 JSON 错误信封**（`application/json`，没有那个头），
//     同标签页导航会把整个 SPA 换成一张裸 JSON 错误页——筛选、滚动位置、展开的行全没了，
//     而"导出失败"本身只是一次可重试的小事。污染一个新标签页远好过弄丢应用。
import { apiClient, API_BASE_URL } from '@/services/api/client';
import { ApiErrorException, toApiError } from '@/services/api/apiError';
import { toAuditWireQuery, AUDIT_PAGE_LIMIT, type AuditCursor } from '@/lib/audit/auditStream';
import { reportError } from '@/lib/_shared/reportError';
import { DiagnoseServerFrameSchema, SSE_DIAGNOSE_SCHEMA_HASH } from '@/types/sse-protocol';
import type { AuditFilters, AuditListDto } from '@/types/audit';
import type {
  DiagnoseCheckFrame,
  DiagnoseDoneFrame,
  DiagnoseServerFrame,
  DiagnoseStartFrame,
} from '@/types/sse-protocol';
import type {
  InitRequestDto,
  InitStatusDto,
  SystemProvidersDto,
  SystemResourcesDto,
  SystemSettingsDto,
  UpdateSystemSettingsDto,
} from '@/types/system';

export class AuditCursorConflictError extends Error {
  constructor() {
    super(
      'since 与 before 互斥：since 向新翻页（增量刷新）、before 向老翻页（历史滚动），一次只能给一个方向',
    );
    this.name = 'AuditCursorConflictError';
  }
}

export interface ListAuditQuery extends AuditFilters, AuditCursor {
  limit?: number;
}

/**
 * `GET /api/system/audit` —— 双向游标（10 §6.6.1）。响应恒按 `seq` 降序 + `hasMore`。
 *
 * `hasMore` 在两个方向含义不同：`since` 方向 = 「还有更新的没拉完」= **有断层**；
 * `before` 方向 = 「还有更老的」= 可继续滚。调用方据此分岔，本层不解释。
 */
export async function listAudit(query: ListAuditQuery): Promise<AuditListDto> {
  if (query.since !== undefined && query.before !== undefined) {
    throw new AuditCursorConflictError();
  }
  const wire = toAuditWireQuery(
    query,
    {
      ...(query.since === undefined ? {} : { since: query.since }),
      ...(query.before === undefined ? {} : { before: query.before }),
    },
    query.limit ?? AUDIT_PAGE_LIMIT,
  );
  const { data, error, response } = await apiClient.GET('/api/system/audit', {
    params: { query: wire },
  });
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

/**
 * `GET /api/system/audit/export` —— 触发浏览器下载 tar.gz（`audit.jsonl` + `runtime.log` +
 * `diagnose.json` + `export-range.json`）。**前端不解析 body、也不自己标注截取范围**
 * ——范围由后端写进包里的 `export-range.json`（P21-5 §10.3）。
 *
 * 同源导航天然带上 HttpOnly 的 `ap_session` cookie（口令门 11 §3.1），无需 `credentials` 配置。
 */
export function exportAudit(): void {
  const anchor = document.createElement('a');
  anchor.href = `${API_BASE_URL}/api/system/audit/export`;
  // download 属性刻意不给文件名：文件名在后端的 Content-Disposition 里（带导出时刻），
  // 前端编一个会盖掉它。
  // ⛔ `target` 不许去掉：见文件头 ②（失败时的 JSON 信封会把当前页整个导航掉）。
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

// ————————————————————————————————————————————————————————————————
// 系统状态 / 初始化的其余五个 REST 端点（10 §6.6 / 27 §295-296）。
//
// ⚠️ **这一层是 F21-5（系统状态四张卡）与 F21-8（初始化向导）共用的**，所以六个端点
// 一次写全，而不是"这一轮用得到哪个写哪个"。分两轮写的代价不是多敲几行，而是第二轮
// 的人**大概率不会回来读这一轮的约定**，于是 `init` 会被再写一份（形状略有不同）。
// ————————————————————————————————————————————————————————————————

/**
 * `GET /api/system/init-status` —— 冷启动首屏据此决定是否进初始化向导（F21-8）。
 *
 * ⚠️ 它**顺带带回上次出网检测的结果**（`lastConnectivityCheck`），进向导时直接渲染历史
 * 结果、不重跑检测。别在向导挂载时又打一次 `/diagnose`：那会让"打开设置看一眼"变成
 * 一次 5 秒的探测。
 */
export async function getInitStatus(): Promise<InitStatusDto> {
  const { data, error, response } = await apiClient.GET('/api/system/init-status');
  return unwrap(data, error, response);
}

/**
 * `POST /api/system/init` —— **一次性**放行：跑一轮出网检测 + 存代理 + 写 `initialized=true`。
 *
 * ⚠️ 已初始化时后端回 **409**，这不是"要重试的错误"而是"这件事已经做过了"。调用方拿到
 * `ApiErrorException` 后应当去读一次 `getInitStatus()` 把界面同步过来，⛔ 不要 retry
 * （mutation 侧 `retry: 0`）。
 *
 * ⚠️ `acknowledgeOffline` 是**用户的显式确认**（"我知道外网不通，仍然继续"），不是前端
 * 可以替他填的默认值——填了它，一台真的连不上 registry 的机器会静默通过初始化，
 * 然后在第一个 Task 上炸（P21-8）。
 */
export async function init(body: InitRequestDto): Promise<InitStatusDto> {
  const { data, error, response } = await apiClient.POST('/api/system/init', { body });
  return unwrap(data, error, response);
}

/** `GET /api/system/settings` —— 运行期配置（代理 / 公开地址 / 版本）。⛔ 永不含口令 hash。 */
export async function getSettings(): Promise<SystemSettingsDto> {
  const { data, error, response } = await apiClient.GET('/api/system/settings');
  return unwrap(data, error, response);
}

/**
 * `PUT /api/system/settings` —— **只存配置、不放行**。
 *
 * ⚠️ 三态字段：`null` = 清空、缺席 = 不改、有值 = 改成这个。⛔ 调用方不许把"用户没动它"
 * 翻译成 `null`——那会在用户改公开地址时把代理配置一起清空，而界面上没有任何迹象。
 */
export async function putSettings(body: UpdateSystemSettingsDto): Promise<SystemSettingsDto> {
  const { data, error, response } = await apiClient.PUT('/api/system/settings', { body });
  return unwrap(data, error, response);
}

/** `GET /api/system/resources` —— CPU / RAM / 磁盘水位 + 保留卷占用 + 活跃 Task 数。 */
export async function getResources(): Promise<SystemResourcesDto> {
  const { data, error, response } = await apiClient.GET('/api/system/resources');
  return unwrap(data, error, response);
}

/**
 * `GET /api/system/providers` —— **运维看板**：健康与最近 1h 失败率。
 *
 * ⚠️ **不是 `GET /api/providers`**（那条是建 Task 时的能力发现，`providerKeys.list()`，
 * 5min staleTime，只有 `name/capabilities/isDefault`）。合并会让"建任务"这条主链路的
 * 请求顺带扫一遍 sandboxes 表算失败率（15 §2.1）。
 */
export async function getProviders(): Promise<SystemProvidersDto> {
  const { data, error, response } = await apiClient.GET('/api/system/providers');
  return unwrap(data, error, response);
}

/** 六个 REST 端点共用的收尾：非 2xx ⇒ 抛信封，2xx ⇒ 返回已收窄的 data。 */
function unwrap<T>(data: T | undefined, error: unknown, response: Response): T {
  if (!response.ok || data === undefined) {
    throw new ApiErrorException(toApiError(error, response.status), response.status);
  }
  return data;
}

// ————————————————————————————————————————————————————————————————
// `POST /api/system/diagnose` —— SSE 逐项流（技术 02 §5.3 / F21-5 §5、§5A）
//
// ⚠️ **传输细节到此为止。** 对外暴露的是「逐项回调」：`onStart` / `onCheck` / `onDone`。
// container 与 view 拿不到 `Response`、拿不到 `ReadableStream`、也不知道判别键叫 `event`
// （F21-5 §5 明写"container 与 view 不感知传输细节"）。这不是洁癖：诊断的传输方式在
// 三个月里换过两次口径（WS → SSE），每一次换掉的都只该是这一个函数。
//
// ⚠️ **为什么不用 `EventSource`**：它只能发 GET、不能带 body，而这个端点是 POST
// （后端注释里写明了同一条理由）。所以走 `fetch` + `ReadableStream`，读的是帧体里那个
// 与 `event:` 行**刻意重复**的 `event` 字段。
//
// ⚠️ **前端不自行计时**（F21-5 §7.1 ②）：单项 5s 超时由后端判定并以一条 `status:'timeout'`
// 的普通结果帧下发。在这里再起一个定时器，会在后端只是慢了 200ms 的时候把一项标成超时，
// 而紧接着真正的结果帧到达——同一项先超时后成功，用户看到的是一次闪烁。
// ————————————————————————————————————————————————————————————————

/**
 * 流没有正常收尾（没收到 `done` 帧就断了）。
 *
 * ⚠️ 它**不清空已到达的项**：调用方捕获后应保留已有结果 + 显示「诊断中断 [重新诊断]」
 * （F21-5 §8）。把已经查出来的七项一起丢掉，等于让一次网络抖动抹掉用户刚拿到的信息。
 */
export class DiagnoseStreamAborted extends Error {
  constructor() {
    super('诊断流在收到汇总帧之前中断了');
    this.name = 'DiagnoseStreamAborted';
  }
}

export interface DiagnoseCallbacks {
  /** 首帧：八项清单 + 单项超时预算。**照它渲染占位**，不要用本地 `DIAGNOSE_CHECK_IDS`。 */
  onStart: (frame: DiagnoseStartFrame) => void;
  /** 逐项结论。到达顺序 ≠ 展示顺序，归位由上层按 `id` 做。 */
  onCheck: (frame: DiagnoseCheckFrame) => void;
  /** 汇总帧 = 整轮结束。 */
  onDone: (frame: DiagnoseDoneFrame) => void;
  /**
   * 响应头 `X-Schema-Hash` 与本仓认识的对不上。
   *
   * ⚠️ **它是告知不是门**（`sse-protocol.ts`）：诊断的使用场景是「系统好像坏了」，
   * 此时因为版本不匹配而中断一次只读诊断，等于在最需要它的时候把它关掉。所以这里只回调，
   * 流照常消费、认得的帧照常渲染。
   */
  onSchemaMismatch?: (serverHash: string) => void;
}

/**
 * 跑一轮诊断，逐项回调。**`signal` 用于取消**（离开页面 / 重入时掐掉上一条流）。
 *
 * 正常结束（收到 `done`）时**主动关闭连接**，不留悬挂的读取器（F21-5 §7.1 ④）。
 */
export async function diagnose(cb: DiagnoseCallbacks, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/system/diagnose`, {
    method: 'POST',
    // 口令门（11 §3.1）：同 `apiClient` 的 `credentials: 'include'`。
    credentials: 'include',
    headers: { Accept: 'text/event-stream' },
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    // 失败路径回的是 JSON 错误信封，不是流。
    const body: unknown = await response.json().catch(() => undefined);
    throw new ApiErrorException(toApiError(body, response.status), response.status);
  }

  const serverHash = response.headers.get('X-Schema-Hash');
  if (serverHash !== null && serverHash !== SSE_DIAGNOSE_SCHEMA_HASH) {
    cb.onSchemaMismatch?.(serverHash);
  }

  const body = response.body;
  if (body === null) throw new DiagnoseStreamAborted();

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;

  try {
    while (!sawDone) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      // SSE 的帧分隔是空行。⚠️ 只在**看到分隔符**时才解析：一帧被 TCP 切成两个 chunk 是
      // 常态，按 chunk 解析会把半个 JSON 喂给 parser，表现为随机丢帧（且本机复现不了）。
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const frame = parseDiagnoseFrame(raw);
        if (frame !== null) {
          dispatchDiagnoseFrame(frame, cb);
          if (frame.event === 'done') {
            sawDone = true;
            break;
          }
        }
        sep = buffer.indexOf('\n\n');
      }
    }
  } finally {
    // 正常收尾也走这里：`cancel()` 之后连接立刻释放，不留悬挂的读取器。
    //
    // ⚠️ **不 `await` 它**：流里还剩着未读分片时（收到 `done` 之后后端又发了什么、
    //    或最后一批分片还在缓冲区），`cancel()` 返回的 Promise 可能要等到底层管道排空
    //    才 settle —— 等它，就把"已经拿到全部结论"的调用方多挂在那里几秒。
    //    取消动作本身是同步发出的，这里只是不关心它什么时候落地。
    void reader.cancel().catch(() => undefined);
  }

  if (!sawDone) throw new DiagnoseStreamAborted();
}

/**
 * 一段 SSE 记录 → 一帧。**认不出来就丢掉这一帧，不掀桌子。**
 *
 * ⚠️ 这条容错与 `errorCode` 按开放集合读是同一条纪律的两半：后端多发一种帧、或某一帧多
 * 一个前端不认识的字段（zod 默认剥掉多余键，不报错），都不该让**这一轮诊断**归零。
 * 掉帧不静默——经 `reportError` 落到单一上报点。
 */
function parseDiagnoseFrame(raw: string): DiagnoseServerFrame | null {
  const data = raw
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    // `event:` 行留给 EventSource 那条消费路径；这里读帧体里的 `event` 字段。
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n');
  if (data === '') return null;

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    reportError('诊断 SSE 帧不是合法 JSON', { raw });
    return null;
  }
  const parsed = DiagnoseServerFrameSchema.safeParse(json);
  if (!parsed.success) {
    reportError('诊断 SSE 帧不符合契约，已跳过该帧', { raw });
    return null;
  }
  return parsed.data;
}

function dispatchDiagnoseFrame(frame: DiagnoseServerFrame, cb: DiagnoseCallbacks): void {
  switch (frame.event) {
    case 'start':
      cb.onStart(frame);
      return;
    case 'check':
      cb.onCheck(frame);
      return;
    case 'done':
      cb.onDone(frame);
      return;
  }
}
