/** Only display version declarations attached to this immutable image digest. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function declaredVersion(input: unknown, key: string): string {
  if (input === null || typeof input !== 'object' || !Object.hasOwn(input, key)) return '未报告';
  const value: unknown = Reflect.get(input, key);
  return typeof value === 'string' && value.length <= 128 && SEMVER.exec(value)?.[0] === value
    ? value
    : '未报告';
}

/** Missing/unsafe declarations never fall back to tags, supportedRuntimes or host CLI versions. */
export function imageRuntimeVersionsLabel(input: unknown): string {
  return `Codex ${declaredVersion(input, 'codex')} · Claude Code ${declaredVersion(input, 'claude-code')}`;
}
