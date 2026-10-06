import { useEffect, useRef } from 'react';

export function useImageCardLocation(
  highlightedImageId: string | null,
  cards: readonly { imageId: string }[],
) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const focusedImageId = useRef<string | null>(null);
  useEffect(() => {
    if (highlightedImageId === null) {
      focusedImageId.current = null;
      return;
    }
    if (highlightedImageId === focusedImageId.current) return;
    const card = cardRefs.current.get(highlightedImageId);
    if (card === undefined) return;
    const scroll: unknown = Reflect.get(card, 'scrollIntoView');
    if (typeof scroll === 'function')
      Reflect.apply(scroll, card, [{ block: 'center', behavior: 'smooth' }]);
    card.focus({ preventScroll: true });
    focusedImageId.current = highlightedImageId;
  }, [highlightedImageId, cards]);
  return cardRefs;
}
