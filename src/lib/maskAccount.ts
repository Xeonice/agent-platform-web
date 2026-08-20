// 掩码 + 搜索匹配口径（F21-3 §7.1/§9 #8，可单测）。零副作用。
// 掩码不可被反推：任何输入下输出长度 ≤ 输入且不含中间原文；搜索只命中「可见部分」，不匹配被遮蔽的中间段
//（搜完整邮箱反而不命中，这是有意的——掩码不该被反推，P21-3 §6）。

/** 邮箱掩码：a***@gmail.com（保留首字符 + 域名，中间遮蔽）。 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return maskGeneric(email);
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, 1);
  return `${head}***${domain}`;
}

/** key 掩码：sk-...ab12（保留前缀 + 末 4 位）。 */
export function maskKey(key: string): string {
  if (key.length <= 6) return maskGeneric(key);
  const prefixEnd = key.indexOf('-');
  const prefix = prefixEnd > 0 ? key.slice(0, prefixEnd + 1) : key.slice(0, 3);
  return `${prefix}...${key.slice(-4)}`;
}

function maskGeneric(value: string): string {
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value.slice(0, 1)}***`;
}

/**
 * 搜索是否命中：匹配 runtime 名 + 掩码标识的**可见部分**（大小写不敏感）。
 * 掩码里的遮蔽符（* 与 …/...）不参与匹配，故搜被遮蔽的中间段不命中（掩码不该被反推）。
 */
export function matchesRuntimeSearch(
  query: string,
  displayName: string,
  maskedIdentifier: string | undefined,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (displayName.toLowerCase().includes(q)) return true;
  if (maskedIdentifier === undefined) return false;
  // 只保留掩码里的可见字符（去掉遮蔽段），逐可见片段匹配。
  const visibleSegments = maskedIdentifier
    .toLowerCase()
    .split(/\*+|\.{3}|…/)
    .filter((seg) => seg !== '');
  return visibleSegments.some((seg) => seg.includes(q));
}
