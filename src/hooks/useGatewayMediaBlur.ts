import { useState } from '../lib/teact/teact';

import { getBlurImagesGeneration } from '../util/telegramGateway';
import useDerivedState from './useDerivedState';
import useLastCallback from './useLastCallback';

// Privacy blur controlled by the platform's "Blur images" toggle (see `telegram-fork-blur-images.md`).
// Revealing is local to one media; a new generation (toggle re-enabled) hides it again.
export default function useGatewayMediaBlur() {
  const generation = useDerivedState(getBlurImagesGeneration);
  const [revealedGeneration, setRevealedGeneration] = useState<number>();

  const isMediaBlurred = generation !== 0 && generation !== revealedGeneration;

  const revealMedia = useLastCallback(() => {
    setRevealedGeneration(generation);
  });

  return { isMediaBlurred, revealMedia };
}
