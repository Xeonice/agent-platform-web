// 无头 Task 的 REST 侧（15 §1：服务端资源 → Query；非幂等操作 → mutation，不自动重试）。
// **本切片零轮询**：任务列表只在三个时刻取——挂载（含刷新恢复）、发起成功、收到 WS exit。
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  cancelAgentTask,
  fetchTaskArtifact,
  listAgentTasks,
  runAgentTask,
} from '@/services/api/task.service';
import { ApiErrorException } from '@/services/api/apiError';
import { describeDownloadProgress, describeTaskErrorCode } from '@/lib/task/taskOutcome';
import { isTerminalTaskStatus, type AgentTaskDto, type RunAgentTaskInput } from '@/types/task';
// 只为把 `window.showSaveFilePicker` 的全局声明拉进本模块的类型视野（值层面是空 import）。
import type {} from '@/types/fileSystemAccess';

/** 任务 query key 族（15 §2.1）。与 sandboxKeys 分开：任务是沙箱下的独立资源。 */
export const taskKeys = {
  all: () => ['tasks'] as const,
  list: (sandboxId: string) => [...taskKeys.all(), 'list', sandboxId] as const,
};

/** POST 202 发起无头任务。mutation 不自动重试（15 §2.4：非幂等，重试会跑出两个任务）。 */
export function useRunAgentTask(
  sandboxId: string,
  runtime: string,
): UseMutationResult<AgentTaskDto, Error, RunAgentTaskInput> {
  return useMutation<AgentTaskDto, Error, RunAgentTaskInput>({
    mutationFn: (input) => runAgentTask(sandboxId, runtime, input),
  });
}

/** 终止任务（两阶段强杀）。202 只表示"请求已受理"，终态由 /tasks 的 exit 帧宣告。 */
export function useCancelAgentTask(
  sandboxId: string,
): UseMutationResult<AgentTaskDto, Error, string> {
  return useMutation<AgentTaskDto, Error, string>({
    mutationFn: (taskId) => cancelAgentTask(sandboxId, taskId),
  });
}

export interface AgentTaskListView {
  tasks: readonly AgentTaskDto[];
  isPending: boolean;
  isError: boolean;
}

/**
 * 沙箱下的任务列表（startedAt 倒序）——**刷新恢复的权威来源**。
 *
 * `staleTime: Infinity` + 关掉 focus/reconnect 自动重取 = **明确不轮询**：
 * 进展全部由 /tasks WS 推，列表只在发起成功 / 收到 exit 时显式 invalidate。
 */
export function useAgentTaskList(sandboxId: string): AgentTaskListView {
  const query = useQuery({
    queryKey: taskKeys.list(sandboxId),
    queryFn: () => listAgentTasks(sandboxId),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return { tasks: query.data ?? [], isPending: query.isPending, isError: query.isError };
}

/**
 * 用列表**校验**持久化的 taskId，得出真正该跟踪的那一个。
 *
 * 纪律：persist 只是快路径，列表才是权威。
 *  · 持久 id 在列表里 ⇒ 用它（刷新恢复的正常路径）；
 *  · 持久 id 不在列表里（已被清理）⇒ 视为无效，回落；
 *  · 回落只挑**仍在跑**的那个任务——自动把一个几天前跑完的任务顶到面板上不是"恢复"，是打扰。
 */
export function reconcileTaskId(
  persistedId: string | null,
  tasks: readonly AgentTaskDto[],
): string | null {
  if (persistedId !== null && tasks.some((t) => t.id === persistedId)) return persistedId;
  return tasks.find((t) => !isTerminalTaskStatus(t.status))?.id ?? null;
}

/** object URL 的延迟撤销窗口（见回退路径里的注释）。 */
export const OBJECT_URL_REVOKE_DELAY_MS = 1000;

/** 下载进度（字节数是权威，人话由 lib 派生）。 */
export interface TaskDownloadProgress {
  receivedBytes: number;
  /** 响应带 `content-length` 时才有；缺席 ⇒ 只报"已下载多少"，不猜百分比。 */
  totalBytes?: number;
}

export interface TaskArtifactDownload {
  /** 触发一次产物下载（流式落盘，回退 blob）。 */
  download: (name: string) => void;
  /** 正在下载的产物名（同一时间只允许一个，避免连点起多条流）。 */
  downloadingName: string | null;
  /** 进度人话；undefined = 还没有可显示的进度（回退路径全程都是 undefined）。 */
  progressLabel?: string;
  error: Error | null;
}

/** `content-length` → 字节数；缺失/不是正整数 ⇒ undefined（降级成不显示进度）。 */
function readContentLength(response: Response): number | undefined {
  const raw = response.headers.get('content-length');
  if (raw === null) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** 用户在存盘对话框上点了取消 —— 这是**正常路径**，不是错误。 */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 把响应体一路管到磁盘句柄，边写边报进度。**整条链上没有一处持有完整内容**。
 * 写失败时 abort 而不是 close：close 才是"提交这个文件"，半截内容不该被当成完整产物落地。
 *
 * 形参写成 `Uint8Array<ArrayBuffer>`（而不是默认的 `ArrayBufferLike`）是为了对上
 * `FileSystemWriteChunkType` 里的 `BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer`——
 * 网络响应的分片永远不会落在 SharedArrayBuffer 上，这里只是把这件事说给 tsc 听，
 * 而不是靠断言绕过去。
 */
async function pipeToDisk(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  writable: FileSystemWritableFileStream,
  totalBytes: number | undefined,
  onProgress: (progress: TaskDownloadProgress) => void,
): Promise<void> {
  const reader = body.getReader();
  let receivedBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      await writable.write(chunk.value);
      receivedBytes += chunk.value.byteLength;
      onProgress({
        receivedBytes,
        ...(totalBytes === undefined ? {} : { totalBytes }),
      });
    }
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
}

/** 回退存盘：一次性 object URL + 合成 <a download>。整个产物会进内存 —— 这正是它是回退的原因。 */
function saveViaObjectUrl(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // ⚠️ **不能紧跟 click() 撤销**：部分浏览器此刻还没真正开始读这个 object URL，
  // 当场 revoke 会把下载打断。惯例是推到下一拍再撤（内存也就多占这一会儿）。
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_REVOKE_DELAY_MS);
}

/**
 * 产物下载。**两条路径，一条纪律**：
 *
 *  · **流式落盘**（支持 `showSaveFilePicker` 的浏览器）：`response.body` 直接管进磁盘句柄，
 *    几百 MB 的产物一个字节都不进堆。老写法 `response.blob()` 是全量入内存 —— 大产物
 *    足以把标签页拖垮，而且它拖垮的时机恰好是任务终于跑完、用户最想拿到结果的时候。
 *  · **回退**（Safari / 老 Chromium / 非安全上下文）：仍走 blob + object URL，行为与从前一致。
 *
 * 两条路径共用的纪律 —— **始终是带凭据的 fetch，绝不退回裸 `<a href>` 直链**：产物端点同样
 * 受口令门保护，而跨源下载导航未必带上 SameSite cookie ⇒ 直链在启用口令门后会静默 401
 * （service 层注释详述）。流式路径把"取数据"和"选位置"分开，恰恰让这条纪律更容易守住。
 *
 * ⚠️ **存盘对话框必须先于 fetch 打开**：`showSaveFilePicker` 要求 transient user activation
 * （用户手势后约 5 秒内有效）。先 await 网络再弹框，慢一点的响应就会让它抛
 * `SecurityError: Must be handling a user gesture` —— 而且是**偶发**的那种。
 * 顺带的好处：用户取消时一个字节都没下过。
 */
export function useTaskArtifactDownload(
  sandboxId: string,
  taskId: string | null,
): TaskArtifactDownload {
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [progress, setProgress] = useState<TaskDownloadProgress | null>(null);
  const [error, setError] = useState<Error | null>(null);
  /**
   * "同一时间只允许一个下载"的**真正**判据。
   *
   * ⚠️ 不能用 `downloadingName` 这个 state 来判：同一拍里连点两次时，两次调用读到的是
   * **同一份还没更新的闭包值**（React 的 setState 是异步的），于是两条流都起来了。
   * 视图那边的按钮禁用也要等重渲染才生效，救不了这一拍。ref 是同步的，才拦得住。
   */
  const inFlightRef = useRef(false);

  const download = useCallback(
    (name: string): void => {
      if (taskId === null || inFlightRef.current) return;
      inFlightRef.current = true;
      // 在用户手势的这一拍里取到入口（不支持 ⇒ undefined ⇒ 走回退）。
      const picker = typeof window === 'undefined' ? undefined : window.showSaveFilePicker;

      setDownloadingName(name);
      setProgress(null);
      setError(null);

      void (async (): Promise<void> => {
        try {
          let handle: FileSystemFileHandle | undefined;
          if (picker !== undefined) {
            try {
              handle = await picker({ suggestedName: name });
            } catch (err: unknown) {
              // 取消存盘 = 用户改主意了，**不是错误**：不弹红字、不留残留态，安静回到「下载」。
              if (isAbortError(err)) return;
              throw err;
            }
          }

          const response = await fetchTaskArtifact(sandboxId, taskId, name);
          const totalBytes = readContentLength(response);

          if (handle !== undefined) {
            const writable = await handle.createWritable();
            const body = response.body;
            if (body === null) {
              // 环境不给流（少见）：位置是用户选的，就仍旧写进那个句柄，而不是偷偷改存到下载目录。
              await writable.write(await response.blob());
              await writable.close();
              return;
            }
            await pipeToDisk(body, writable, totalBytes, setProgress);
            return;
          }

          saveViaObjectUrl(await response.blob(), name);
        } catch (err: unknown) {
          setError(err instanceof Error ? err : new Error('下载失败'));
        } finally {
          inFlightRef.current = false;
          setDownloadingName(null);
          setProgress(null);
        }
      })();
    },
    [sandboxId, taskId],
  );

  return {
    download,
    downloadingName,
    ...(progress === null ? {} : { progressLabel: describeDownloadProgress(progress) }),
    error,
  };
}

/** 收到 exit 帧 / 发起成功后重取列表（产物列表只有终态才齐）——事件驱动，不是轮询。 */
export function useRefetchTaskList(sandboxId: string): () => void {
  const queryClient = useQueryClient();
  return useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: taskKeys.list(sandboxId) });
  }, [queryClient, sandboxId]);
}

/**
 * 任务侧错误 → 人话（P22 §1：码不是句子）。
 * 放 hook 层是因为 container 不能 import lib（07 §4.1），而人话表住在 lib/taskOutcome。
 *
 * `fallback` 由调用点给：**发起失败 / 终止失败 / 任务结束是三件事**，共用一句话就会出现
 * "点了终止，界面说任务以某原因结束"这种驴唇不对马嘴。
 *
 * 优先级：收录过的码 → 后端 message → 调用点兜底。第二档很要紧：
 * `INVALID_STATE` 这类码后端的句子比任何模板都具体（"sandbox X was provisioned for
 * runtime 'codex', not 'claude-code'"），词表**刻意不收录**它们，就是为了让这句话透出来。
 *
 * ⚠️ **已知缺陷，待产品口径**（记在这里是因为下一个人多半从这里进来）：`fallback` 分了语境，
 * 但**词表没分**——三条路共用 `lib/taskOutcome.ts` 那张**任务终态**表。于是：
 *   · `UNKNOWN_RUNTIME` 走到**发起**路径（后端 `assertRunnable` 在门口就拒）时，用户看到的是
 *     终态表那句"…**本轮无法继续**…重跑同一个 runtime 只会再失败一次"——而**根本没有"本轮"**，
 *     那次发起什么都没创建；
 *   · **终止**路径上，"零副作用"的正确读法是"这次终止**没生效**，任务大概率还在跑"，
 *     不是"什么都没创建"。
 * ⛔ 因此**不要**把 `lib/sandboxErrorCopy` 的 `isZeroSideEffectRejection` /
 * `zeroSideEffectRejectionMessage` 顺手接到这里：那对函数的措辞是**创建语境**专属的，
 * 它的 `context` 参数是必填闭集，接过来要先为新语境写一句自己的话（漏写会 tsc 红）。
 */
export function useTaskErrorMessage(error: Error | null, fallback: string): string | undefined {
  return useMemo(() => {
    if (error === null) return undefined;
    if (error instanceof ApiErrorException) {
      const humanized = describeTaskErrorCode(error.envelope.code);
      if (humanized !== undefined) return humanized;
      return error.envelope.message === '' ? fallback : error.envelope.message;
    }
    return error.message === '' ? fallback : error.message;
  }, [error, fallback]);
}
