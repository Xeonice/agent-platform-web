import { useEffect, useRef } from 'react';
export function useVersionCardFocus(requested: boolean, consume: () => void) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!requested || headingRef.current === null) return;
    if (typeof headingRef.current.scrollIntoView === 'function')
      headingRef.current.scrollIntoView({ block: 'nearest' });
    headingRef.current.focus({ preventScroll: true });
    consume();
  }, [requested, consume]);
  return headingRef;
}
