// OmniPass Core Base Primitives (reconstructed from REA Evidence ev_f21fe560030525a9a8258e4631c372b53e1c520af551f63d9a2124edf0e6cfc1)
// Provides:
// 1. In-App Browser (LINE / FB / IG / Threads / WeChat / TikTok / X) detection & sessionStorage banner state
// 2. Web Audio API 5-preset scan success sound synthesizer (market, register, digital, chime, classic)
// 3. PBKDF2-SHA256 (600,000 iterations) + AES-256-GCM encrypted .opbackup export & import
// 4. Zero-dependency SVG CODE128 & CODE39 barcode renderer for instant high-contrast checkout display

export const BACKUP_FORMAT = 'omnipass-encrypted-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_PBKDF2_ITERATIONS = 600000;
export const BACKUP_SALT_BYTES = 16;
export const BACKUP_IV_BYTES = 12;
export const BACKUP_MIN_PASSWORD_LENGTH = 8;
export const BACKUP_FILE_EXTENSION = '.opbackup';
export const IN_APP_BROWSER_DISMISSED_KEY = 'inAppBrowserBannerDismissed';

export const SCAN_SUCCESS_SOUNDS = {
  market: {
    label: '超市清脆嗶聲（預設）',
    description: '接近量販與超商常見的乾淨單音嗶聲，辨識度最高。',
    steps: [
      { frequency: 1920, frequencyEnd: 2080, duration: 0.085, gain: 0.14, type: 'triangle' },
    ],
  },
  register: {
    label: '收銀機雙音',
    description: '短促雙音，接近門市結帳完成時的確認感。',
    steps: [
      { frequency: 1320, duration: 0.055, gain: 0.11, type: 'triangle' },
      { frequency: 1760, duration: 0.08, gain: 0.13, type: 'triangle', delay: 0.06 },
    ],
  },
  digital: {
    label: '電子短音',
    description: '俐落短促的高頻提示音，適合連續快速掃碼。',
    steps: [
      { frequency: 1560, frequencyEnd: 1640, duration: 0.06, gain: 0.12, type: 'sine' },
    ],
  },
  chime: {
    label: '柔和提示音',
    description: '較溫和的上揚和弦提示音，不刺耳。',
    steps: [
      { frequency: 1046.5, duration: 0.06, gain: 0.09, type: 'sine' },
      { frequency: 1318.5, duration: 0.09, gain: 0.11, type: 'sine', delay: 0.05 },
    ],
  },
  classic: {
    label: '經典單音',
    description: '傳統條碼機標準 1000Hz 單音。',
    steps: [
      { frequency: 1000, duration: 0.09, gain: 0.13, type: 'sine' },
    ],
  },
};

const IN_APP_BROWSER_RULES = [
  { name: 'LINE', pattern: /\bLine\//i },
  { name: 'Facebook', pattern: /\b(?:FBAN|FBAV)\b/i },
  { name: 'Messenger', pattern: /\bMessenger\b/i },
  { name: 'Instagram', pattern: /\bInstagram\b/i },
  { name: 'Threads', pattern: /\bBarcelona\b/i },
  { name: 'WeChat', pattern: /\bMicroMessenger\b/i },
  { name: 'TikTok', pattern: /\b(?:BytedanceWebview|musical_ly)/i },
  { name: 'X', pattern: /\bTwitter\b/i },
];

export function detectInAppBrowser(userAgent = '') {
  const ua = String(userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '');
  if (!ua) return null;
  for (const rule of IN_APP_BROWSER_RULES) {
    if (rule.pattern.test(ua)) {
      return rule.name;
    }
  }
  return null;
}

export function isInAppBrowserBannerDismissed() {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(IN_APP_BROWSER_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInAppBrowserBanner() {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(IN_APP_BROWSER_DISMISSED_KEY, '1');
    }
  } catch {
    // Ignore restricted sessionStorage in strict WebViews
  }
}

let sharedAudioContext = null;

export function playScanSuccessSound(soundId = 'market') {
  if (typeof window === 'undefined') return false;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return false;

  try {
    if (!sharedAudioContext) {
      sharedAudioContext = new AudioCtx();
    }
    if (sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }

    const preset = SCAN_SUCCESS_SOUNDS[soundId] || SCAN_SUCCESS_SOUNDS.market;
    const now = sharedAudioContext.currentTime;

    for (const step of preset.steps) {
      const start = now + (step.delay || 0);
      const duration = step.duration || 0.08;
      const osc = sharedAudioContext.createOscillator();
      const gainNode = sharedAudioContext.createGain();

      osc.type = step.type || 'triangle';
      osc.frequency.setValueAtTime(step.frequency || 1600, start);
      if (step.frequencyEnd) {
        osc.frequency.exponentialRampToValueAtTime(step.frequencyEnd, start + duration);
      }

      const peakGain = step.gain || 0.12;
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(peakGain, start + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + duration);

      osc.connect(gainNode);
      gainNode.connect(sharedAudioContext.destination);
      osc.start(start);
      osc.stop(start + duration + 0.01);
    }
    return true;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(base64) {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

export function validateBackupPassword(password, confirmPassword = null) {
  const pwd = String(password || '');
  if (pwd.length < BACKUP_MIN_PASSWORD_LENGTH) {
    return { valid: false, error: `備份密碼至少需要 ${BACKUP_MIN_PASSWORD_LENGTH} 個字元` };
  }
  if (confirmPassword !== null && pwd !== String(confirmPassword || '')) {
    return { valid: false, error: '兩次輸入的備份密碼不一致' };
  }
  return { valid: true };
}

async function deriveBackupAesKey(password, saltBytes, iterations = BACKUP_PBKDF2_ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('目前環境不支援 Web Crypto API 加密功能');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptOmniPassBackup(payload, password, options = {}) {
  const check = validateBackupPassword(password);
  if (!check.valid) {
    throw new Error(check.error);
  }
  const iterations = Number(options.iterations) || BACKUP_PBKDF2_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(BACKUP_SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(BACKUP_IV_BYTES));
  const key = await deriveBackupAesKey(password, salt, iterations);

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintextBytes,
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: options.appVersion || '2.0.0-omnitrunk',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations,
      salt: bytesToBase64(salt),
    },
    cipher: {
      name: 'AES-GCM',
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
  };
}

export async function decryptOmniPassBackup(envelopeOrJson, password) {
  const envelope = typeof envelopeOrJson === 'string'
    ? JSON.parse(envelopeOrJson)
    : envelopeOrJson;

  if (!envelope || envelope.format !== BACKUP_FORMAT) {
    throw new Error('不是有效的 OmniPass 加密備份檔 (.opbackup)');
  }
  if (!envelope.kdf?.salt || !envelope.cipher?.iv || !envelope.ciphertext) {
    throw new Error('加密備份檔結構不完整');
  }

  const salt = base64ToBytes(envelope.kdf.salt);
  const iv = base64ToBytes(envelope.cipher.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const iterations = Number(envelope.kdf.iterations) || BACKUP_PBKDF2_ITERATIONS;

  try {
    const key = await deriveBackupAesKey(password, salt, iterations);
    const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    );
    const jsonText = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonText);
  } catch {
    throw new Error('密碼錯誤或備份檔已損毀，無法解密');
  }
}

// Pure-JS CODE39 & CODE128B SVG Barcode Generator (for zero-dependency high-contrast SVG rendering)
const CODE39_PATTERNS = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

export function generateCode128Bars(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return [];
  const codes = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const val = code >= 32 && code <= 126 ? code - 32 : 0;
    codes.push(val);
    checksum += val * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106); // Stop

  const widths = [];
  for (const c of codes) {
    const pattern = CODE128_PATTERNS[c] || CODE128_PATTERNS[0];
    for (let i = 0; i < pattern.length; i += 1) {
      widths.push(Number(pattern[i]));
    }
  }
  return widths;
}

export function generateCode39Bars(rawText) {
  const text = `*${String(rawText || '').trim().toUpperCase()}*`;
  const widths = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const pattern = CODE39_PATTERNS[ch] || CODE39_PATTERNS['-'];
    for (let j = 0; j < pattern.length; j += 1) {
      widths.push(pattern[j] === 'w' ? 3 : 1);
    }
    if (i < text.length - 1) {
      widths.push(1); // inter-character narrow space
    }
  }
  return widths;
}

export function renderBarcodeToCanvasOrSvg(targetEl, text, format = 'CODE_128', options = {}) {
  const value = String(text || '').trim();
  if (!targetEl || !value) return false;
  const upperFormat = String(format || 'CODE_128').toUpperCase();
  const widths = upperFormat.includes('39')
    ? generateCode39Bars(value)
    : generateCode128Bars(value);
  if (!widths.length) return false;

  const quietZone = 10;
  const totalModules = widths.reduce((sum, w) => sum + w, 0) + quietZone * 2;
  const height = Number(options.height) || 88;
  const barWidth = Number(options.scale) || 2;

  if (targetEl.tagName?.toLowerCase() === 'canvas') {
    const canvas = targetEl;
    canvas.width = totalModules * barWidth;
    canvas.height = height + 26;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0b1020';
    let x = quietZone * barWidth;
    for (let i = 0; i < widths.length; i += 1) {
      const w = widths[i] * barWidth;
      if (i % 2 === 0) {
        ctx.fillRect(x, 8, w, height - 12);
      }
      x += w;
    }
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(value, canvas.width / 2, height + 16);
    return true;
  }

  let x = quietZone;
  const rects = [];
  for (let i = 0; i < widths.length; i += 1) {
    const w = widths[i];
    if (i % 2 === 0) {
      rects.push(`<rect x="${x}" y="6" width="${w}" height="${height - 14}" fill="#0b1020" />`);
    }
    x += w;
  }
  targetEl.innerHTML = `
    <svg viewBox="0 0 ${totalModules} ${height + 16}" width="100%" height="${height + 16}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${value}">
      <rect width="100%" height="100%" fill="#ffffff" rx="8" />
      ${rects.join('')}
      <text x="${totalModules / 2}" y="${height + 10}" text-anchor="middle" fill="#0b1020" font-size="11" font-family="ui-monospace, monospace" font-weight="700">${value.replace(/[<>&"']/g, '')}</text>
    </svg>
  `;
  return true;
}
