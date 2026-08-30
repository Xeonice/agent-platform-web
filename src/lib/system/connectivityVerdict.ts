// Step1「出网可达性」的判定与视图模型（F21-8 §7.1 `lib/connectivityVerdict.ts`）。
//
// ⚠️ **两条纪律，每一条都对应一个"页面看起来完全正常"的错误写法：**
//
//  ① **离线判定只看 `modelApi === true` 的那几行。** 把镜像仓库一起算进去，一台只是内网
//     镜像站没配好、模型 API 一路通畅的机器会被告知「当前为离线环境，Agent 将不可用」
//     —— 而它的 Agent 从来就是可用的。反过来（把镜像仓库的失败当成"部分失败"）才是对的：
//     那只影响拉新镜像。后端 `initialization.service.ts::assertOfflineAcknowledged` 用的是
//     同一条判定，两边必须同口径，否则用户会在 [确认，开始使用] 上收到一个界面里从没提过的 409。
//
//  ② **这份结果必须带着它的时刻。** §4 要求「进向导直接渲染历史结果、不重跑检测」——
//     对的，但没有 `lastConnectivityCheckAt` 就没人知道那份结果是三秒前还是三周前的。
//     「代理昨天刚配好」和「三周前测的、之后网络换过」是完全不同的两件事，而它们在界面上
//     长得一模一样。
import { z } from 'zod';
import { formatRelativePast } from '@/lib/_shared/formatTime';
import type {
  ConnectivityCheckModel,
  ConnectivityResultDto,
  ConnectivityRowModel,
  ConnectivityVerdict,
} from '@/types/init';

/**
 * 整轮结论。
 *
 * - `offline`：**存在模型 API 目标，且它们全不可达**（无论镜像仓库如何）。
 * - `ok`：一条都没失败。
 * - `partial`：其余（典型：只有镜像仓库挂了）。
 *
 * ⚠️ 一条结果都没有时返回 `'ok'`：这是**故意的兜底**——「没测过」不是「测出来是坏的」。
 * 调用方用 `hasResult` 区分"没测过"，不要靠 verdict 反推（`connectivityCheckModel` 会给）。
 */
export function connectivityVerdict(rows: readonly ConnectivityResultDto[]): ConnectivityVerdict {
  const modelApis = rows.filter((r) => r.modelApi);
  // ⚠️ `modelApis.length > 0` 不可省：一份不含任何模型 API 目标的结果说明不了"离线"，
  //    它只是没测那一类（后端同一条判定里也写着这个前置）。
  if (modelApis.length > 0 && modelApis.every((r) => !r.ok)) return 'offline';
  if (rows.every((r) => r.ok)) return 'ok';
  return 'partial';
}

const VERDICT_TEXT: Readonly<Record<ConnectivityVerdict, string>> = {
  ok: '出网正常：模型 API 与镜像仓库均可达。',
  // ⚠️ 这一句必须说清"哪一半好着"：用户看到黄灯的第一反应是"是不是 Agent 用不了了"。
  partial: '部分目标不可达 —— 模型 API 仍可达，Agent 可用；不可达的那几项按下方提示配置代理。',
  offline:
    '当前为离线环境，Agent 将不可用 —— codex / claude code 必须能访问各自的模型 API，这是物理约束，不是配置问题。平台其余功能（项目管理、凭证与镜像配置、系统诊断）照常可用。',
};

function rowModel(row: ConnectivityResultDto): ConnectivityRowModel {
  return {
    id: row.target,
    target: row.target,
    modelApi: row.modelApi,
    ok: row.ok,
    // ⚠️ 两类必须在界面上分得开：离线判定只看前者，用户得看得出"报红的这条属于哪一类"。
    kindText: row.modelApi ? '模型 API' : '镜像仓库',
    stateText: row.ok
      ? row.latencyMs === undefined
        ? '可达'
        : `可达 · ${String(Math.round(row.latencyMs))}ms`
      : '不可达',
    ...(row.hint === undefined ? {} : { hint: row.hint }),
  };
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
  /** true = 这份来自 `init-status` 的历史；false = 本轮 `/diagnose` 刚跑出来的。 */
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
    verdictText:
      rows.length === 0 ? '尚未检测过出网可达性。' : VERDICT_TEXT[connectivityVerdict(rows)],
    ...(checkedAtText === undefined ? {} : { checkedAtText }),
    fromHistory: input.fromHistory,
    hasResult: rows.length > 0,
  };
}
