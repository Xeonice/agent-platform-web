import { useCallback, useEffect, useRef, useState } from 'react';
import {
  encodeDismissal,
  localNaturalDate,
  readDismissal,
  upgradeReminderKey,
} from '@/lib/system/upgradeReminderPreference';

function storedDate(key: string): string | null {
  try {
    return readDismissal(localStorage.getItem(key));
  } catch {
    return null;
  }
}
export function useUpgradeReminder(
  instanceId: string | null,
  userScope: string | null,
  check: () => Promise<boolean>,
) {
  const key =
    instanceId === null || userScope === null ? null : upgradeReminderKey(instanceId, userScope);
  const [preference, setPreference] = useState<{
    key: string;
    date: string;
    dismissed: boolean;
  } | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    if (key === null) return;
    let live = true;
    let needsVerification = false;
    let checking = false;
    let date = localNaturalDate(new Date());
    const read = () => {
      const current = localNaturalDate(new Date());
      if (live) setPreference({ key, date: current, dismissed: storedDate(key) === current });
    };
    read();
    const verify = async () => {
      if (checking) return;
      checking = true;
      const current = localNaturalDate(new Date());
      if (current !== date) {
        date = current;
        setPreference(null); // No reminder based on last night's cached release.
      }
      try {
        const verified = await checkRef.current();
        needsVerification = !verified;
        if (live && verified) read();
      } catch {
        needsVerification = true;
      } finally {
        checking = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void verify();
    };
    const onFocus = () => {
      void verify();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) read();
    };
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel('ap.upgrade-reminders.v1');
    channelRef.current = channel;
    if (channel !== null)
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        if (
          typeof message !== 'object' ||
          message === null ||
          !('key' in message) ||
          message.key !== key ||
          !('value' in message) ||
          typeof message.value !== 'string'
        )
          return;
        const dismissed = readDismissal(message.value);
        const current = localNaturalDate(new Date());
        if (dismissed === current) setPreference({ key, date: current, dismissed: true });
      };
    const timer = setInterval(() => {
      if (needsVerification || date !== localNaturalDate(new Date())) void verify();
    }, 60_000);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      channel?.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
  }, [key]);
  const dismiss = useCallback(() => {
    if (key === null) return;
    const date = localNaturalDate(new Date());
    const value = encodeDismissal(date);
    setPreference({ key, date, dismissed: true });
    try {
      localStorage.setItem(key, value);
    } catch {
      /* This tab still honors the user's choice. */
    }
    channelRef.current?.postMessage({ key, value });
  }, [key]);
  return {
    dismiss,
    showNotice:
      key !== null &&
      preference?.key === key &&
      preference.date === localNaturalDate(new Date()) &&
      !preference.dismissed,
  };
}
