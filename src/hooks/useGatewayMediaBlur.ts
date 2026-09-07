import { useState } from '../lib/teact/teact';

import { getBlurImagesGeneration } from '../util/telegramGateway';
import useDerivedState from './useDerivedState';
import useLastCallback from './useLastCallback';

// Privacy blur controlled by the platform's "Blur images" toggle (see `telegram-fork-blur-images.md`).
// Revealing is local to one media and can be undone; a new generation (toggle re-enabled) hides it again.
export default function useGatewayMediaBlur() {
  const generation = useDerivedState(getBlurImagesGeneration);
  const [revealedGeneration, setRevealedGeneration] = useState<number>();

  const isBlurEnabled = generation !== 0;
  const isMediaBlurred = isBlurEnabled && generation !== revealedGeneration;

  const toggleMediaBlur = useLastCallback(() => {
    setRevealedGeneration(isMediaBlurred ? generation : undefined);
  });

  return { isBlurEnabled, isMediaBlurred, toggleMediaBlur };
}
