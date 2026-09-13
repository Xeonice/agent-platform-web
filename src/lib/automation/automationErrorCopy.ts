// 自动化端点的错误码 → 人话（`lib/_shared/errorCopy` 的自动化那一张表）。
//
// ★ **这几条是全仓最不该直通用户的英文**，而它们此前一字不改地上了屏
//   （`useAutomations.ts` 对非 404/409 一律 `return error.envelope.message`）：
//
//     timezone 'UTC+8' is not an IANA time zone name (I-AUT-9). Fixed-offset spellings
//       like 'UTC+8' are rejected on purpose: they cannot express daylight saving, …
//     timeout must be one of 30/60/120/240 minutes (I-AUT-5), got 90
//     webhook host 'x' resolves to 10.0.0.5, refused by the SSRF policy (deny-private).
//       Private ranges are allowed only when the access passcode is enabled (11 §3.1 / 审计 P2-12).
//
//   三条里有内部不变量编号、有一段解释设计取舍的英文散文、有一句只有读过 11 §3.1 的人
//   才懂的条件。它们都是**对的**，只是写给别人的。
//
// ⚠️ 这张表**不重复后端那段解释**，只留用户能照着做的那一步：
//   时区 → 挑一个城市名；超时 → 从四档里选；webhook → 换一个公网可达的地址。
//   ⛔ 但也不许把"为什么"整段删掉再改成一句"格式不对" —— 用户会以为是自己拼错了字母，
//     而 `UTC+8` 拼得完全正确，被拒的理由是它表达不了夏令时。那半句得留着。
import { describeErrorCode } from '@/lib/_shared/errorCopy';

export const AUTOMATION_ERROR_COPY: Readonly<Record<string, string>> = {
  INVALID_TIMEZONE:
    '这个时区名用不了。请选一个城市写法的时区（例如 Asia/Shanghai）—— 像 UTC+8 这样的固定偏移写法表达不了夏令时，规则会在换季时跑错点。',
  INVALID_TIMEOUT: '最长运行时间只能从给定的几档里选（30 分钟 / 1 小时 / 2 小时 / 4 小时）。',
  INVALID_SCHEDULE: '这条规则的时间设置不完整或不合法，检查一下时间和星期再保存。',
  INVALID_WEBHOOK_URL: 'Webhook 地址填得不对：要是一个完整的 http:// 或 https:// 地址。',
  HOST_NOT_ALLOWED:
    'Webhook 地址指向的是内网地址，出于安全没有放行。换一个公网能访问到的地址；如果确实要发到内网，需要先给这台机器开启访问口令。',
  AUTOMATION_LIMIT_REACHED: '这个项目的自动化规则已经到上限了。先删掉一条旧规则，再加新的。',
  NOT_FOUND: '这条规则已经不在了（可能在别处被删掉了）。',
  PROJECT_NOT_FOUND: '这个项目已经不在了（可能在别处被删掉了）。',
  INVALID_STATE: '这条规则现在的状态不允许这个操作，刷新一下看看它是不是在别处被改过了。',
  // webhook 测试连接那条路复用同一张表（`testWebhook` 把 200 里的失败也包成信封抛出来）。
  UPSTREAM_UNAVAILABLE: '发过去了，但对方没有正常回应。确认一下这个地址现在能不能收。',
  TIMEOUT: '发过去之后对方一直没回应（超时）。确认一下这个地址现在能不能收。',
};

export function automationErrorMessage(
  code: string | undefined,
  traceId: string | undefined,
  fallback: string,
): string {
  return describeErrorCode(code, { overrides: AUTOMATION_ERROR_COPY, fallback, traceId });
}
