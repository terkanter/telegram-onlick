import { HEIC_CONTENT_TYPES } from '../../config';
import { createSignal } from '../signals';

// HEIC has no synchronous feature test (`canPlayType` covers media elements only), so support is
// probed once at startup through the WebCodecs registry, which answers for the same system decoder
// that paints an `<img>`. Safari has one, Chrome and Firefox do not. Until the probe settles — and
// wherever it says no — a HEIC document keeps today's behaviour and downloads on click, so the
// check can only ever turn a broken preview into a working one. See `isDocumentPhoto`.

const [getIsHeicSupported, setIsHeicSupported] = createSignal(false);
export { getIsHeicSupported };

// Runs on import so the answer is in place long before the first message list renders
void detectHeicSupport();

async function detectHeicSupport() {
  if (!self.ImageDecoder?.isTypeSupported) return;

  try {
    const results = await Promise.all(
      Array.from(HEIC_CONTENT_TYPES, (mimeType) => ImageDecoder.isTypeSupported(mimeType)),
    );
    setIsHeicSupported(results.some(Boolean));
  } catch {
    // A decoder that throws is a decoder we cannot use
  }
}
