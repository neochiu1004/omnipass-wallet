import { BrowserCodeReader } from '@zxing/library/esm/browser/BrowserCodeReader';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';

export function createHints(formats) {
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
  return hints;
}

export function createBrowserReader(reader, formats) {
  const hints = createHints(formats);
  const browserReader = new BrowserCodeReader(reader, 500, hints);
  browserReader.timeBetweenDecodingAttempts = 0;
  return browserReader;
}
