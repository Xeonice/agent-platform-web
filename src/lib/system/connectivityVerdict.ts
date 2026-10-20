import { z } from 'zod';
import { formatRelativePast } from '@/lib/_shared/formatTime';
import type {
  ConnectivityCheckModel,
  ConnectivityResultDto,
  ConnectivityRowModel,
  ConnectivityVerdict,
} from '@/types/init';

/**
 * 对声明探测目标的分类，不是 runtime 或任务能力结论。
 * `offline` 仅为初始化显式确认的既有分类：存在模型 API 目标且均明确失败。
 * 空结果由 hasResult 表达未知；超时不当作明确不可达。与后端 ACK 判据保持一致。
 */
export function connectivityVerdict(rows: readonly ConnectivityResultDto[]): ConnectivityVerdict {
  const modelApis = rows.filter((r) => r.modelApi);
  // ⚠️ `modelApis.length > 0` 不可省：一份不含任何模型 API 目标的结果说明不了"离线"，
  //    它只是没测那一类（后端同一条判定里也写着这个前置）。
  if (modelApis.length > 0 && modelApis.every((r) => !r.ok && r.timedOut !== true))
    return 'offline';
  if (rows.every((r) => r.ok)) return 'ok';
  return 'partial';
}

// 诊断没有 target → runtime / credential / provider 的映射，不能推断 Agent 能力。
const VERDICT_TEXT: Readonly<Record<ConnectivityVerdict, string>> = {
  ok: '本次探测目标均通过检查。任务实际连通性以其配置和执行结果为准。',
  partial: '',
  offline: '本次探测的模型 API 目标均未连通。任务实际连通性以其配置和执行结果为准。',
};

function rowModel(row: ConnectivityResultDto): ConnectivityRowModel {
  return {
    id: row.target,
    target: row.target,
    modelApi: row.modelApi,
    ok: row.ok,
    // ⚠️ 两类必须在界面上分得开：离线判定只看前者，用户得看得出"报红的这条属于哪一类"。
    kindText: row.modelApi ? '模型 API' : '镜像下载源',
    // ⚠️ **超时与够不着必须分开说**（2026-09-09 用户质疑后补的）。后端在同一份 DTO 里
    //    给了 `timedOut`，它的 summary 也一直分着写；**只有这一行把两者压成了「不可达」**
    //    —— 于是后端说「未在预算内应答」，用户屏幕上却是一个 ❌ 加「不可达」。
    //    「3.5 秒内没完成握手」证明不了「连不上」，实测同一目标的握手会在 2.3s~10.2s 抖动。
    stateText: row.ok
      ? row.latencyMs === undefined
        ? '连得上'
        : `连得上 · ${String(Math.round(row.latencyMs))}ms`
      : row.timedOut === true
        ? '超时未响应'
        : '连不上',
    ...(row.timedOut === true ? { timedOut: true } : {}),
    ...(row.hint === undefined ? {} : { hint: row.hint }),
  };
}

/** 文案只总结本次目标，不把目标检查推广为整个平台的联网能力。 */
function verdictTextOf(rows: readonly ConnectivityResultDto[]): string {
  if (rows.length === 0) return '暂无探测结果，任务实际连通性待确认。';
  const verdict = connectivityVerdict(rows);
  return verdict === 'partial' ? partialText(rows) : VERDICT_TEXT[verdict];
}

function partialText(rows: readonly ConnectivityResultDto[]): string {
  const failed = rows.filter((r) => !r.ok);
  const modelApis = rows.filter((row) => row.modelApi);
  const hitModelApi = failed.some((r) => r.modelApi);
  const scope = '任务实际连通性以其配置和执行结果为准。';
  const verb = failed.every((r) => r.timedOut === true) ? '超时未响应' : '未通过检查';
  const tail = failed.every((r) => r.timedOut === true) ? '超时不等于连不上。' : '';
  if (modelApis.length > 0 && modelApis.every((row) => row.timedOut === true))
    return `本次探测的模型 API 目标均超时未响应，连通情况待确认。${tail}${scope}`;
  if (modelApis.length === 0)
    return `本次有目标${verb}，没有模型 API 目标的探测结果。${tail}${scope}`;
  if (hitModelApi && !modelApis.some((row) => row.ok))
    return `本次部分模型 API 目标未通过检查，其余超时未响应，连通情况待确认。${scope}`;
  if (!hitModelApi) return `本次探测的模型 API 目标通过检查，有镜像下载源${verb}。${tail}${scope}`;
  return `本次部分模型 API 目标${verb}，其余目标通过检查。${tail}${scope}`;
}

/** `'上次检测：2026-08-29 16:11:34（22 小时前）'`；时刻缺席/不可解析 ⇒ 整行不渲染。 */
export function formatCheckedAt(iso: string | undefined, now: number): string | undefined {
  const relative = formatRelativePast(iso, now);
  if (relative === undefined || iso === undefined) return undefined;
  const at = new Date(iso);
  // 本地时区、去掉毫秒与时区后缀：用户要拿它跟"我什么时候配的代理"对齐，看的是本机时间。
  const local = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  return `上次检测：${local}（${relative}）`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * `/diagnose` 的 `outbound-network` 帧把逐目标结果放在 `detail.results` 里，形状与
 * `init-status` 的 `lastConnectivityCheck[]` **逐字段相同**（后端同一个 `ConnectivityProbe`
 * 的输出）。而 `detail` 在帧契约里是 `Record<string, unknown>`（开放袋），所以这里必须
 * 当场校验再用。
 *
 * ⚠️ **认不出就返回 `undefined`，不掀桌子**（与 `parseDiagnoseFrame` 同一条纪律）：
 * 后端换一种 detail 布局时，向导应当退回"没有本轮结果"（于是继续显示上一份 + 允许重试），
 * 而不是整页崩掉或渲染出一份空的"全部不可达"——后者会把一台好机器报成离线。
 */
const ConnectivityDetailSchema = z.object({
  results: z.array(
    z.object({
      target: z.string(),
      ok: z.boolean(),
      latencyMs: z.number().optional(),
      hint: z.string().optional(),
      modelApi: z.boolean(),
      timedOut: z.boolean().optional(),
    }),
  ),
});

export function connectivityFromDiagnoseDetail(
  detail: Record<string, unknown> | undefined,
): ConnectivityResultDto[] | undefined {
  if (detail === undefined) return undefined;
  const parsed = ConnectivityDetailSchema.safeParse(detail);
  if (!parsed.success) return undefined;
  return parsed.data.results;
}

export interface ConnectivityInput {
  rows: readonly ConnectivityResultDto[] | undefined;
  /** 结果的时刻（ISO）。 */
  checkedAt?: string;
  /** true = 这份来自 `init-status` 的历史；false = `/diagnose` 记录；不表示当前仍新鲜。 */
  fromHistory: boolean;
}

export function connectivityCheckModel(
  input: ConnectivityInput,
  now: number = Date.now(),
): ConnectivityCheckModel {
  const rows = input.rows ?? [];
  const checkedAtText = formatCheckedAt(input.checkedAt, now);
  return {
    rows: rows.map(rowModel),
    verdict: connectivityVerdict(rows),
    verdictText: verdictTextOf(rows),
    ...(checkedAtText === undefined ? {} : { checkedAtText }),
    fromHistory: input.fromHistory,
    hasResult: rows.length > 0,
  };
}
