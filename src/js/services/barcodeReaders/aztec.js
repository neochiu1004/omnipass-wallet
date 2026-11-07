import AztecReader from '@zxing/library/esm/core/aztec/AztecReader';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

import { createBrowserReader } from './base.js';

export function createReader(formats = [BarcodeFormat.AZTEC]) {
  return createBrowserReader(new AztecReader(), formats);
}
