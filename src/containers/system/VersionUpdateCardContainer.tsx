'use client';
import { useVersionCardModel } from '@/hooks/system/useVersionCardModel';
import { useVersionCardFocus } from '@/hooks/system/useVersionCardFocus';
import { VersionUpdateCardView } from '@/views/system/VersionUpdateCard.view';
const noop = () => undefined;
export function VersionUpdateCardContainer() {
  const { controller, model } = useVersionCardModel();
  const headingRef = useVersionCardFocus(
    controller?.detailsRequested ?? false,
    controller?.consumeDetailsRequest ?? noop,
  );
  return (
    <VersionUpdateCardView
      model={model}
      busy={controller?.busy ?? false}
      isChecking={controller?.isChecking ?? false}
      commandMessage={controller?.commandMessage ?? null}
      headingRef={headingRef}
      onCheck={() => {
        void controller?.check();
      }}
      onUpgrade={controller?.upgrade ?? noop}
      onRefresh={controller?.refreshPage ?? noop}
      onLater={controller?.later ?? noop}
      onDetails={controller?.openDetails ?? noop}
      authorizationOpen={controller?.authorizationOpen ?? false}
      onAuthorizationOpenChange={controller?.setAuthorizationOpen ?? noop}
      authorizationBusy={controller?.authorizationBusy ?? false}
      authorizationError={controller?.authorizationError ?? null}
      onAuthorize={controller?.authorize ?? noop}
    />
  );
}
