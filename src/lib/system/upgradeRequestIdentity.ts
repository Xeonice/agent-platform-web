/** A request id has no authority. It only identifies one explicit user's intent. */
export function newUpgradeRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP IP deployments where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function upgradePendingKey(instanceId: string, userScope: string): string {
  return `ap.upgrade-request.v1:${encodeURIComponent(instanceId)}:${encodeURIComponent(userScope)}`;
}
export function readPendingRequest(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('version' in value) ||
      value.version !== 1 ||
      !('requestId' in value) ||
      typeof value.requestId !== 'string'
    )
      return null;
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value.requestId,
    )
      ? value.requestId
      : null;
  } catch {
    return null;
  }
}
