// Webhook URL 校验（P21-7 §7 / 03 §8.5 / F21-7 §7.1）。
//
// ⚠️ **前端这一份只管形状，SSRF 的判定在后端**（03 §8.5：解析目标 IP、环回/链路本地拒绝、
// 私网段按 `automation.webhook.allowPrivateNetwork` + 访问口令是否启用降级）。
// 前端做不了 DNS 解析，也不该假装做得了 —— 把 `10.0.0.1` 在前端拦下来只会让
// **合法的内网 webhook 用不了**（私有化部署里内网 webhook 是主要用法），
// 而真正的绕过（一个解析到内网的公网域名）照样过。⇒ 这里只拦协议与空值。
export type WebhookUrlVerdict = { ok: true } | { ok: false; reason: string };

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

/**
 * @param url      输入框里的原始值（未 trim）。
 * @param enabled  用户是否勾了「启用 webhook 通知」。
 *
 * ★ `enabled === false` 时空 URL 是**合法**的（没启用就没这回事）；
 *   `enabled === true` 时空 URL 必须拒绝保存 —— 否则会存下一条"开着但发不出去"的规则，
 *   而 webhook 的全部价值就在"我不在的时候"，静默失效等于没有通知。
 */
export function validateWebhookUrl(url: string, enabled: boolean): WebhookUrlVerdict {
  const trimmed = url.trim();
  if (!enabled) return { ok: true };
  if (trimmed === '') return { ok: false, reason: '启用了通知就必须填 Webhook URL。' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'URL 格式不正确（需要形如 https://example.com/hook）。' };
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    return { ok: false, reason: '只支持 http / https。' };
  }
  if (parsed.hostname === '') return { ok: false, reason: 'URL 缺少主机名。' };
  return { ok: true };
}

/**
 * 投递纪律的一句说明，直接显示在表单里。
 * ⚠️ 数字取自 P21-7 §7 / 03 §8.5：**超时 10 秒、重试 2 次、退避 5s / 25s**。
 * ⛔ 不是常见的 1s→2s→4s —— F21-7 §9.1 #12 专门点了这一条，写错等于文档白对齐了。
 */
export const WEBHOOK_DELIVERY_NOTE =
  '投递超时 10 秒；失败重试 2 次（间隔 5 秒、25 秒）。两次重试仍失败只记一条投递失败，不影响规则的启用状态。';
