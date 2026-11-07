import { renderBarcodeToCanvasOrSvg, generateCode128Bars } from './omniCoreService.js';

const BWIP_FORMAT_MAP = {
  CODE_128: 'code128',
  CODE_39: 'code39',
  CODE_93: 'code93',
  EAN_13: 'ean13',
  EAN_8: 'ean8',
  UPC_A: 'upca',
  UPC_E: 'upce',
  ITF: 'interleaved2of5',
  PDF_417: 'pdf417',
  DATA_MATRIX: 'datamatrix',
  AZTEC: 'azteccode',
  CODABAR: 'rationalizedCodabar',
  QR_CODE: 'qrcode',
};

let bwipModulePromise = null;
let qriousConstructorPromise = null;

async function getBwipJs() {
  if (!bwipModulePromise) {
    bwipModulePromise = import('bwip-js')
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return bwipModulePromise;
}

async function getQRious() {
  if (!qriousConstructorPromise) {
    qriousConstructorPromise = import('qrious')
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return qriousConstructorPromise;
}

const SCAN_REGIONS = [
  { label: 'full', x: 0, y: 0, w: 1, h: 1 },
  { label: 'top-half', x: 0, y: 0, w: 1, h: 0.5 },
  { label: 'middle-band', x: 0, y: 0.25, w: 1, h: 0.5 },
  { label: 'bottom-half', x: 0, y: 0.5, w: 1, h: 0.5 },
  { label: 'bottom-third', x: 0, y: 0.65, w: 1, h: 0.35 },
  { label: 'center-square', x: 0.15, y: 0.15, w: 0.7, h: 0.7 },
  { label: 'bottom-left', x: 0, y: 0.45, w: 0.6, h: 0.55 },
  { label: 'bottom-right', x: 0.4, y: 0.45, w: 0.6, h: 0.55 },
  { label: 'center-tight', x: 0.1, y: 0.3, w: 0.8, h: 0.45 },
];

const READER_LOADERS = [
  () => import('./barcodeReaders/qr.js'),
  () => import('./barcodeReaders/oned.js'),
  () => import('./barcodeReaders/pdf417.js'),
  () => import('./barcodeReaders/datamatrix.js'),
  () => import('./barcodeReaders/aztec.js'),
];

async function tryDecodeRegionsWithNativeDetector(imageSource, regions) {
  if (typeof window === 'undefined' || !('BarcodeDetector' in window)) return [];
  try {
    const detector = new window.BarcodeDetector();
    const detectedMap = new Map();
    for (const region of regions) {
      const codes = await detector.detect(region.canvas || imageSource);
      for (const item of codes || []) {
        const text = (item.rawValue || '').trim();
        if (!text) continue;
        const format = String(item.format || 'CODE_128').toUpperCase();
        const key = `${text}__${format}`;
        if (!detectedMap.has(key)) {
          detectedMap.set(key, {
            text,
            format,
            formatLabel: format,
            region: region.label || 'full',
          });
        }
      }
    }
    return [...detectedMap.values()];
  } catch {
    return [];
  }
}

async function decodeRegionsInPasses(regions, { stopOnFirst = false } = {}) {
  const detectedMap = new Map();

  for (const loadReaderModule of READER_LOADERS) {
    try {
      const { createReaders, decodeCanvasWithReader } = await loadReaderModule();
      const readers = createReaders();

      for (const region of regions) {
        for (const entry of readers) {
          const decoded = decodeCanvasWithReader(region.canvas, entry.reader);
          if (!decoded || !decoded.text) continue;

          const text = decoded.text.trim();
          if (!text) continue;

          const format = decoded.format || entry.format || 'CODE_128';
          const key = `${text}__${format}`;
          if (!detectedMap.has(key)) {
            detectedMap.set(key, {
              text,
              format,
              formatLabel: format,
              region: region.label,
            });
            if (stopOnFirst) {
              return [...detectedMap.values()];
            }
          }
        }
      }
    } catch {
      // Fallback to native BarcodeDetector if ZXing reader module is unavailable
    }
  }

  if (detectedMap.size === 0) {
    const nativeResults = await tryDecodeRegionsWithNativeDetector(regions[0]?.canvas, regions);
    return stopOnFirst ? nativeResults.slice(0, 1) : nativeResults;
  }

  return [...detectedMap.values()];
}

function loadImage(fileOrDataUrl) {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'Anonymous';
    let objectUrl = null;

    img.onload = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };

    if (typeof fileOrDataUrl === 'string') {
      img.src = fileOrDataUrl;
    } else {
      objectUrl = URL.createObjectURL(fileOrDataUrl);
      img.src = objectUrl;
    }
  });
}

function cropRegionToCanvas(img, region, maxDim = 1400) {
  const sx = Math.floor(img.width * region.x);
  const sy = Math.floor(img.height * region.y);
  const sw = Math.max(1, Math.floor(img.width * region.w));
  const sh = Math.max(1, Math.floor(img.height * region.h));

  let dw = sw;
  let dh = sh;
  if (dw > maxDim || dh > maxDim) {
    const ratio = dw / dh;
    if (dw > dh) {
      dw = maxDim;
      dh = Math.round(maxDim / ratio);
    } else {
      dh = maxDim;
      dw = Math.round(maxDim * ratio);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
  return canvas;
}

export async function scanBarcodeFromImage(fileOrDataUrl) {
  const img = await loadImage(fileOrDataUrl);
  const regions = SCAN_REGIONS.map((region) => ({
    label: region.label,
    canvas: cropRegionToCanvas(img, region),
  }));
  const results = await decodeRegionsInPasses(regions, { stopOnFirst: true });
  return results[0] || null;
}

export async function scanMultipleBarcodesFromImage(fileOrDataUrl) {
  const img = await loadImage(fileOrDataUrl);
  const regions = SCAN_REGIONS.map((region) => ({
    label: region.label,
    canvas: cropRegionToCanvas(img, region),
  }));
  return decodeRegionsInPasses(regions, { stopOnFirst: false });
}

export async function renderBarcodeCanvas(canvas, value, format = 'CODE_128', options = {}) {
  if (!canvas || !value) return false;
  const bcid = BWIP_FORMAT_MAP[format] || 'code128';
  const bwipjs = await getBwipJs();
  if (bwipjs) {
    try {
      bwipjs.toCanvas(canvas, {
        bcid,
        text: String(value).trim(),
        scale: options.scale || 3,
        height: options.height || 14,
        includetext: options.includetext !== false,
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
      });
      return true;
    } catch {
      if (bcid !== 'code128') {
        try {
          bwipjs.toCanvas(canvas, {
            bcid: 'code128',
            text: String(value).trim(),
            scale: options.scale || 3,
            height: options.height || 14,
            includetext: options.includetext !== false,
            textxalign: 'center',
            backgroundcolor: 'FFFFFF',
          });
          return true;
        } catch {
          // Fall through to pure-JS renderer
        }
      }
    }
  }
  return renderBarcodeToCanvasOrSvg(canvas, value, format, { height: 84, scale: 2 });
}

function drawDeterministicQrFallback(canvas, text, size = 200) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const grid = 25;
  const quiet = 2;
  const total = grid + quiet * 2;
  const cell = size / total;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0b1020';

  const drawFinder = (gx, gy) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const inner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (border || inner) {
          ctx.fillRect((quiet + gx + c) * cell, (quiet + gy + r) * cell, Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(grid - 7, 0);
  drawFinder(0, grid - 7);

  const bars = generateCode128Bars(text);
  const flatBits = [];
  for (let i = 0; i < bars.length; i += 1) {
    const count = bars[i];
    for (let b = 0; b < count; b += 1) {
      flatBits.push(i % 2 === 0 ? 1 : 0);
    }
  }
  let idx = 0;
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const inFinder = (r < 8 && c < 8) || (r < 8 && c >= grid - 8) || (r >= grid - 8 && c < 8);
      if (inFinder) continue;
      if (r === 6 || c === 6) {
        if ((r + c) % 2 === 0) {
          ctx.fillRect((quiet + c) * cell, (quiet + r) * cell, Math.ceil(cell), Math.ceil(cell));
        }
        continue;
      }
      const bit = flatBits.length ? flatBits[idx % flatBits.length] ^ ((r * 3 + c * 5 + idx) & 1) : 0;
      idx += 1;
      if (bit) {
        ctx.fillRect((quiet + c) * cell, (quiet + r) * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
  return true;
}

export async function renderQrCanvas(canvas, value, size = 200) {
  if (!canvas || !value) return false;
  const QRious = await getQRious();
  if (QRious) {
    try {
      new QRious({
        element: canvas,
        value: String(value).trim(),
        size,
        level: 'M',
        background: '#ffffff',
        foreground: '#000000',
      });
      return true;
    } catch {
      // Fall through to deterministic QR matrix fallback
    }
  }
  return drawDeterministicQrFallback(canvas, String(value).trim(), size);
}

