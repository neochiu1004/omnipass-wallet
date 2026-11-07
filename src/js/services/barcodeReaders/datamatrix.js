import DataMatrixReader from '@zxing/library/esm/core/datamatrix/DataMatrixReader';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

import { createBrowserReader } from './base.js';

export function createReader(formats = [BarcodeFormat.DATA_MATRIX]) {
  return createBrowserReader(new DataMatrixReader(), formats);
}
