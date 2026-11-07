import PDF417Reader from '@zxing/library/esm/core/pdf417/PDF417Reader';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

import { createBrowserReader } from './base.js';

export function createReader(formats = [BarcodeFormat.PDF_417]) {
  return createBrowserReader(new PDF417Reader(), formats);
}
