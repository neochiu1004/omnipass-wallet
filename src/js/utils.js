export const DB_KEYS = {
  TASKS: 'wallet_tasks_v3',
  SETTINGS: 'wallet_settings_v3',
  BG_HISTORY: 'wallet_bg_history_v3',
  TEMPLATES: 'wallet_templates_v3',
  EXPIRY_NOTIFIED: 'wallet_expiry_notified_v3',
  LAST_BACKUP: 'lastBackupTime',
};

// v1.6.1: cards default to a translucent look so the canvas shows
// through; v1.6.2 makes that TRUE transparency (background-color alpha
// only, no backdrop-filter blur). LEGACY_DEFAULT_CARD_OPACITY is the
// pre-1.6.1 default; stored settings still carrying it (and not yet migrated)
// are treated as "never customized" by DataService.compactViewConfig.
export const GLASS_CARD_OPACITY = 0.73;
export const LEGACY_DEFAULT_CARD_OPACITY = 0.95;

export const defaultViewConfig = {
  backgroundImage: '',
  backgroundImages: [],
  showBackground: true,
  cardOpacity: GLASS_CARD_OPACITY,
  bgOpacity: 1,
  cardBgColor: '#ffffff',
  cardBorderColor: '#d7e3f0',
  cardHeight: 0,
  gridImageHeight: 84,
  thumbnailScale: 100,
  gridColumns: 2,
  showThumbnail: true,
  ultraCompactCard: false,
};

export const defaultSettings = {
  tgToken: '',
  tgChatId: '',
  notifyDays: 7,
  appTitle: '歐米票夾 OmniTrunk',
  swipeGesturesEnabled: true,
  swipeTriggerDistance: 72,
  specificViewKeywords: ['MOMO', '85度C'],
  scanSuccessSound: 'market',
  quickPasses: [
    { id: 'qp_carrier', label: '手機條碼載具', code: '', format: 'CODE_39', enabled: false },
    { id: 'qp_member', label: '常用會員條碼', code: '', format: 'CODE_128', enabled: false },
  ],
  viewConfigs: {
    active: { ...defaultViewConfig },
    completed: { ...defaultViewConfig },
    deleted: { ...defaultViewConfig },
  },
  redeemUrlPresets: [],
  defaultTemplateId: '',
  quickTags: [],
  localBackupFileName: 'omnitrunk_backup',
};

export const BARCODE_FORMATS = [
  { value: '', label: '自動 / 未指定' },
  { value: 'CODE_128', label: 'CODE_128' },
  { value: 'CODE_39', label: 'CODE_39' },
  { value: 'CODE_93', label: 'CODE_93' },
  { value: 'EAN_13', label: 'EAN_13' },
  { value: 'EAN_8', label: 'EAN_8' },
  { value: 'UPC_A', label: 'UPC_A' },
  { value: 'UPC_E', label: 'UPC_E' },
  { value: 'ITF', label: 'ITF' },
  { value: 'PDF_417', label: 'PDF_417' },
  { value: 'DATA_MATRIX', label: 'DATA_MATRIX' },
  { value: 'AZTEC', label: 'AZTEC' },
  { value: 'CODABAR', label: 'CODABAR' },
  { value: 'QR_CODE', label: 'QR_CODE' },
];

// Nav entries for 已使用 / 回收桶 only take up space when they hold
// tickets (v1.6.1). Pure + data-driven so every render can recompute it.
export function getNavVisibility(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const completedCount = list.filter((t) => t.completed && !t.isDeleted).length;
  const deletedCount = list.filter((t) => t.isDeleted).length;
  return {
    completedCount,
    deletedCount,
    showCompleted: completedCount > 0,
    showDeleted: deletedCount > 0,
  };
}

export function generateId() {
  return `ticket_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Live mask for the expiry text field: the numeric keypad has no "/"
// key, so slashes are inserted automatically as digits are typed
// (20261231 -> 2026/12/31). Non-digits are stripped, max 8 digits.
export function formatExpiryMask(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}/${digits.slice(4)}`;
  return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
}

export function parseExpiryText(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let match = raw.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!match) {
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) match = compact;
  }
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

// Canonical display form for an expiry value ('' when empty/invalid).
export function formatExpiryText(value) {
  return parseExpiryText(value) || '';
}

export function normalizeDateInput(value) {
  if (!value) return '';
  return value.replace(/[.\-]/g, '/');
}

export function checkIsExpiringSoon(expiryStr, thresholdDays = 7) {
  if (!expiryStr) return false;
  const normalizedDate = normalizeDateInput(expiryStr);
  const expiryDate = new Date(normalizedDate);
  if (Number.isNaN(expiryDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = expiryDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= thresholdDays && diffDays >= -1;
}

export function formatDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  const date = formatDate(timestamp);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}

export function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function parseTags(tagInput) {
  if (!tagInput) return [];
  return [...new Set(
    tagInput
      .split(/[#,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean)
  )];
}

export function tagsToText(tags) {
  return (tags || []).join(', ');
}

export function isValidUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function validateImportData(data) {
  if (!data || typeof data !== 'object') {
    return { success: false, error: '資料格式非物件' };
  }

  const normalized = Array.isArray(data) ? { tasks: data } : { ...data };

  if (!Array.isArray(normalized.tasks) && Array.isArray(normalized[DB_KEYS.TASKS])) {
    normalized.tasks = normalized[DB_KEYS.TASKS];
  }
  if (!normalized.settings && normalized[DB_KEYS.SETTINGS] && typeof normalized[DB_KEYS.SETTINGS] === 'object') {
    normalized.settings = normalized[DB_KEYS.SETTINGS];
  }
  if (!Array.isArray(normalized.templates) && Array.isArray(normalized[DB_KEYS.TEMPLATES])) {
    normalized.templates = normalized[DB_KEYS.TEMPLATES];
  }
  if (!Array.isArray(normalized.bgHistory) && Array.isArray(normalized[DB_KEYS.BG_HISTORY])) {
    normalized.bgHistory = normalized[DB_KEYS.BG_HISTORY];
  }
  if (!normalized.expiryNotified && normalized[DB_KEYS.EXPIRY_NOTIFIED] && typeof normalized[DB_KEYS.EXPIRY_NOTIFIED] === 'object') {
    normalized.expiryNotified = normalized[DB_KEYS.EXPIRY_NOTIFIED];
  }

  if (!Array.isArray(normalized.tasks)) {
    return { success: false, error: '找不到可匯入的票券陣列 (tasks)' };
  }
  if (normalized.tasks.some((item) => item && typeof item === 'object' && ('ticketNumber' in item || 'expiryDate' in item || 'buyer' in item))) {
    return { success: false, error: '這是批量新增格式，請使用資料頁的「批量新增票券」；此處只接受完整備份 JSON。' };
  }
  if (normalized.tasks.some((item) => !item || typeof item !== 'object')) {
    return { success: false, error: 'tasks 內容必須是物件陣列' };
  }
  if (normalized.settings != null && typeof normalized.settings !== 'object') {
    return { success: false, error: 'settings 格式錯誤' };
  }
  if (normalized.templates != null && !Array.isArray(normalized.templates)) {
    return { success: false, error: 'templates 格式錯誤' };
  }
  if (normalized.bgHistory != null && !Array.isArray(normalized.bgHistory)) {
    return { success: false, error: 'bgHistory 格式錯誤' };
  }
  if (normalized.expiryNotified != null && typeof normalized.expiryNotified !== 'object') {
    return { success: false, error: 'expiryNotified 格式錯誤' };
  }

  return { success: true, data: normalized };
}

export function normalizeTicket(ticket) {
  const now = Date.now();
  const normalized = {
    id: ticket.id || generateId(),
    productName: ticket.productName || '',
    serial: ticket.serial || '',
    expiry: ticket.expiry || '',
    image: ticket.image || '',
    originalImage: ticket.originalImage || '',
    images: Array.isArray(ticket.images) ? ticket.images : [],
    batchProductImage: ticket.batchProductImage || '',
    batchImageVersion: Number(ticket.batchImageVersion) || 0,
    tags: Array.isArray(ticket.tags) ? ticket.tags.filter(Boolean) : [],
    note: ticket.note || '',
    barcodeFormat: ticket.barcodeFormat || '',
    completed: !!ticket.completed,
    completedAt: ticket.completedAt || undefined,
    isDeleted: !!ticket.isDeleted,
    deletedAt: ticket.deletedAt || undefined,
    createdAt: ticket.createdAt || now,
    redeemUrl: ticket.redeemUrl || '',
    // 置頂（pin）只適用於未使用票券：已使用或回收桶中的票券一律清除置頂，
    // 這裡是資料正規化的中央規則，讀取／儲存／匯入都會經過，舊資料也會自動清理。
    pinned: !!ticket.pinned && !ticket.completed && !ticket.isDeleted,
  };
  if (normalized.completed && !normalized.completedAt) {
    normalized.completedAt = now;
  }
  if (normalized.isDeleted && !normalized.deletedAt) {
    normalized.deletedAt = now;
  }
  return normalized;
}

export async function compressImage(fileOrUrl, type = 'thumbnail') {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'Anonymous';
    let objectUrl = null;

    img.onload = () => {
      if (img.width * img.height > 16000000) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        reject(new Error('Image resolution too high'));
        return;
      }

      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (type === 'thumbnail') {
        const max = 800;
        if (width > max || height > max) {
          const ratio = width / height;
          if (width > height) {
            width = max;
            height = max / ratio;
          } else {
            height = max;
            width = max * ratio;
          }
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const quality = type === 'original' ? 0.92 : 0.7;
      resolve(canvas.toDataURL('image/webp', quality));
    };

    img.onerror = (err) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    };

    if (typeof fileOrUrl === 'string') {
      img.src = fileOrUrl;
    } else {
      objectUrl = URL.createObjectURL(fileOrUrl);
      img.src = objectUrl;
    }
  });
}

let lastToastTimer = null;
export const TITLE_AUTO_TEMPLATE_KEYWORD = '85度C';

export function findTitleAutoTemplate(templates, defaultTemplateId, keyword = TITLE_AUTO_TEMPLATE_KEYWORD) {
  const list = Array.isArray(templates) ? templates : [];
  if (defaultTemplateId) {
    const byDefault = list.find((t) => t.id === defaultTemplateId);
    if (byDefault) return byDefault;
  }
  return list.find((t) => `${t.label || ''} ${t.productName || ''}`.includes(keyword)) || null;
}

export function deriveTicketDescription(productName = '') {
  const text = String(productName || '');
  const direct = text.match(/(\d+)\s*元\s*[^，。]*?任選一/);
  if (direct) return direct[0].replace(/\s+/g, '');
  const amount = text.match(/(\d+)\s*元/);
  if (amount && text.includes('飲品')) return `${amount[1]}元飲品任選一`;
  return '';
}

export function ticketImageGenerationMode({ borrowed = false, hasOriginalImage = false, serial = '', productName = '', isBatchEditing = false } = {}) {
  if (isBatchEditing || !serial) return null;
  if (borrowed) return 'borrowed';
  if (!hasOriginalImage && String(productName || '').includes(TITLE_AUTO_TEMPLATE_KEYWORD)) return 'keyword';
  return null;
}

export function ticketUsesTemplateImage(ticket, templateImage) {
  if (!ticket || !templateImage) return false;
  if (ticket.isDeleted || !ticket.serial) return false;
  if ((ticket.tags || []).includes('批量生成')) return false;
  return ticket.originalImage === templateImage;
}

export function backfillTitleTemplateImages(tasks, templates, defaultTemplateId, keyword = TITLE_AUTO_TEMPLATE_KEYWORD) {
  const list = Array.isArray(tasks) ? tasks : [];
  const template = findTitleAutoTemplate(templates, defaultTemplateId, keyword);
  let templateChanged = false;
  let tasksChanged = 0;
  if (!template) return { templateChanged, tasksChanged };

  if (!template.originalImage) {
    const source = list.find((t) => (t.productName || '').includes(keyword) && t.originalImage);
    if (source) {
      template.originalImage = source.originalImage;
      if (!template.image && source.image) template.image = source.image;
      templateChanged = true;
    }
  }

  if (template.originalImage) {
    for (const t of list) {
      if (!(t.productName || '').includes(keyword)) continue;
      let changed = false;
      if (!t.originalImage) { t.originalImage = template.originalImage; changed = true; }
      if (!t.image && template.image) { t.image = template.image; changed = true; }
      if (changed) tasksChanged += 1;
    }
  }
  return { templateChanged, tasksChanged };
}

export function showToast(message, variant = 'info', durationMs = 2200) {
  const toast = document.getElementById('toast');
  const textNode = document.getElementById('toast-message');
  if (!toast || !textNode) return;

  textNode.textContent = message;
  toast.classList.remove('toast-hide', 'opacity-0', 'bg-red-600', 'bg-emerald-700', 'bg-wabi-primary');
  if (variant === 'error') {
    toast.classList.add('bg-red-600');
  } else if (variant === 'success') {
    toast.classList.add('bg-emerald-700');
  } else {
    toast.classList.add('bg-wabi-primary');
  }
  toast.classList.add('toast-show');

  if (lastToastTimer) clearTimeout(lastToastTimer);
  const showDuration = Number.isFinite(Number(durationMs)) ? Math.max(300, Number(durationMs)) : 2200;
  lastToastTimer = setTimeout(() => {
    toast.classList.remove('toast-show');
    toast.classList.add('toast-hide');
    setTimeout(() => toast.classList.add('opacity-0'), 280);
  }, showDuration);
}

let lastTelegramMessageTime = 0;
const TELEGRAM_MIN_INTERVAL_MS = 1000;

export async function sendTelegramMessage(token, chatId, text) {
  if (!token || !chatId) return { success: false, error: 'Missing token or chat_id' };

  const now = Date.now();
  if (now - lastTelegramMessageTime < TELEGRAM_MIN_INTERVAL_MS) {
    return { success: false, error: 'Rate limited - please wait' };
  }
  lastTelegramMessageTime = now;

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(text)}&parse_mode=Markdown`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.ok) return { success: true };
    return { success: false, error: data.description || 'Telegram API error' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function getOrCreateClientInstallId() {
  try {
    const storageKey = 'wallet_client_install_id_v1';
    const existing = window.localStorage?.getItem(storageKey);
    if (existing) return existing;
    const nextId = `client-${Math.random().toString(36).slice(2, 8)}`;
    window.localStorage?.setItem(storageKey, nextId);
    return nextId;
  } catch (_error) {
    return `client-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function getClientSourceLabel() {
  if (typeof window === 'undefined') return 'unknown-source';

  const ua = navigator.userAgent || '';
  const platform = /iPhone|iPad|iPod/i.test(ua)
    ? 'iPhone'
    : /Android/i.test(ua)
      ? 'Android'
      : /Macintosh|Mac OS X/i.test(ua)
        ? 'Mac'
        : /Windows/i.test(ua)
          ? 'Windows'
          : 'Browser';
  const browser = /CriOS|Chrome/i.test(ua)
    ? 'Chrome'
    : /FxiOS|Firefox/i.test(ua)
      ? 'Firefox'
      : /Safari/i.test(ua) && !/Chrome|CriOS|Chromium/i.test(ua)
        ? 'Safari'
        : 'Web';
  const displayMode = window.matchMedia?.('(display-mode: standalone)')?.matches ? 'App' : 'Web';
  const installId = getOrCreateClientInstallId();
  return `${platform}/${browser}/${displayMode}/${installId}`;
}

export async function forceRefreshToLatest() {
  if (typeof window === 'undefined') return;

  if (!navigator.onLine) {
    throw new Error('目前離線，請連上網路後再試一次。');
  }

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map(async (registration) => {
        try {
          await registration.update();
        } catch (_error) {
          return;
        }
      })
    );
    await Promise.all(
      registrations.map(async (registration) => {
        try {
          await registration.unregister();
        } catch (_error) {
          return;
        }
      })
    );
  }

  if ('caches' in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('refresh', Date.now().toString());
  window.location.replace(nextUrl.toString());
}

