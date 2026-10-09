/** 与 API 别名契约一致：先拒绝原始控制字符，再 trim 并按 Unicode 码点计数。 */
export function validateImageAlias(raw: string): {
  value: string | null;
  count: number;
  error?: string;
} {
  const trimmed = raw.trim();
  const count = Array.from(trimmed).length;
  const value = trimmed === '' ? null : trimmed;
  if (/[\p{Cc}\u2028\u2029]/u.test(raw)) {
    return { value, count, error: '别名不能包含换行或控制字符' };
  }
  if (count > 64) return { value, count, error: '别名最多 64 个字符' };
  return { value, count };
}
