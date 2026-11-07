import QRCodeReader from '@zxing/library/esm/core/qrcode/QRCodeReader';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';

import { createBrowserReader } from './base.js';

export function createReader(formats = [BarcodeFormat.QR_CODE]) {
  return createBrowserReader(new QRCodeReader(), formats);
}
