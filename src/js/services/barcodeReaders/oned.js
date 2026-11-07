import MultiFormatOneDReader from '@zxing/library/esm/core/oned/MultiFormatOneDReader';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

import { createBrowserReader, createHints } from './base.js';

export function createReader(formats) {
  const hints = createHints(formats);
  return createBrowserReader(new MultiFormatOneDReader(hints), formats);
}

export const DEFAULT_ONE_D_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
];
