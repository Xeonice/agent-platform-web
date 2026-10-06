import { useEffect, useRef } from 'react';
import type { RuntimeCredentialCardModel, RuntimeAuthMethod } from '@/types/runtimeCredential';

export function useCredentialLocation(
  cards: RuntimeCredentialCardModel[],
  reauth: (id: string, method: RuntimeAuthMethod) => void,
) {
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    const url = new URL(window.location.href);
    if (url.hash === '#git-credentials' || url.searchParams.get('section') === 'git') {
      document.getElementById('git-credentials')?.scrollIntoView({ block: 'start' });
      consumed.current = true;
      return;
    }
    const runtimeId = url.searchParams.get('runtime');
    if (runtimeId === null || url.searchParams.get('reauth') !== 'account') return;
    const card = cards.find((item) => item.runtimeId === runtimeId);
    const row = card?.rows.find((item) => item.mode === 'account');
    if (card === undefined || row === undefined) return;
    consumed.current = true;
    reauth(runtimeId, row.method);
    requestAnimationFrame(() =>
      document
        .getElementById(`runtime-auth-panel-${runtimeId}`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }, [cards, reauth]);
}
