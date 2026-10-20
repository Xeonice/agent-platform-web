export const UPGRADE_REMINDER_PREFIX = 'ap.upgrade-reminder.v1:';
export function upgradeReminderKey(instanceId: string, userScope: string): string {
  return `${UPGRADE_REMINDER_PREFIX}${encodeURIComponent(instanceId)}:${encodeURIComponent(userScope)}`;
}
export function localNaturalDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function encodeDismissal(date: string): string {
  return JSON.stringify({ version: 1, dismissedLocalDate: date });
}
export function readDismissal(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('dismissedLocalDate' in parsed) ||
      typeof parsed.dismissedLocalDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.dismissedLocalDate)
    )
      return null;
    const date = new Date(`${parsed.dismissedLocalDate}T12:00:00`);
    return Number.isFinite(date.getTime()) && localNaturalDate(date) === parsed.dismissedLocalDate
      ? parsed.dismissedLocalDate
      : null;
  } catch {
    return null;
  }
}
