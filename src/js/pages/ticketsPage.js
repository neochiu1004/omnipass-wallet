import {
  checkIsExpiringSoon,
  escapeHtml,
  formatDateTime,
  parseTags,
  showToast,
  normalizeDateInput,
  GLASS_CARD_OPACITY,
} from '../utils.js';
import { renderBarcodeCanvas, renderQrCanvas } from '../services/barcodeService.js';
import { playScanSuccessSound } from '../services/omniCoreService.js';

const VIEW_META = {
  active: { title: '待使用票券', empty: '目前沒有待使用票券', icon: 'fa-ticket' },
  completed: { title: '已使用票券', empty: '目前沒有已使用票券', icon: 'fa-check-circle' },
  deleted: { title: '回收桶', empty: '回收桶是空的', icon: 'fa-trash' },
};
const ORIGINAL_IMAGE_FILTER_TAG = '__has_original_image__';
const EXPIRY_URGENT_FILTER_TAG = '__expiry_urgent__';
const DUPLICATE_FILTER_TAG = '__duplicate_serial__';
const SWIPE_HINT_STORAGE_KEY = 'wallet_swipe_hint_seen_v1';
let swipeHintShownInSession = false;

function parseExpiryToTime(expiry) {
  if (!expiry) return Number.MAX_SAFE_INTEGER;
  const normalized = normalizeDateInput(expiry).trim();
  const match = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return Number.MAX_SAFE_INTEGER;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function getExpiryState(expiry, notifyDays = 7) {
  if (!expiry) return 'normal';
  const expiryTime = parseExpiryToTime(expiry);
  if (!Number.isFinite(expiryTime) || expiryTime === Number.MAX_SAFE_INTEGER) return 'normal';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryDate = new Date(expiryTime);
  expiryDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays === 0) return 'today';
  if (checkIsExpiringSoon(expiry, notifyDays)) return 'soon';
  return 'normal';
}

function getExpiryCountdownLabel(expiry) {
  if (!expiry) return '';
  const expiryTime = parseExpiryToTime(expiry);
  if (!Number.isFinite(expiryTime) || expiryTime === Number.MAX_SAFE_INTEGER) return '';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryDate = new Date(expiryTime);
  expiryDate.setHours(0, 0, 0, 0);

  const diffDays = Math.round((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'D-day';
  if (diffDays > 0) return `D-${diffDays}`;
  return `逾期${Math.abs(diffDays)}天`;
}

function getDuplicateSerialSet(tasks) {
  const counts = new Map();
  tasks.forEach((ticket) => {
    if (!ticket.isDeleted && ticket.serial) counts.set(ticket.serial, (counts.get(ticket.serial) || 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([serial]) => serial));
}

function getSortComparator(sortType) {
  if (sortType === 'newest') return (a, b) => (b.createdAt || 0) - (a.createdAt || 0);
  if (sortType === 'oldest') return (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  return (a, b) => {
    const da = parseExpiryToTime(a.expiry);
    const db = parseExpiryToTime(b.expiry);
    return da - db;
  };
}

const BARCODE_BCID_MAP = {
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
  CODABAR: 'codabar',
  QR_CODE: 'qrcode',
};

function resolveBarcodeBcid(format) {
  if (!format) return 'code128';
  return BARCODE_BCID_MAP[format] || 'code128';
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function hexToRgba(hex, alpha = 1) {
  const normalized = String(hex || '').trim();
  const fallback = `rgba(255, 255, 255, ${clamp(alpha, 0, 1, 0.95)})`;
  if (!normalized) return fallback;
  const pureHex = normalized.replace('#', '');
  if (![3, 6].includes(pureHex.length) || /[^0-9a-f]/i.test(pureHex)) return fallback;
  const expanded = pureHex.length === 3
    ? pureHex.split('').map((char) => `${char}${char}`).join('')
    : pureHex;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1, 0.95)})`;
}

export class TicketsPage {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.toolbarScrollHandler = null;
    this.backgroundInsetHandler = null;
    this.backgroundRotationTimer = null;
    this.backgroundRotationIndex = 0;
    this.lastSelectedCount = null;
    this.continueBatchHint = false;
    this.continueBatchHintTimer = null;
    this.searchIsComposing = false;
  }

  isTouchGestureAvailable() {
    return (
      typeof window !== 'undefined'
      && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    );
  }

  isSwipeGestureEnabled() {
    return this.app?.state?.settings?.swipeGesturesEnabled !== false;
  }

  getSwipeTriggerDistance() {
    const configured = Number(this.app?.state?.settings?.swipeTriggerDistance);
    if (!Number.isFinite(configured)) return 72;
    return Math.max(40, Math.min(120, configured));
  }

  triggerHapticFeedback(pattern = 12) {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(pattern);
    } catch (_error) {
      // Ignore unsupported vibration errors on some browsers.
    }
  }

  showSwipeHintIfNeeded() {
    if (swipeHintShownInSession) {
      try {
        if (window.localStorage?.getItem(SWIPE_HINT_STORAGE_KEY) !== '1') {
          swipeHintShownInSession = false;
        }
      } catch (_error) {
        // Ignore storage errors.
      }
    }
    if (swipeHintShownInSession) return;
    if (!this.isTouchGestureAvailable()) return;
    if (!this.isSwipeGestureEnabled()) return;
    if (!['active', 'completed', 'deleted'].includes(this.view)) return;

    let seen = false;
    try {
      seen = window.localStorage?.getItem(SWIPE_HINT_STORAGE_KEY) === '1';
    } catch (_error) {
      seen = false;
    }
    if (seen) {
      swipeHintShownInSession = true;
      return;
    }

    swipeHintShownInSession = true;
    try {
      window.localStorage?.setItem(SWIPE_HINT_STORAGE_KEY, '1');
    } catch (_error) {
      // Ignore storage errors (private mode / storage disabled).
    }

    const hints = {
      active: '手勢快捷：左滑核銷、右滑回收、長按多選',
      completed: '手勢快捷：左滑還原、右滑回收、長按多選',
      deleted: '手勢快捷：左滑清除、右滑還原、長按多選',
    };
    showToast(hints[this.view] || '已啟用手勢快捷操作', 'success', 1600);
  }

  async handleSwipeAction(ticket, direction) {
    if (!ticket) return false;

    if (this.view === 'active') {
      if (ticket.isDeleted || ticket.completed) return false;

      if (direction === 'left') {
        this.openRedeemModeModal(ticket);
        this.triggerHapticFeedback(14);
        return true;
      }

      if (direction === 'right') {
        const ok = window.confirm(`確定將「${ticket.productName || '未命名票券'}」移至回收桶？`);
        if (!ok) return false;
        ticket.isDeleted = true;
        ticket.deletedAt = Date.now();
        ticket.pinned = false;
        await this.app.persistTasks();
        this.triggerHapticFeedback([14, 28, 14]);
        showToast('已移至回收桶', 'success');
        this.render();
        return true;
      }
    }

    if (this.view === 'completed') {
      if (ticket.isDeleted || !ticket.completed) return false;

      if (direction === 'left') {
        const ok = window.confirm(`確定將「${ticket.productName || '未命名票券'}」改回待使用？`);
        if (!ok) return false;
        ticket.completed = false;
        ticket.completedAt = undefined;
        ticket.pinned = false;
        await this.app.persistTasks();
        this.triggerHapticFeedback(14);
        showToast('已改回待使用', 'success');
        this.render();
        return true;
      }

      if (direction === 'right') {
        const ok = window.confirm(`確定將「${ticket.productName || '未命名票券'}」移至回收桶？`);
        if (!ok) return false;
        ticket.isDeleted = true;
        ticket.deletedAt = Date.now();
        ticket.pinned = false;
        await this.app.persistTasks();
        this.triggerHapticFeedback([14, 28, 14]);
        showToast('已移至回收桶', 'success');
        this.render();
        return true;
      }
    }

    if (this.view === 'deleted') {
      if (!ticket.isDeleted) return false;

      if (direction === 'right') {
        const ok = window.confirm(`確定還原「${ticket.productName || '未命名票券'}」？`);
        if (!ok) return false;
        ticket.isDeleted = false;
        ticket.deletedAt = undefined;
        ticket.pinned = false;
        await this.app.persistTasks();
        this.triggerHapticFeedback(14);
        showToast('已還原票券', 'success');
        this.render();
        return true;
      }

      if (direction === 'left') {
        const ok = window.confirm(`確定永久刪除「${ticket.productName || '未命名票券'}」？此操作無法復原。`);
        if (!ok) return false;
        this.app.state.tasks = this.app.state.tasks.filter((item) => item.id !== ticket.id);
        await this.app.persistTasks();
        this.triggerHapticFeedback([22, 40, 22]);
        showToast('已永久刪除', 'success');
        this.render();
        return true;
      }
    }

    return false;
  }

  bindCardSwipeGesture(card) {
    if (!this.isTouchGestureAvailable()) return;
    if (!this.isSwipeGestureEnabled()) return;
    if (!card.dataset.swipeEnabled) return;

    const interactiveSelector = 'button, a, input, textarea, select, label, [data-no-swipe], .ticket-card-actions';
    const SWIPE_LOCK_DISTANCE = 10;
    const SWIPE_TRIGGER_DISTANCE = this.getSwipeTriggerDistance();
    const SWIPE_HINT_DISTANCE = Math.max(24, Math.floor(SWIPE_TRIGGER_DISTANCE * 0.55));
    const SWIPE_CLAMP_DISTANCE = 92;
    const SWIPE_PREVENT_CLICK_DISTANCE = 16;
    const LONG_PRESS_MS = 430;
    const LONG_PRESS_MOVE_TOLERANCE = 10;
    let tracking = false;
    let horizontalSwipe = false;
    let startX = 0;
    let startY = 0;
    let currentOffset = 0;
    let swipeHintNotified = false;
    let longPressTriggered = false;
    let longPressTimer = null;

    const clearLongPressTimer = () => {
      if (!longPressTimer) return;
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    const resetSwipeVisual = (animated = true) => {
      card.classList.remove('ticket-card--swiping', 'ticket-card--swipe-left', 'ticket-card--swipe-right', 'ticket-card--swipe-ready');
      if (animated) {
        card.classList.add('ticket-card--swipe-release');
      } else {
        card.classList.remove('ticket-card--swipe-release');
      }
      card.style.removeProperty('--ticket-swipe-offset');
      swipeHintNotified = false;
    };

    const setSwipeOffset = (offset) => {
      const limited = Math.max(-SWIPE_CLAMP_DISTANCE, Math.min(SWIPE_CLAMP_DISTANCE, offset));
      currentOffset = limited;
      const absOffset = Math.abs(limited);
      card.style.setProperty('--ticket-swipe-offset', `${limited}px`);
      card.classList.add('ticket-card--swiping');
      card.classList.toggle('ticket-card--swipe-left', limited < -18);
      card.classList.toggle('ticket-card--swipe-right', limited > 18);
      const ready = absOffset >= SWIPE_HINT_DISTANCE;
      card.classList.toggle('ticket-card--swipe-ready', ready);
      if (ready && !swipeHintNotified) {
        swipeHintNotified = true;
        this.triggerHapticFeedback(8);
      }
    };

    card.addEventListener('transitionend', () => {
      if (Math.abs(currentOffset) > 0.5) return;
      card.classList.remove('ticket-card--swipe-release');
    });

    card.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1) return;
      if (event.target.closest(interactiveSelector)) return;
      const inSelectionMode = this.app.state.ui.selectionMode;
      tracking = true;
      horizontalSwipe = false;
      longPressTriggered = false;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      currentOffset = 0;
      swipeHintNotified = false;
      card.dataset.swipeSuppressClick = '0';
      card.classList.remove('ticket-card--swipe-release');

      clearLongPressTimer();
      if (!inSelectionMode) {
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (!tracking) return;
          const ticketId = card.dataset.ticketId;
          if (!ticketId) return;
          longPressTriggered = true;
          tracking = false;
          horizontalSwipe = false;
          currentOffset = 0;
          card.dataset.swipeSuppressClick = '1';
          resetSwipeVisual(false);
          this.app.state.ui.selectionMode = true;
          this.app.state.ui.selectedIds.add(ticketId);
          this.hideContinueBatchHint();
          this.triggerHapticFeedback([12, 30, 12]);
          showToast('已進入多選模式', 'success', 900);
          this.render();
        }, LONG_PRESS_MS);
      }
    }, { passive: true });

    card.addEventListener('touchmove', (event) => {
      if (!tracking || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (Math.abs(dx) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(dy) > LONG_PRESS_MOVE_TOLERANCE) {
        clearLongPressTimer();
      }

      if (!horizontalSwipe) {
        if (Math.abs(dx) < SWIPE_LOCK_DISTANCE && Math.abs(dy) < SWIPE_LOCK_DISTANCE) return;
        horizontalSwipe = Math.abs(dx) > Math.abs(dy) * 1.15;
        if (!horizontalSwipe) {
          tracking = false;
          resetSwipeVisual(false);
          return;
        }
      }

      event.preventDefault();
      setSwipeOffset(dx);
      if (Math.abs(dx) >= SWIPE_PREVENT_CLICK_DISTANCE) {
        card.dataset.swipeSuppressClick = '1';
      }
    }, { passive: false });

    card.addEventListener('touchcancel', () => {
      clearLongPressTimer();
      tracking = false;
      horizontalSwipe = false;
      longPressTriggered = false;
      currentOffset = 0;
      resetSwipeVisual(true);
    });

    card.addEventListener('touchend', async () => {
      clearLongPressTimer();
      if (longPressTriggered) {
        longPressTriggered = false;
        return;
      }
      if (!tracking) return;
      tracking = false;
      const finalOffset = currentOffset;
      const ticketId = card.dataset.ticketId;
      const ticket = this.app.state.tasks.find((item) => item.id === ticketId);
      const shouldTrigger = horizontalSwipe && Math.abs(finalOffset) >= SWIPE_TRIGGER_DISTANCE;
      horizontalSwipe = false;
      currentOffset = 0;
      if (!shouldTrigger || !ticket) {
        resetSwipeVisual(true);
        return;
      }

      const direction = finalOffset < 0 ? 'left' : 'right';
      try {
        await this.handleSwipeAction(ticket, direction);
      } finally {
        resetSwipeVisual(true);
      }
    }, { passive: true });
  }

  clearBackgroundRotationTimer() {
    if (this.backgroundRotationTimer) {
      window.clearInterval(this.backgroundRotationTimer);
      this.backgroundRotationTimer = null;
    }
  }

  clearBackgroundInsetHandler() {
    if (this.backgroundInsetHandler) {
      window.removeEventListener('resize', this.backgroundInsetHandler);
      window.removeEventListener('orientationchange', this.backgroundInsetHandler);
      window.visualViewport?.removeEventListener('resize', this.backgroundInsetHandler);
      this.backgroundInsetHandler = null;
    }
  }

  updateBackgroundLayerInset() {
    const layer = this.app.getRoot()?.querySelector('.ticket-view-bg-layer');
    if (!layer) return;
    const topBar = this.app.getRoot()?.querySelector('#tickets-top-bar');
    if (!topBar) {
      layer.style.top = '0px';
      return;
    }
    const rect = topBar.getBoundingClientRect();
    const insetTop = Math.max(0, Math.round(rect.bottom));
    layer.style.top = `${insetTop}px`;
  }

  syncTopBarSpacer() {
    const root = this.app.getRoot();
    const topBar = root?.querySelector('#tickets-top-bar');
    const spacer = root?.querySelector('#tickets-top-bar-spacer');
    if (!topBar || !spacer) return;
    // Fixed bar sits 12px below the safe-area top; keep 12px breathing room under it too.
    spacer.style.height = `${topBar.offsetHeight + 24}px`;
  }

  startBackgroundRotation(backgroundImages, showBackground) {
    this.clearBackgroundRotationTimer();
    if (!showBackground) return;
    if (!Array.isArray(backgroundImages) || backgroundImages.length <= 1) return;

    this.backgroundRotationTimer = window.setInterval(() => {
      const layer = this.app.getRoot()?.querySelector('.ticket-view-bg-layer');
      if (!layer) {
        this.clearBackgroundRotationTimer();
        return;
      }
      this.backgroundRotationIndex = (this.backgroundRotationIndex + 1) % backgroundImages.length;
      layer.style.backgroundImage = `url('${backgroundImages[this.backgroundRotationIndex]}')`;
    }, 8000);
  }

  cycleBackground(backgroundImages) {
    if (!Array.isArray(backgroundImages) || backgroundImages.length <= 1) return false;
    const layer = this.app.getRoot()?.querySelector('.ticket-view-bg-layer');
    if (!layer) return false;
    this.backgroundRotationIndex = (this.backgroundRotationIndex + 1) % backgroundImages.length;
    layer.style.backgroundImage = `url('${backgroundImages[this.backgroundRotationIndex]}')`;
    return true;
  }

  clearContinueBatchHintTimer() {
    if (this.continueBatchHintTimer) {
      clearTimeout(this.continueBatchHintTimer);
      this.continueBatchHintTimer = null;
    }
  }

  hideContinueBatchHint() {
    this.clearContinueBatchHintTimer();
    this.continueBatchHint = false;
  }

  showContinueBatchHint() {
    this.clearContinueBatchHintTimer();
    this.continueBatchHint = true;
    this.continueBatchHintTimer = setTimeout(() => {
      this.continueBatchHint = false;
      this.continueBatchHintTimer = null;
      if (this.app?.router?.currentHash === this.view && this.app.state.ui.selectionMode) {
        this.render();
      }
    }, 2000);
  }

  pickTemplateForBatch() {
    const templates = this.app.state.templates || [];
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-md rounded-2xl border border-wabi-border bg-white shadow-2xl p-4">
          <h3 class="text-lg font-semibold text-wabi-primary mb-1">選擇範本</h3>
          <p class="text-sm text-wabi-text-secondary mb-3">請選擇要批次套用的範本</p>
          <div class="space-y-2 max-h-72 overflow-auto">
            ${templates.map((template, index) => `
              <button type="button" data-pick-template="${index}" class="w-full text-left px-3 py-2 rounded-lg border border-wabi-border hover:bg-wabi-primary/5">
                <p class="text-sm font-medium truncate">${escapeHtml(template.label || template.productName || '未命名範本')}</p>
                <p class="text-xs text-wabi-text-secondary truncate">${escapeHtml(template.productName || '')}</p>
              </button>
            `).join('')}
          </div>
          <div class="flex justify-end mt-3">
            <button type="button" data-cancel-template class="px-4 py-2 rounded-lg border border-wabi-border text-sm">取消</button>
          </div>
        </div>
      `;

      const onKeydown = (event) => {
        if (event.key === 'Escape') cleanup(null);
      };

      const cleanup = (template) => {
        window.removeEventListener('keydown', onKeydown);
        modal.remove();
        resolve(template || null);
      };

      modal.addEventListener('click', (event) => {
        if (event.target === modal) cleanup(null);
      });

      modal.querySelector('[data-cancel-template]')?.addEventListener('click', () => cleanup(null));
      modal.querySelectorAll('[data-pick-template]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const index = Number(btn.dataset.pickTemplate);
          cleanup(templates[index]);
        });
      });

      document.body.appendChild(modal);
      window.addEventListener('keydown', onKeydown);
    });
  }

  pickRedeemUrlForBatch() {
    const presets = this.app.state.settings.redeemUrlPresets || [];
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-md rounded-2xl border border-wabi-border bg-white shadow-2xl p-4">
          <h3 class="text-lg font-semibold text-wabi-primary mb-1">批次設定兌換網址</h3>
          <p class="text-sm text-wabi-text-secondary mb-3">可直接選預設網址，或輸入自訂網址</p>
          ${presets.length ? `
            <div class="space-y-2 max-h-40 overflow-auto mb-3">
              ${presets.map((preset, index) => `
                <button type="button" data-pick-preset="${index}" class="w-full text-left px-3 py-2 rounded-lg border border-wabi-border hover:bg-wabi-primary/5">
                  <p class="text-sm font-medium truncate">${escapeHtml(preset.label)}</p>
                  <p class="text-xs text-wabi-text-secondary truncate">${escapeHtml(preset.url || '')}</p>
                </button>
              `).join('')}
            </div>
          ` : '<p class="text-xs text-wabi-text-secondary mb-3">尚未建立兌換網址預設</p>'}
          <input id="batch-redeem-url-input" placeholder="https://..." class="w-full px-3 py-2 rounded-lg border border-wabi-border mb-3" />
          <div class="flex gap-2 justify-end">
            <button type="button" data-clear-url class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm">清除網址</button>
            <button type="button" data-cancel-url class="px-3 py-2 rounded-lg border border-wabi-border text-sm">取消</button>
            <button type="button" data-confirm-url class="px-3 py-2 rounded-lg bg-wabi-primary text-white text-sm">套用</button>
          </div>
        </div>
      `;

      const cleanup = (value, cancelled = false) => {
        modal.remove();
        resolve({ value, cancelled });
      };

      modal.addEventListener('click', (event) => {
        if (event.target === modal) cleanup('', true);
      });

      const input = modal.querySelector('#batch-redeem-url-input');
      modal.querySelectorAll('[data-pick-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const index = Number(btn.dataset.pickPreset);
          const picked = presets[index];
          if (!picked) return;
          input.value = picked.url || '';
        });
      });

      modal.querySelector('[data-clear-url]')?.addEventListener('click', () => cleanup('', false));
      modal.querySelector('[data-cancel-url]')?.addEventListener('click', () => cleanup('', true));
      modal.querySelector('[data-confirm-url]')?.addEventListener('click', () => cleanup((input.value || '').trim(), false));

      document.body.appendChild(modal);
      input.focus();
    });
  }

  pickTagsForBatch(mode = 'add') {
    const allTags = [...new Set(this.app.state.tasks.flatMap((ticket) => ticket.tags || []))].sort();
    const title = mode === 'remove' ? '批次移除標籤' : '批次新增標籤';
    const hint = mode === 'remove' ? '選擇要移除的標籤，可再輸入其他標籤' : '選擇要新增的標籤，可再輸入其他標籤';

    return new Promise((resolve) => {
      const selectedTags = new Set();
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-md rounded-2xl border border-wabi-border bg-white shadow-2xl p-4">
          <h3 class="text-lg font-semibold text-wabi-primary mb-1">${title}</h3>
          <p class="text-sm text-wabi-text-secondary mb-3">${hint}</p>
          <div class="max-h-40 overflow-auto mb-3 flex flex-wrap gap-2">
            ${allTags.length
              ? allTags.map((tag) => `<button type="button" data-tag-chip="${escapeHtml(tag)}" class="px-2.5 py-1 rounded-full text-xs border border-wabi-border hover:bg-wabi-primary/5">#${escapeHtml(tag)}</button>`).join('')
              : '<p class="text-xs text-wabi-text-secondary">尚無既有標籤</p>'}
          </div>
          <input id="batch-tags-input" placeholder="輸入標籤（可逗號分隔）" class="w-full px-3 py-2 rounded-lg border border-wabi-border mb-3" />
          <div class="flex gap-2 justify-end">
            <button type="button" data-cancel-tags class="px-3 py-2 rounded-lg border border-wabi-border text-sm">取消</button>
            <button type="button" data-confirm-tags class="px-3 py-2 rounded-lg bg-wabi-primary text-white text-sm">確認</button>
          </div>
        </div>
      `;

      const cleanup = (payload) => {
        modal.remove();
        resolve(payload || { cancelled: true, tags: [] });
      };

      modal.addEventListener('click', (event) => {
        if (event.target === modal) cleanup({ cancelled: true, tags: [] });
      });

      modal.querySelectorAll('[data-tag-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tag = btn.dataset.tagChip;
          if (!tag) return;
          if (selectedTags.has(tag)) {
            selectedTags.delete(tag);
            btn.classList.remove('bg-wabi-primary', 'text-white', 'border-wabi-primary');
          } else {
            selectedTags.add(tag);
            btn.classList.add('bg-wabi-primary', 'text-white', 'border-wabi-primary');
          }
        });
      });

      const input = modal.querySelector('#batch-tags-input');
      modal.querySelector('[data-cancel-tags]')?.addEventListener('click', () => cleanup({ cancelled: true, tags: [] }));
      modal.querySelector('[data-confirm-tags]')?.addEventListener('click', () => {
        const inputTags = parseTags(input.value || '');
        const tags = [...new Set([...selectedTags, ...inputTags])];
        cleanup({ cancelled: false, tags });
      });

      document.body.appendChild(modal);
      input.focus();
    });
  }

  openRedeemModeModal(ticket) {
    const originalImage = ticket.originalImage || '';
    const isBatchTicket = (ticket.tags || []).includes('批量生成');
    const displayImage = isBatchTicket ? (ticket.image || originalImage) : originalImage;
    const hasOriginalImage = !!displayImage;
    const hasBarcodeSource = !!ticket.serial;
    const defaultMode = hasOriginalImage ? 'original' : 'barcode';
    const keywords = (this.app.state.settings.specificViewKeywords || []).length
      ? this.app.state.settings.specificViewKeywords
      : ['MOMO', '85度C'];
    const searchTarget = `${ticket.productName || ''}${(ticket.tags || []).join('')}`.toUpperCase();
    const isSpecificView = keywords.some((kw) => searchTarget.includes((kw || '').toUpperCase()));

    if (!hasOriginalImage && !hasBarcodeSource) {
      showToast('此票券缺少原圖與序號，無法開啟核銷模式', 'error');
      return;
    }

    const bcid = resolveBarcodeBcid(ticket.barcodeFormat);
    const safeBcid = ['qrcode', 'datamatrix', 'azteccode', 'pdf417', 'maxicode'].includes(bcid)
      ? 'code128'
      : bcid;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[95] bg-black/72 backdrop-blur-sm flex items-center justify-center p-0';
    modal.innerHTML = `
      <div id="redeem-shell" class="w-full h-full rounded-none border-0 bg-white shadow-2xl p-3 md:p-4 flex flex-col">
        <div id="redeem-header" data-redeem-keepopen="1" class="flex items-start justify-between gap-3 mb-2 md:mb-3">
          <div class="min-w-0">
            <div class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 mb-1.5">
              <span>💡 建議將手機亮度調至最高</span>
            </div>
            <h3 class="text-xl md:text-2xl font-semibold text-wabi-primary">核銷模式</h3>
            <p class="text-base md:text-xl text-wabi-text-primary mt-1 break-words">${escapeHtml(ticket.productName || '未命名票券')}</p>
          </div>
        </div>

        <div id="redeem-mode-switch" data-redeem-keepopen="1" class="flex flex-wrap gap-2 mb-2 md:mb-3">
          <button type="button" data-redeem-mode="original" data-redeem-keepopen="1" class="px-4 py-2 rounded-lg text-sm md:text-base border border-wabi-border ${hasOriginalImage ? '' : 'opacity-45 cursor-not-allowed'}" ${hasOriginalImage ? '' : 'disabled aria-disabled="true"'}>票券圖片</button>
          <button type="button" data-redeem-mode="barcode" data-redeem-keepopen="1" class="px-4 py-2 rounded-lg text-sm md:text-base border border-wabi-border ${hasBarcodeSource ? '' : 'opacity-45 cursor-not-allowed'}" ${hasBarcodeSource ? '' : 'disabled aria-disabled="true"'}>條碼模式</button>
          <span class="text-xs md:text-sm text-wabi-text-secondary self-center">票券圖片優先，無圖片時自動切換條碼</span>
          ${hasOriginalImage && !hasBarcodeSource ? '<button type="button" data-scan-serial data-redeem-keepopen="1" class="px-4 py-2 rounded-lg text-sm md:text-base border border-wabi-primary text-wabi-primary bg-wabi-primary/10">從原圖掃描序號</button>' : ''}
        </div>

        <div id="barcode-variant-switch" data-redeem-keepopen="1" class="flex flex-wrap gap-2 mb-2 md:mb-3 ${defaultMode === 'barcode' ? '' : 'hidden'}">
          <button type="button" data-barcode-variant="standard" data-redeem-keepopen="1" class="px-3 py-1.5 rounded-lg text-xs md:text-sm border border-wabi-border">標準</button>
          <button type="button" data-barcode-variant="momo" data-redeem-keepopen="1" class="px-3 py-1.5 rounded-lg text-xs md:text-sm border border-wabi-border">專屬</button>
        </div>

        <div id="redeem-preview-wrap" class="flex-1 min-h-0 rounded-lg border border-wabi-border bg-slate-100 p-0 flex items-center justify-center overflow-hidden"></div>

        <div id="redeem-original-actions" data-redeem-keepopen="1" class="hidden fixed right-4 bottom-4 z-[96]">
          <button type="button" data-download-image data-redeem-keepopen="1" class="px-4 py-2 rounded-full bg-white/92 text-wabi-primary text-sm font-semibold border border-wabi-border shadow-lg backdrop-blur-sm">下載票券圖片</button>
        </div>

        <div id="redeem-footer" data-redeem-keepopen="1" class="mt-3 md:mt-4 flex justify-end gap-2">
          <button type="button" data-download-image data-redeem-keepopen="1" class="px-4 py-2.5 rounded-lg border border-wabi-border bg-white text-sm md:text-base">${hasOriginalImage ? '下載票券圖片' : '下載圖片'}</button>
          ${ticket.redeemUrl ? '<button type="button" data-open-redeem-url data-redeem-keepopen="1" class="px-4 py-2.5 rounded-lg bg-wabi-accent/30 text-wabi-primary text-sm md:text-base">開啟支付</button>' : ''}
          <button type="button" data-confirm-redeem data-redeem-keepopen="1" class="px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm md:text-base ${ticket.completed ? 'opacity-50 cursor-not-allowed' : ''}" ${ticket.completed ? 'disabled aria-disabled="true"' : ''}>確認核銷</button>
        </div>
      </div>
    `;

    let mode = defaultMode;
    let barcodeVariant = isSpecificView ? 'momo' : 'standard';
    const previewWrap = modal.querySelector('#redeem-preview-wrap');
    const shell = modal.querySelector('#redeem-shell');
    const header = modal.querySelector('#redeem-header');
    const modeSwitch = modal.querySelector('#redeem-mode-switch');
    const barcodeVariantSwitch = modal.querySelector('#barcode-variant-switch');
    const footer = modal.querySelector('#redeem-footer');
    const originalActions = modal.querySelector('#redeem-original-actions');
    const downloadSource = ticket.image || ticket.originalImage || '';

    const updateModeButtonState = () => {
      modal.querySelectorAll('[data-redeem-mode]').forEach((btn) => {
        const btnMode = btn.dataset.redeemMode;
        const isActive = btnMode === mode;
        btn.classList.toggle('bg-wabi-primary', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('border-wabi-primary', isActive);
      });

      const immersiveOriginal = mode === 'original' && hasOriginalImage;
      header?.classList.toggle('hidden', immersiveOriginal);
      modeSwitch?.classList.toggle('hidden', immersiveOriginal);
      footer?.classList.toggle('hidden', immersiveOriginal);
      originalActions?.classList.toggle('hidden', !(immersiveOriginal && downloadSource));

      if (shell) {
        shell.classList.toggle('p-0', immersiveOriginal);
        shell.classList.toggle('bg-black', immersiveOriginal);
        shell.classList.toggle('p-3', !immersiveOriginal);
        shell.classList.toggle('md:p-4', !immersiveOriginal);
        shell.classList.toggle('bg-white', !immersiveOriginal);
      }

      if (previewWrap) {
        previewWrap.classList.toggle('border-0', immersiveOriginal);
        previewWrap.classList.toggle('rounded-none', immersiveOriginal);
        previewWrap.classList.toggle('bg-black', immersiveOriginal);
        previewWrap.classList.toggle('border', !immersiveOriginal);
        previewWrap.classList.toggle('border-wabi-border', !immersiveOriginal);
        previewWrap.classList.toggle('rounded-lg', !immersiveOriginal);
        previewWrap.classList.toggle('bg-slate-100', !immersiveOriginal);
      }

      if (barcodeVariantSwitch) {
        barcodeVariantSwitch.classList.toggle('hidden', immersiveOriginal || mode !== 'barcode');
      }

      modal.querySelector('[data-scan-serial]')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        showToast('正在辨識條碼...');
        const { scanMultipleBarcodesFromImage } = await import('../services/barcodeService.js');
        const results = await scanMultipleBarcodesFromImage(displayImage, { preferredFormat: ticket.barcodeFormat || '' });
        if (!results.length) {
          showToast('未從原圖找到條碼，請改從編輯頁輸入序號', 'error');
          return;
        }
        ticket.serial = results[0].content;
        if (results[0].format && !ticket.barcodeFormat) ticket.barcodeFormat = results[0].format;
        await this.app.persistTasks();
        showToast('已從原圖帶入序號', 'success');
        cleanup();
        this.openRedeemModeModal(ticket);
        this.render();
      } catch (error) {
        console.warn('原圖掃描序號失敗', error);
        showToast('條碼辨識失敗', 'error');
      } finally {
        btn.disabled = false;
      }
    });

    modal.querySelectorAll('[data-barcode-variant]').forEach((btn) => {
        const isActive = btn.dataset.barcodeVariant === barcodeVariant;
        btn.classList.toggle('bg-wabi-primary', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('border-wabi-primary', isActive);
      });
    };

    const drawBarcodeCanvas = async (canvas, _targetBcid = safeBcid, scale = 3, height = 10) => {
      await renderBarcodeCanvas(canvas, ticket.serial, ticket.barcodeFormat || 'CODE_128', { scale, height });
    };

    const drawQrCanvas = async (canvas, size = 180) => {
      await renderQrCanvas(canvas, ticket.serial || '', size);
    };

    const renderStandardBarcodePreview = () => {
      if (!ticket.serial) {
        previewWrap.innerHTML = '<div class="w-48 h-48 flex items-center justify-center text-slate-500 border-2 border-dashed border-slate-300 rounded-2xl font-semibold">無序號</div>';
        return;
      }
      previewWrap.innerHTML = `
        <div class="w-full h-full flex flex-col items-center justify-center gap-4 p-3 md:p-5 cursor-pointer" data-redeem-tap-trigger="1">
          <div class="w-full max-w-4xl bg-white border border-wabi-border rounded-xl p-2 shadow-sm">
            <canvas id="redeem-barcode-canvas" class="w-full"></canvas>
          </div>
          <div class="p-3 bg-white border border-wabi-border rounded-[28px] shadow-sm">
            <canvas id="redeem-qr-canvas" class="rounded-2xl"></canvas>
          </div>
          <div class="text-center">
            <span class="text-[11px] text-slate-500 block mb-1">電子券號</span>
            <span class="font-mono text-lg font-bold text-slate-800 px-4 py-1 rounded-full border border-wabi-border bg-white">${escapeHtml(ticket.serial || 'N/A')}</span>
          </div>
        </div>
      `;
      const barcodeCanvas = previewWrap.querySelector('#redeem-barcode-canvas');
      const qrCanvas = previewWrap.querySelector('#redeem-qr-canvas');
      if (!barcodeCanvas || !qrCanvas) return;

      drawBarcodeCanvas(barcodeCanvas, safeBcid, 3, 10);
      drawQrCanvas(qrCanvas, 180);
    };

    const renderMomoBarcodePreview = () => {
      if (!ticket.serial) {
        previewWrap.innerHTML = '<div class="w-48 h-48 flex items-center justify-center text-slate-500 border-2 border-dashed border-slate-300 rounded-2xl font-semibold">無序號</div>';
        return;
      }
      previewWrap.innerHTML = `
        <div class="w-full h-full p-2 md:p-4 cursor-pointer" data-redeem-tap-trigger="1">
          <div class="w-full h-full flex flex-col bg-white border border-wabi-border rounded-2xl overflow-hidden shadow-xl">
            <div class="bg-pink-500 px-4 py-2.5 flex justify-between items-center text-white shrink-0">
              <span class="text-[11px] font-black tracking-widest opacity-95">電子票券明細</span>
              <span class="text-xs opacity-70">i</span>
            </div>
            <div class="flex-1 overflow-y-auto">
              <div class="p-3 space-y-3">
                <div class="flex gap-3">
                  <div class="w-20 h-20 shrink-0 border border-wabi-border rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center">
                    ${ticket.image ? `<img src="${ticket.image}" class="w-full h-full object-cover" />` : '<span class="text-slate-400 text-xs">無圖</span>'}
                  </div>
                  <div class="flex-1 min-w-0 flex items-center">
                    <h2 class="text-[15px] font-black text-slate-800 leading-tight line-clamp-2">${escapeHtml(ticket.productName || '未命名票券')}</h2>
                  </div>
                </div>
                <div class="border-t border-dashed border-slate-300"></div>
                <div class="bg-slate-100 rounded-xl p-3 flex flex-col items-center gap-3">
                  <div class="w-full px-2">
                    <canvas id="redeem-barcode-canvas-momo" class="w-full bg-white rounded-lg border border-wabi-border"></canvas>
                  </div>
                  <div class="p-1.5 bg-white border border-wabi-border rounded-lg shadow-sm">
                    <canvas id="redeem-qr-canvas-momo" class="rounded-xl"></canvas>
                  </div>
                  <div class="text-center">
                    <p class="text-[10px] font-bold text-slate-500 mb-0.5">電子券號</p>
                    <p class="text-[13px] font-mono font-black text-slate-800 tracking-wider break-all px-4">${escapeHtml(ticket.serial || '')}</p>
                  </div>
                </div>
                <div class="flex justify-between items-center text-xs">
                  <span class="font-bold text-slate-500">兌換期限</span>
                  <span class="font-black text-pink-600 tracking-tight">${escapeHtml(ticket.expiry || '無效期限制')}</span>
                </div>
              </div>
            </div>
            <div class="px-4 py-2 bg-slate-100 border-t border-wabi-border shrink-0 flex justify-between items-center">
              <span class="text-[9px] font-bold text-slate-500">票券管家 Pro</span>
            </div>
          </div>
        </div>
      `;
      const barcodeCanvas = previewWrap.querySelector('#redeem-barcode-canvas-momo');
      const qrCanvas = previewWrap.querySelector('#redeem-qr-canvas-momo');
      if (!barcodeCanvas || !qrCanvas) return;
      drawBarcodeCanvas(barcodeCanvas, safeBcid, 3, 10);
      drawQrCanvas(qrCanvas, 110);
    };

    const renderBarcodePreview = () => {
      if (barcodeVariant === 'momo') {
        renderMomoBarcodePreview();
        return;
      }
      renderStandardBarcodePreview();
    };

    const renderPreview = () => {
      if (mode === 'original') {
        if (!hasOriginalImage) {
          mode = 'barcode';
          renderPreview();
          return;
        }
        previewWrap.innerHTML = `
          <img src="${displayImage}" alt="替換後票券圖片" data-original-redeem-trigger="1" data-redeem-keepopen="1" class="h-full w-full object-contain bg-black cursor-pointer" />
        `;
        updateModeButtonState();
        return;
      }

      if (!hasBarcodeSource) {
        mode = 'original';
        renderPreview();
        return;
      }

      renderBarcodePreview();
      updateModeButtonState();
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') cleanup();
    };

    const triggerImageDownload = () => {
      if (!downloadSource) {
        showToast('此票券沒有可下載圖片', 'error');
        return;
      }

      const baseName = (ticket.productName || 'ticket').trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || 'ticket';
      const fileName = `${baseName}-${ticket.id || 'image'}.jpg`;
      const link = document.createElement('a');
      link.href = downloadSource;
      link.download = fileName;
      link.rel = 'noopener';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    let redeeming = false;
    let suppressNextModalClick = false;
    let suppressPreviewClick = false;

    const cleanup = () => {
      window.removeEventListener('keydown', onKeydown);
      modal.remove();
    };

    const redeemTicket = async ({ requireRedeemConfirm = true, confirmBeforeOpenUrl = true, closeOnCancel = false } = {}) => {
      if (redeeming) return;
      if (ticket.completed) {
        showToast('此票券已核銷，無法再次核銷', 'error');
        return;
      }

      if (requireRedeemConfirm) {
        const ok = window.confirm(`確定核銷「${ticket.productName || '未命名票券'}」？`);
        if (!ok) {
          if (closeOnCancel) {
            cleanup();
            this.render();
          }
          return;
        }
      }

      redeeming = true;
      try {
        ticket.completed = true;
        ticket.completedAt = Date.now();
        ticket.pinned = false;
        await this.app.persistTasks();
        await this.app.sendRedeemNotification(ticket);

        if (ticket.redeemUrl) {
          let shouldOpen = true;
          if (confirmBeforeOpenUrl) {
            shouldOpen = window.confirm('核銷完成，是否前往兌換網址？');
          }
          if (shouldOpen) {
            window.open(ticket.redeemUrl, '_blank', 'noopener');
          }
        }

        showToast('票券已核銷', 'success');
        cleanup();
        this.render();
      } finally {
        redeeming = false;
      }
    };

    modal.addEventListener('click', (event) => {
      if (suppressNextModalClick) return;
      const keepOpenTarget = event.target.closest('[data-redeem-keepopen]');
      if (keepOpenTarget) return;
    });

    modal.querySelectorAll('[data-redeem-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = btn.dataset.redeemMode;
        if (!nextMode) return;
        mode = nextMode;
        renderPreview();
      });
    });

    modal.querySelectorAll('[data-barcode-variant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextVariant = btn.dataset.barcodeVariant;
        if (!nextVariant) return;
        barcodeVariant = nextVariant;
        renderBarcodePreview();
        updateModeButtonState();
      });
    });

    modal.querySelector('[data-confirm-redeem]')?.addEventListener('click', () => {
      redeemTicket({ requireRedeemConfirm: true, confirmBeforeOpenUrl: true });
    });

    modal.querySelector('[data-open-redeem-url]')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (ticket.redeemUrl) window.open(ticket.redeemUrl, '_blank', 'noopener');
    });

    modal.querySelectorAll('[data-download-image]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        triggerImageDownload();
      });
    });

    previewWrap?.addEventListener('click', (event) => {
      if (suppressPreviewClick) {
        suppressPreviewClick = false;
        return;
      }
      const trigger = event.target.closest('[data-original-redeem-trigger], [data-redeem-tap-trigger]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      redeemTicket({ requireRedeemConfirm: true, confirmBeforeOpenUrl: true, closeOnCancel: true });
    });

    if (shell) {
      const SWIPE_LOCK_DISTANCE = 12;
      const SWIPE_TRIGGER_DISTANCE = 72;
      let tracking = false;
      let startX = 0;
      let startY = 0;
      let lastDx = 0;
      let horizontalSwipe = false;

      shell.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return;
        if (event.target.closest('button, a, input, textarea, select, label, [data-redeem-ignore-swipe]')) return;
        tracking = true;
        horizontalSwipe = false;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
        lastDx = 0;
      }, { passive: true });

      shell.addEventListener('touchmove', (event) => {
        if (!tracking || event.touches.length !== 1) return;
        const dx = event.touches[0].clientX - startX;
        const dy = event.touches[0].clientY - startY;
        lastDx = dx;

        if (!horizontalSwipe) {
          if (Math.abs(dx) < SWIPE_LOCK_DISTANCE && Math.abs(dy) < SWIPE_LOCK_DISTANCE) return;
          horizontalSwipe = Math.abs(dx) > Math.abs(dy) * 1.15;
          if (!horizontalSwipe) {
            tracking = false;
            return;
          }
        }

        event.preventDefault();
      }, { passive: false });

      shell.addEventListener('touchcancel', () => {
        tracking = false;
        horizontalSwipe = false;
        lastDx = 0;
      });

      shell.addEventListener('touchend', () => {
        if (!tracking) return;
        tracking = false;
        if (!horizontalSwipe) return;

        const dx = lastDx;
        horizontalSwipe = false;
        lastDx = 0;
        if (Math.abs(dx) < SWIPE_TRIGGER_DISTANCE) return;

        suppressNextModalClick = true;
        suppressPreviewClick = true;
        setTimeout(() => {
          suppressNextModalClick = false;
          suppressPreviewClick = false;
        }, 320);

        if (dx < 0) {
          showToast('已取消核銷', 'success', 700);
          cleanup();
          this.render();
          return;
        }

        redeemTicket({ requireRedeemConfirm: true, confirmBeforeOpenUrl: true });
      }, { passive: true });
    }

    document.body.appendChild(modal);
    window.addEventListener('keydown', onKeydown);
    renderPreview();
  }

  buildCards(tickets, options = {}) {
    const showThumbnail = options.showThumbnail !== false;
    const compactGrid = !!options.compactGrid;
    const ultraCompactCard = !!options.ultraCompactCard;
    const gridColumns = [1, 2, 3].includes(Number(options.gridColumns)) ? Number(options.gridColumns) : 2;
    const hideTagAndSerial = gridColumns === 3;
    const cardOpacity = clamp(options.cardOpacity, 0, 1, GLASS_CARD_OPACITY);
    const isCardFullyTransparent = cardOpacity <= 0.01;
    const cardHeight = clamp(options.cardHeight, 0, 360, 0);
    const thumbnailScale = clamp(options.thumbnailScale, 10, 100, 100);
    const cardBgColor = options.cardBgColor || '#ffffff';
    const cardBorderColor = options.cardBorderColor || '#d7e3f0';
    const duplicateSerials = getDuplicateSerialSet(this.app.state.tasks);
    if (!tickets.length) {
      const meta = VIEW_META[this.view];
      const hasScope = !!this.app.state.ui.search.trim() || (this.app.state.ui.activeTags || []).length > 0;
      const actionHtml = hasScope
        ? '<button type="button" data-clear-scope="1" class="mt-4 rounded-lg bg-wabi-primary px-4 py-2 text-sm font-semibold text-white">清除篩選</button>'
        : this.view === 'active'
          ? '<a href="#add" class="mt-4 inline-flex rounded-lg bg-wabi-primary px-4 py-2 text-sm font-semibold text-white">新增第一張票券</a>'
          : '<a href="#active" class="ticket-empty-state-action mt-4 inline-flex rounded-lg px-4 py-2 text-sm font-semibold">回待使用票券</a>';
      const helperText = hasScope
        ? '目前搜尋或標籤篩選沒有符合的票券。'
        : this.view === 'active'
          ? '新增票券後會出現在這裡，可用標籤、原圖與到期提醒快速整理。'
          : this.view === 'completed'
            ? '核銷完成的票券會集中在這裡，方便日後查找。'
            : '刪除的票券會先放在回收桶，確認後再永久刪除。';
      return `
        <div class="ticket-empty-state col-span-full">
          <i class="fa-solid ${meta.icon} ticket-empty-state-icon"></i>
          <p class="ticket-empty-state-title">${meta.empty}</p>
          <p class="ticket-empty-state-text">${helperText}</p>
          ${actionHtml}
        </div>
      `;
    }

    return tickets.map((ticket) => {
      const isExpiring = !ticket.completed && !ticket.isDeleted && checkIsExpiringSoon(ticket.expiry, this.app.state.settings.notifyDays);
      const expiryState = !ticket.completed && !ticket.isDeleted
        ? getExpiryState(ticket.expiry, this.app.state.settings.notifyDays)
        : 'normal';
      const expiryCountdown = !ticket.completed && !ticket.isDeleted
        ? getExpiryCountdownLabel(ticket.expiry)
        : '';
      const isDuplicateSerial = duplicateSerials.has(ticket.serial);
      const thumbnailImage = typeof ticket.image === 'string' ? ticket.image.trim() : '';
      const hasOriginalImage = !!ticket.originalImage;
      const selected = this.app.state.ui.selectedIds.has(ticket.id);
      const selectedVisual = this.app.state.ui.selectionMode && selected;
      const selectionA11yAttrs = this.app.state.ui.selectionMode
        ? `tabindex="0" role="checkbox" aria-checked="${selected ? 'true' : 'false'}" aria-label="切換票券選取"`
        : '';
      const tagChipClass = this.view === 'active'
        ? 'ticket-tag ticket-tag--active px-2.5 py-1 rounded-lg text-xs border font-medium'
        : 'ticket-tag px-2 py-0.5 rounded-full text-xs bg-wabi-primary/10 text-wabi-primary hover:bg-wabi-primary/20';
      const visibleTags = (ticket.tags || []).slice(0, 2);
      const extraTagCount = (ticket.tags || []).length - visibleTags.length;
      const tagsHtml = visibleTags.map((tag) => `
        <button type="button" data-tag="${escapeHtml(tag)}" class="${tagChipClass}">#${escapeHtml(tag)}</button>
      `).join('') + (extraTagCount > 0 ? `<span class="px-2 py-1 rounded-lg text-xs text-wabi-text-secondary">+${extraTagCount}</span>` : '');

      const statusBadge = ticket.isDeleted
        ? ''
        : ticket.completed
          ? `<span class="text-xs rounded-full px-2 py-1 bg-emerald-100 text-emerald-700">已使用 ${formatDateTime(ticket.completedAt)}</span>`
          : isExpiring
            ? '<span class="text-xs rounded-full px-2 py-1 bg-amber-100 text-amber-700">即將到期</span>'
            : this.view === 'active'
              ? ''
              : '<span class="text-xs rounded-full px-2 py-1 bg-slate-100 text-slate-600">可使用</span>';
      const originalImageBadge = hasOriginalImage
        ? '<span class="text-xs rounded-full px-2 py-1 bg-sky-100 text-sky-700"><i class="fa-regular fa-image mr-1"></i>原圖</span>'
        : '';
      const serialHtml = gridColumns === 1 && ticket.serial
        ? `<p class="ticket-card-serial text-xs text-wabi-text-secondary font-mono break-all mt-1">序號：${escapeHtml(ticket.serial)}</p>`
        : '';
      const isActiveDuplicate = this.view === 'active' && isDuplicateSerial;
      const originalFrameClass = hasOriginalImage ? 'ticket-card--has-original' : '';
      const duplicateCardClass = isActiveDuplicate ? 'ticket-card--duplicate' : '';
      if (ultraCompactCard) {
        const compactPaddingClass = compactGrid ? 'p-2.5' : 'p-3';
        const cardStyle = `style="background-color: ${hexToRgba(cardBgColor, cardOpacity)}; border-color: ${hexToRgba(cardBorderColor, 0.55)};${isCardFullyTransparent ? ' box-shadow: none;' : ''}${cardHeight > 0 ? ` min-height: ${cardHeight}px;` : ''}"`;
        const compactExpiryCardClass = expiryState === 'expired'
          ? 'ticket-card--expiry-expired'
          : expiryState === 'today'
            ? 'ticket-card--expiry-today'
            : expiryState === 'soon'
              ? 'ticket-card--expiry-soon'
              : '';
        const compactExpiryClass = expiryState === 'expired'
          ? 'ticket-card-expiry--expired ticket-card-expiry--expired-pill'
          : expiryState === 'today'
            ? 'ticket-card-expiry--today ticket-card-expiry--today-pill'
            : expiryState === 'soon'
              ? 'ticket-card-expiry--soon ticket-card-expiry--soon-pill'
              : 'ticket-card-expiry--normal ticket-card-expiry--normal-pill';
        const compactExpiryPrefix = expiryState === 'expired'
          ? '<i class="fa-solid fa-triangle-exclamation mr-1"></i>已過期 · '
          : expiryState === 'today'
            ? '<i class="fa-regular fa-clock mr-1"></i>今天到期 · '
            : expiryState === 'soon'
              ? '<i class="fa-regular fa-clock mr-1"></i>即將到期 · '
              : '<i class="fa-regular fa-calendar mr-1"></i>到期 · ';
        const compactExpiryDisplay = expiryCountdown || escapeHtml(ticket.expiry || '無期限');
        const swipeMap = {
          active: { left: '核銷', right: '回收' },
          completed: { left: '還原', right: '回收' },
          deleted: { left: '清除', right: '還原' },
        };
        const swipeConfig = swipeMap[this.view];
        const swipeAttrs = swipeConfig
          ? `data-swipe-enabled="1" data-swipe-left-label="${swipeConfig.left}" data-swipe-right-label="${swipeConfig.right}"`
          : '';
        return `
          <article class="ticket-card ticket-card--ultra ${originalFrameClass} ${duplicateCardClass} ${compactExpiryCardClass} ${selectedVisual ? 'ticket-card--selected' : ''} rounded-2xl border ${compactPaddingClass} shadow-sm" data-ticket-id="${ticket.id}" ${selectionA11yAttrs} ${swipeAttrs} ${cardStyle}>
            <div class="flex items-start justify-between gap-1.5">
              <div class="flex items-start gap-2 min-w-0">
                ${this.app.state.ui.selectionMode ? `<input type="checkbox" data-select="${ticket.id}" ${selected ? 'checked' : ''} class="mt-0.5 h-3.5 w-3.5">` : ''}
                <div class="min-w-0">
                  <h3 class="ticket-card-title font-semibold text-wabi-primary text-[13px] leading-tight truncate">${escapeHtml(ticket.productName || '未命名票券')}</h3>
                  <p class="ticket-card-expiry ${compactExpiryClass} text-[11px] text-wabi-text-secondary mt-1">${compactExpiryPrefix}${compactExpiryDisplay}</p>
                  ${serialHtml}
                </div>
              </div>
              <div class="flex items-center gap-1">
                ${ticket.pinned && !ticket.completed && !ticket.isDeleted ? '<span class="ticket-card-pin-pill text-[10px] rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-700 whitespace-nowrap" title="置頂票券"><i class="fa-solid fa-thumbtack"></i></span>' : ''}
                ${hasOriginalImage ? '<span class="ticket-card-original-pill text-[10px] rounded-full px-1.5 py-0.5 bg-sky-100 text-sky-700 whitespace-nowrap"><i class="fa-regular fa-image mr-1"></i>原圖</span>' : ''}
              </div>
            </div>
          </article>
        `;
      }
      const showTagChips = !hideTagAndSerial && this.view !== 'deleted' && this.view !== 'completed';
      const tagBadges = this.view === 'deleted'
        ? `
            ${originalImageBadge}
          `
        : `
            ${originalImageBadge}
            ${showTagChips ? tagsHtml : ''}
            ${!hideTagAndSerial && isDuplicateSerial ? '<span class="text-xs rounded-full px-2 py-1 bg-orange-100 text-orange-700">重複序號</span>' : ''}
          `;
      const metaRow = (tagBadges || statusBadge)
        ? `
          <div class="flex items-center justify-between gap-2 mt-2">
            <div class="flex gap-1.5 flex-wrap">
              ${tagBadges}
            </div>
            ${statusBadge}
          </div>
        `
        : '';
      const compactMetaRow = statusBadge
        ? `<div class="ticket-card-compact-status mt-1">${statusBadge}</div>`
        : '';

      const primaryAction = ticket.isDeleted
        ? '<button data-action="restore" class="px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs">還原</button>'
        : ticket.completed
          ? '<button data-action="toggle-complete" class="px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs">取消已用</button>'
          : '';

      const secondaryAction = ticket.isDeleted
        ? '<button data-action="purge" class="px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs">永久刪除</button>'
        : this.view === 'active'
          ? ''
          : '<button data-action="delete" class="px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs">移至回收桶</button>';

      const redeemButton = ticket.redeemUrl && !ticket.isDeleted
        ? this.view === 'active'
          ? '<button data-action="redeem" class="px-3 py-1 rounded-lg bg-wabi-accent/30 text-wabi-primary text-xs">開啟支付</button>'
          : this.view === 'completed'
            ? ''
          : '<button data-action="redeem" class="px-3 py-1 rounded-lg bg-wabi-accent/30 text-wabi-primary text-xs">前往兌換</button>'
        : '';
      const editButton = this.view === 'completed' || this.view === 'deleted'
        ? ''
        : '<button data-action="edit" class="px-3 py-1 rounded-lg bg-wabi-primary/10 text-wabi-primary text-xs">編輯</button>';
      const standardExpiryClass = expiryState === 'expired'
        ? 'ticket-card-expiry-highlight ticket-card-expiry-highlight--expired'
        : expiryState === 'today'
          ? 'ticket-card-expiry-highlight ticket-card-expiry-highlight--today'
          : expiryState === 'soon'
            ? 'ticket-card-expiry-highlight ticket-card-expiry-highlight--soon'
            : 'ticket-card-expiry-highlight ticket-card-expiry-highlight--normal';
      const standardExpiryPrefix = expiryState === 'expired'
        ? '<i class="fa-solid fa-triangle-exclamation mr-1"></i>已過期 · '
        : expiryState === 'today'
          ? '<i class="fa-regular fa-clock mr-1"></i>今天到期 · '
          : expiryState === 'soon'
            ? '<i class="fa-regular fa-clock mr-1"></i>即將到期 · '
            : '<i class="fa-regular fa-calendar mr-1"></i>到期 · ';
      const standardExpiryDisplay = this.view === 'active'
        ? (ticket.expiry ? `${escapeHtml(ticket.expiry)}${expiryCountdown ? ` · ${escapeHtml(expiryCountdown)}` : ''}` : '無期限')
        : `${escapeHtml(ticket.expiry || '無期限')}${expiryCountdown ? ` <span class="ticket-card-expiry-countdown">${escapeHtml(expiryCountdown)}</span>` : ''}`;
      const cardPaddingClass = this.view === 'active'
        ? (compactGrid ? 'p-2.5' : 'p-3')
        : (compactGrid ? 'p-3' : 'p-4');
      const headerMarginClass = this.view === 'active' ? 'mb-2' : 'mb-3';
      const imageClass = this.view === 'active'
        ? 'ticket-card-thumbnail ticket-card-thumbnail--active ticket-card-thumbnail--active-floating'
        : (compactGrid
          ? 'w-full h-28 object-cover rounded-lg border border-wabi-border mb-2'
          : 'w-full h-40 object-cover rounded-xl border border-wabi-border mb-3');
      const imageWrapperClass = this.view === 'active'
        ? (compactGrid
          ? 'ticket-card-thumbnail-frame ticket-card-thumbnail-frame--active ticket-card-thumbnail-frame--compact ticket-card-thumbnail-frame--active-floating'
          : 'ticket-card-thumbnail-frame ticket-card-thumbnail-frame--active ticket-card-thumbnail-frame--active-floating')
        : '';
      const imageStyle = this.view === 'active'
        ? ` style="width: ${Math.round(Math.max(52, thumbnailScale))}%;"`
        : '';
      const cardStyle = `style="background-color: ${hexToRgba(cardBgColor, cardOpacity)}; border-color: ${hexToRgba(cardBorderColor, 0.55)};${isCardFullyTransparent ? ' box-shadow: none;' : ''}${cardHeight > 0 ? ` min-height: ${cardHeight}px;` : ''}"`;
      const swipeMap = {
        active: { left: '核銷', right: '回收' },
        completed: { left: '還原', right: '回收' },
        deleted: { left: '清除', right: '還原' },
      };
      const swipeConfig = swipeMap[this.view];
      const swipeAttrs = swipeConfig
        ? `data-swipe-enabled="1" data-swipe-left-label="${swipeConfig.left}" data-swipe-right-label="${swipeConfig.right}"`
        : '';
      // 2/3-column layouts are summary cards: hide media and secondary details
      // so the title and expiry state remain readable on narrow cards.
      const hasActiveThumbnail = showThumbnail && thumbnailImage && this.view === 'active' && !compactGrid;
      const displayedMetaRow = compactGrid ? compactMetaRow : metaRow;

      return `
          <article class="ticket-card ticket-card--grid-${gridColumns} ${originalFrameClass} ${duplicateCardClass} ${selectedVisual ? 'ticket-card--selected' : ''} rounded-2xl border ${cardPaddingClass} shadow-sm" data-ticket-id="${ticket.id}" ${selectionA11yAttrs} ${swipeAttrs} ${cardStyle}>
          <div class="flex items-start gap-3 ${headerMarginClass}">
            ${hasActiveThumbnail
              ? `<div class="app-card-thumb"><img src="${escapeHtml(thumbnailImage)}" alt="ticket thumbnail" /></div>`
              : ''}
            <div class="flex items-start gap-3 min-w-0 flex-1">
              ${this.app.state.ui.selectionMode ? `<input type="checkbox" data-select="${ticket.id}" ${selected ? 'checked' : ''} class="mt-1 h-4 w-4 shrink-0">` : ''}
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold text-wabi-primary text-base truncate">${escapeHtml(ticket.productName || '未命名票券')}</h3>
                    <p class="${standardExpiryClass}">${standardExpiryPrefix}${standardExpiryDisplay}</p>
                    ${serialHtml}
                  </div>
                  ${!ticket.completed && !ticket.isDeleted ? `<button data-action="toggle-pin" class="text-sm shrink-0 ${ticket.pinned ? 'text-amber-500' : 'text-slate-300'}" title="置頂">
                    <i class="fa-solid fa-thumbtack"></i>
                  </button>` : ''}
                </div>
              </div>
            </div>
          </div>

          ${showThumbnail && thumbnailImage && this.view !== 'active' && !compactGrid ? (
            compactGrid
              ? `<img src="${escapeHtml(thumbnailImage)}" alt="ticket thumbnail" class="${imageClass}"${imageStyle} />`
              : `<img src="${escapeHtml(thumbnailImage)}" alt="ticket thumbnail" class="${imageClass}"${imageStyle} />`
          ) : ''}

          ${displayedMetaRow}

          <div class="ticket-card-actions flex flex-wrap gap-2" data-no-swipe="1">
            ${editButton}
            ${primaryAction}
            ${secondaryAction}
            ${redeemButton}
          </div>
        </article>
      `;
    }).join('');
  }

  filterTickets() {
    const search = this.app.state.ui.search.trim().toLowerCase();
    const sortType = this.app.state.ui.sort;
    const activeTags = this.app.state.ui.activeTags;
    const notifyDays = this.app.state.settings.notifyDays;
    const duplicateSerials = getDuplicateSerialSet(this.app.state.tasks);

    let list = this.app.state.tasks.filter((ticket) => {
      if (this.view === 'active' && (ticket.completed || ticket.isDeleted)) return false;
      if (this.view === 'completed' && (!ticket.completed || ticket.isDeleted)) return false;
      if (this.view === 'deleted' && !ticket.isDeleted) return false;

      if (activeTags.length > 0 && !activeTags.some((tag) => {
        if (tag === ORIGINAL_IMAGE_FILTER_TAG) return !!ticket.originalImage;
        if (tag === EXPIRY_URGENT_FILTER_TAG) {
          if (this.view !== 'active') return false;
          const state = getExpiryState(ticket.expiry, notifyDays);
          return ['expired', 'today', 'soon'].includes(state);
        }
        if (tag === DUPLICATE_FILTER_TAG) return this.view === 'active' && duplicateSerials.has(ticket.serial);
        return (ticket.tags || []).includes(tag);
      })) {
        return false;
      }

      if (!search) return true;

      const haystack = [
        ticket.productName,
        ticket.serial,
        ticket.note,
        ticket.redeemUrl,
        ...(ticket.tags || []),
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(search);
    });

    // 待使用視圖才需要到期緊急度：先逐張預算一次，避免排序比較時重複解析日期。
    const expiryRankById = new Map();
    if (this.view === 'active') {
      const urgencyRank = {
        expired: 0,
        today: 1,
        soon: 2,
        normal: 3,
      };
      list.forEach((ticket) => {
        const state = getExpiryState(ticket.expiry, notifyDays);
        expiryRankById.set(ticket.id, urgencyRank[state] ?? urgencyRank.normal);
      });
    }

    list.sort((a, b) => {
      if (this.view === 'active' && duplicateSerials.has(a.serial) !== duplicateSerials.has(b.serial)) {
        return duplicateSerials.has(a.serial) ? -1 : 1;
      }
      // 置頂只適用於未使用票券：只有待使用視圖才讓置頂票券排到前面。
      if (this.view === 'active' && a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (this.view === 'completed') {
        if (sortType === 'redeemed-oldest') return (a.completedAt || 0) - (b.completedAt || 0);
        if (sortType === 'newest') return (b.createdAt || 0) - (a.createdAt || 0);
        if (sortType === 'oldest') return (a.createdAt || 0) - (b.createdAt || 0);
        return (b.completedAt || 0) - (a.completedAt || 0);
      }
      if (this.view === 'active') {
        const rankA = expiryRankById.get(a.id) ?? 3;
        const rankB = expiryRankById.get(b.id) ?? 3;
        if (rankA !== rankB) return rankA - rankB;
      }
      return getSortComparator(sortType)(a, b);
    });

    return list;
  }

  async render() {
    this.clearBackgroundRotationTimer();
    this.clearBackgroundInsetHandler();
    this.showSwipeHintIfNeeded();
    const meta = VIEW_META[this.view];
    const tickets = this.filterTickets();
    const viewConfig = this.app.state.settings.viewConfigs?.[this.view] || {};
    const { gridColumns, showThumbnail, compactGrid, ultraCompactCard, cardOpacity, cardHeight, thumbnailScale, cardBgColor, cardBorderColor, ticketGridClass } = this.getCardRenderOptions();
    const backgroundImage = viewConfig.backgroundImage || '';
    const backgroundImages = Array.isArray(viewConfig.backgroundImages)
      ? viewConfig.backgroundImages.filter(Boolean)
      : [];
    if (!backgroundImages.length && backgroundImage) {
      backgroundImages.push(backgroundImage);
    }
    const showBackground = viewConfig.showBackground !== false;
    const bgOpacity = clamp(viewConfig.bgOpacity, 0, 1, 1);
    if (backgroundImages.length > 0) {
      this.backgroundRotationIndex = this.backgroundRotationIndex % backgroundImages.length;
      if (this.backgroundRotationIndex < 0) this.backgroundRotationIndex = 0;
    } else {
      this.backgroundRotationIndex = 0;
    }
    const initialBackgroundImage = backgroundImages[this.backgroundRotationIndex] || '';
    const backgroundLayerHtml = initialBackgroundImage && showBackground
      ? `<div class="ticket-view-bg-layer" style="background-image: url('${escapeHtml(initialBackgroundImage)}'); opacity: ${bgOpacity};"></div>`
      : '';
    const allTags = [...new Set(this.app.state.tasks.flatMap((t) => t.tags || []))].sort();
    const duplicateSerials = getDuplicateSerialSet(this.app.state.tasks);
    const duplicateActiveCount = this.app.state.tasks.filter((ticket) => !ticket.completed && !ticket.isDeleted && duplicateSerials.has(ticket.serial)).length;
    const urgentActiveCount = this.app.state.tasks.filter((ticket) => {
      if (ticket.completed || ticket.isDeleted) return false;
      const state = getExpiryState(ticket.expiry, this.app.state.settings.notifyDays);
      return state === 'expired' || state === 'today' || state === 'soon';
    }).length;
    const activeTotalCount = this.app.state.tasks.filter((ticket) => !ticket.completed && !ticket.isDeleted).length;
    const completedTotalCount = this.app.state.tasks.filter((ticket) => ticket.completed && !ticket.isDeleted).length;
    const deletedTotalCount = this.app.state.tasks.filter((ticket) => ticket.isDeleted).length;
    const activeTagLabels = this.app.state.ui.activeTags.map((tag) => (
      tag === ORIGINAL_IMAGE_FILTER_TAG
        ? '原圖'
        : tag === EXPIRY_URGENT_FILTER_TAG
          ? '到期警示'
          : tag === DUPLICATE_FILTER_TAG
            ? '重複票券'
          : `#${escapeHtml(tag)}`
    ));
    const selectedCount = this.app.state.ui.selectedIds.size;
    const visibleTicketIds = new Set(tickets.map((ticket) => ticket.id));
    const selectedVisibleCount = [...this.app.state.ui.selectedIds].filter((id) => visibleTicketIds.has(id)).length;
    const isAllVisibleSelected = tickets.length > 0 && selectedVisibleCount === tickets.length;
    const hasSelection = selectedCount > 0;
    const selectionCountChanged = this.lastSelectedCount !== null && this.lastSelectedCount !== selectedCount;
    this.lastSelectedCount = selectedCount;
    const isCompactBatchBar = !hasSelection && !this.app.state.ui.keepSelectionMode;
    const searchKeyword = this.app.state.ui.search.trim();
    const tagScope = activeTagLabels.join('、');
    const scopeParts = [];
    if (searchKeyword) scopeParts.push(`關鍵字「${escapeHtml(searchKeyword)}」`);
    if (tagScope) scopeParts.push(`標籤 ${tagScope}`);
    const compactScopeText = scopeParts.length ? `目前範圍：${scopeParts.join('、')}` : '目前範圍：全部票券';
    const batchButton = (action, label, baseClass, enabled = hasSelection) => `
      <button type="button" data-batch="${action}" class="${baseClass} ${enabled ? '' : 'opacity-50 cursor-not-allowed'}" ${enabled ? '' : 'disabled aria-disabled="true"'}>${label}</button>
    `;
    const gridIconClass = gridColumns === 1
      ? 'fa-solid fa-grip-lines-vertical'
      : gridColumns === 2
        ? 'fa-solid fa-table-columns'
        : 'fa-solid fa-grip';
    const currentViewTotal = this.view === 'active'
      ? activeTotalCount
      : this.view === 'completed'
        ? completedTotalCount
        : deletedTotalCount;
    const pinnedVisibleCount = tickets.filter((ticket) => ticket.pinned && !ticket.completed && !ticket.isDeleted).length;
    const viewStatusCaption = this.view === 'active'
      ? `快到期 ${urgentActiveCount} 張${pinnedVisibleCount ? ` · 優先 ${pinnedVisibleCount} 張` : ''}`
      : this.view === 'completed'
        ? `已核銷 ${completedTotalCount} 張`
        : `待整理 ${deletedTotalCount} 張`;

    this.app.mount(`
      ${backgroundLayerHtml}
      <section class="page active relative z-10 px-4 pt-0 pb-24 md:pb-8 max-w-5xl mx-auto">
        <div id="tickets-top-bar-spacer" aria-hidden="true"></div>
        <div id="tickets-top-bar" class="app-top-bar z-30 -mx-4 px-4 pb-2 mb-3" style="padding-top: 0.5rem;">
          <header class="flex items-center justify-between mb-2 gap-3">
            <div class="min-w-0 flex items-baseline gap-2">
              <h1 class="text-xl leading-tight font-black text-wabi-primary truncate tracking-normal">${escapeHtml(this.app.state.settings.appTitle)}</h1>
              <span class="text-[11px] text-wabi-text-secondary font-semibold shrink-0">${meta.title}</span>
              ${!this.app.state.ui.selectionMode && this.app.state.ui.keepSelectionMode && selectedCount > 0
                ? `<span class="text-[11px] text-amber-700 shrink-0">已保留 ${selectedCount} 張選取</span>`
                : ''}
            </div>
            <div class="flex items-center gap-1.5 shrink-0 relative">
              <a href="#add" title="新增票券" class="app-add-button hidden md:inline-flex"><i class="fa-solid fa-plus text-xs"></i><span>新增</span></a>
              <button id="toggle-toolbar-menu" aria-expanded="false" title="更多功能" class="app-icon-button"><i class="fa-solid fa-ellipsis"></i></button>
              <div id="toolbar-more-menu" class="hidden absolute right-10 top-11 w-48 rounded-xl border border-wabi-border bg-white shadow-xl p-2 space-y-1 z-40">
                <button id="quick-grid-columns" title="切換欄數（目前 ${gridColumns} 欄）" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-white hover:bg-slate-50 border border-transparent">
                  <i class="${gridIconClass} mr-2 text-xs"></i>切換欄數（${gridColumns} 欄）
                </button>
                <button id="toggle-selection-btn" aria-pressed="${this.app.state.ui.selectionMode ? 'true' : 'false'}" title="${this.app.state.ui.selectionMode ? '取消多選' : '開啟多選'}" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-white hover:bg-slate-50 border border-transparent">
                  <i class="fa-solid ${this.app.state.ui.selectionMode ? 'fa-check-double' : 'fa-rectangle-list'} mr-2 text-xs"></i>${this.app.state.ui.selectionMode ? '取消多選' : '多選模式'}
                </button>
                <button id="toggle-ultra-compact-btn" title="${ultraCompactCard ? '切換標準卡片' : '切換超精簡卡片'}" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-white hover:bg-slate-50 border border-transparent">
                  <i class="fa-solid ${ultraCompactCard ? 'fa-expand' : 'fa-compress'} mr-2 text-xs"></i>${ultraCompactCard ? '標準卡片' : '超精簡卡片'}
                </button>
                ${backgroundImages.length > 0
                  ? `<button id="toggle-view-background" title="${showBackground ? '隱藏背景' : '顯示背景'}" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-white hover:bg-slate-50 border border-transparent"><i class="fa-solid ${showBackground ? 'fa-eye-slash' : 'fa-image'} mr-2 text-xs"></i>${showBackground ? '隱藏背景' : '顯示背景'}</button>`
                  : ''}
                ${backgroundImages.length > 1
                  ? `<button id="cycle-view-background" title="切換下一張背景" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-white hover:bg-slate-50 border border-transparent"><i class="fa-solid fa-images mr-2 text-xs"></i>下一張背景</button>`
                  : ''}
                ${this.view === 'completed' || this.view === 'deleted'
                  ? `<button id="quick-clear-completed-to-trash" title="一鍵全部回收（${completedTotalCount}）" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-red-50 text-red-700 hover:bg-red-100 border border-transparent ${completedTotalCount > 0 ? '' : 'opacity-50 cursor-not-allowed'}" ${completedTotalCount > 0 ? '' : 'disabled aria-disabled="true"'}><i class="fa-solid fa-box-archive mr-2 text-xs"></i>一鍵全部回收</button>`
                  : ''}
                ${this.view === 'deleted'
                  ? `<button id="quick-purge-deleted" title="全部永久刪除（${deletedTotalCount}）" class="w-full px-3 py-2 rounded-lg text-left text-sm bg-red-50 text-red-700 hover:bg-red-100 border border-transparent ${deletedTotalCount > 0 ? '' : 'opacity-50 cursor-not-allowed'}" ${deletedTotalCount > 0 ? '' : 'disabled aria-disabled="true"'}><i class="fa-solid fa-trash-can mr-2 text-xs"></i>全部永久刪除</button>`
                  : ''}
              </div>
              <a id="open-settings-btn" href="#settings" title="設定" class="app-icon-button"><i class="fa-solid fa-gear"></i></a>
            </div>
          </header>

          <div class="flex items-center gap-2 mb-1.5">
            <label class="relative flex-1 min-w-0">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-wabi-text-secondary"></i>
              <input id="ticket-search" value="${escapeHtml(this.app.state.ui.search)}" placeholder="搜尋票券、標籤或序號" class="app-search-input w-full pl-9 ${searchKeyword ? 'pr-9' : 'pr-3'}" />
              <button type="button" data-clear-search="1" class="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-full text-slate-400 hover:text-slate-700 ${searchKeyword ? '' : 'hidden'}" aria-label="清除搜尋"><i class="fa-solid fa-xmark text-xs"></i></button>
            </label>
          </div>

          <div class="app-summary-cards" aria-label="票券摘要">
            <div class="app-summary-card">
              <span class="app-summary-card__label">目前顯示</span>
              <strong class="app-summary-card__value">${tickets.length}</strong>
            </div>
            <div class="app-summary-card app-summary-card--warning">
              <span class="app-summary-card__label">到期警示</span>
              <strong class="app-summary-card__value">${urgentActiveCount}</strong>
            </div>
            <div class="app-summary-card app-summary-card--success">
              <span class="app-summary-card__label">已核銷</span>
              <strong class="app-summary-card__value">${completedTotalCount}</strong>
            </div>
          </div>

          <p id="tickets-summary-line" class="app-summary-line mb-1.5">${this.buildSummaryLineHtml({ ticketsCount: tickets.length, currentViewTotal, viewStatusCaption, compactScopeText, hasScope: !!searchKeyword || this.app.state.ui.activeTags.length > 0 })}</p>

          <div class="flex items-center gap-2">
            <div class="app-chip-row flex-1 min-w-0" role="group" aria-label="標籤篩選">
              <button type="button" data-tag-filter="" class="app-filter-chip ${this.app.state.ui.activeTags.length === 0 ? 'app-filter-chip--active' : ''}">全部</button>
              ${this.view === 'active'
                ? `<button type="button" data-tag-filter="${EXPIRY_URGENT_FILTER_TAG}" class="app-filter-chip app-filter-chip--warning ${(this.app.state.ui.activeTags || []).includes(EXPIRY_URGENT_FILTER_TAG) ? 'app-filter-chip--active' : ''}">到期警示 ${urgentActiveCount}</button><button type="button" data-tag-filter="${DUPLICATE_FILTER_TAG}" class="app-filter-chip app-filter-chip--duplicate ${(this.app.state.ui.activeTags || []).includes(DUPLICATE_FILTER_TAG) ? 'app-filter-chip--active' : ''}">重複 ${duplicateActiveCount}</button>`
                : ''}
              <button type="button" data-tag-filter="${ORIGINAL_IMAGE_FILTER_TAG}" class="app-filter-chip ${(this.app.state.ui.activeTags || []).includes(ORIGINAL_IMAGE_FILTER_TAG) ? 'app-filter-chip--active' : ''}">原圖</button>
              ${allTags.map((tag) => `<button type="button" data-tag-filter="${escapeHtml(tag)}" class="app-filter-chip ${(this.app.state.ui.activeTags || []).includes(tag) ? 'app-filter-chip--active' : ''}">#${escapeHtml(tag)}</button>`).join('')}
            </div>
            <select id="ticket-sort" class="app-sort-select app-sort-select--slim shrink-0" aria-label="排序">
              ${this.view === 'completed'
                ? `
                  <option value="redeemed-newest" ${this.app.state.ui.sort === 'redeemed-newest' || this.app.state.ui.sort === 'expiring' ? 'selected' : ''}>核銷新到舊</option>
                  <option value="redeemed-oldest" ${this.app.state.ui.sort === 'redeemed-oldest' ? 'selected' : ''}>核銷舊到新</option>
                  <option value="newest" ${this.app.state.ui.sort === 'newest' ? 'selected' : ''}>最新建立</option>
                  <option value="oldest" ${this.app.state.ui.sort === 'oldest' ? 'selected' : ''}>最早建立</option>
                `
                : `
                  <option value="expiring" ${this.app.state.ui.sort === 'expiring' ? 'selected' : ''}>即將到期</option>
                  <option value="newest" ${this.app.state.ui.sort === 'newest' ? 'selected' : ''}>最新建立</option>
                  <option value="oldest" ${this.app.state.ui.sort === 'oldest' ? 'selected' : ''}>最早建立</option>
                `
              }
            </select>
          </div>
        </div>
        </div>

        ${this.app.state.ui.selectionMode ? `
          <div class="batch-toolbar mb-4 p-3 rounded-xl bg-white border border-wabi-border flex flex-wrap gap-2 items-center justify-between">
            <div class="flex flex-col gap-1">
              <span class="text-sm text-wabi-text-secondary ${selectionCountChanged ? 'selection-count--pulse' : ''}" aria-live="polite" aria-atomic="true">已選取 ${selectedVisibleCount}/${tickets.length} 張${selectedCount !== selectedVisibleCount ? `（總選取 ${selectedCount}）` : ''}</span>
              <label class="inline-flex items-center gap-2 text-xs text-wabi-text-secondary">
                <input id="keep-selection-mode" type="checkbox" ${this.app.state.ui.keepSelectionMode ? 'checked' : ''} />
                保留多選模式（批次後不自動退出）
              </label>
              ${this.continueBatchHint && this.app.state.ui.keepSelectionMode && hasSelection
                ? '<button id="continue-batch-hint-btn" type="button" class="continue-batch-hint text-xs text-emerald-700 text-left underline decoration-dotted underline-offset-2" aria-label="聚焦到批次工具列第一個可用操作" title="按 Enter 或空白鍵可聚焦到批次操作">可繼續批次操作</button>'
                : ''}
            </div>
            <div class="flex gap-2 flex-wrap batch-actions ${isCompactBatchBar ? 'batch-actions--compact' : 'batch-actions--expanded'}">
              ${batchButton('select-all', isAllVisibleSelected ? '取消全選' : '全選', 'px-3 py-1 rounded-lg bg-slate-100 text-xs', tickets.length > 0)}
              ${isCompactBatchBar
                ? `
                  <span class="text-xs text-wabi-text-secondary px-2 py-1">尚未選取票券，先全選或逐張勾選</span>
                  <span class="text-xs text-wabi-text-secondary px-2 py-1">${compactScopeText}</span>
                  <button type="button" data-batch="select-all-shortcut" class="px-3 py-1 rounded-lg bg-wabi-primary/10 text-wabi-primary text-xs ${tickets.length > 0 ? '' : 'opacity-50 cursor-not-allowed'}" ${tickets.length > 0 ? '' : 'disabled aria-disabled="true"'}>一鍵全選 ${tickets.length} 張</button>
                `
                : `
                  ${batchButton('clear', '清除', 'px-3 py-1 rounded-lg bg-slate-100 text-xs', hasSelection)}
                  ${this.view !== 'deleted' ? batchButton('delete', '批次回收', 'px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs') : ''}
                  ${this.view === 'deleted' ? `${batchButton('restore', '批次還原', 'px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs')}${batchButton('purge', '批次永久刪除', 'px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs')}` : ''}
                  ${this.view === 'active' ? batchButton('complete', '批次已用', 'px-3 py-1 rounded-lg bg-emerald-100 text-emerald-700 text-xs') : ''}
                  ${this.view === 'completed' ? batchButton('uncomplete', '批次取消已用', 'px-3 py-1 rounded-lg bg-slate-100 text-xs') : ''}
                  ${this.view === 'active' ? `${batchButton('pin', '批次置頂', 'px-3 py-1 rounded-lg bg-amber-100 text-amber-700 text-xs')}${batchButton('unpin', '批次取消置頂', 'px-3 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs')}` : ''}
                  ${batchButton('add-tag', '批次加標籤', 'px-3 py-1 rounded-lg bg-wabi-primary/10 text-wabi-primary text-xs')}
                  ${batchButton('remove-tag', '批次移標籤', 'px-3 py-1 rounded-lg bg-wabi-primary/10 text-wabi-primary text-xs')}
                  ${batchButton('apply-template', '批次套用範本', 'px-3 py-1 rounded-lg bg-wabi-primary/10 text-wabi-primary text-xs')}
                  ${batchButton('set-redeem-url', '批次設定兌換網址', 'px-3 py-1 rounded-lg bg-wabi-accent/40 text-wabi-primary text-xs')}
                `}
            </div>
          </div>
        ` : ''}

        <div id="tickets-grid" class="${ticketGridClass} ${ultraCompactCard ? 'ticket-grid--ultra' : ''}">${this.buildCards(tickets, { showThumbnail, compactGrid, ultraCompactCard, gridColumns, cardOpacity, cardHeight, thumbnailScale, cardBgColor, cardBorderColor })}</div>
      </section>
    `);

    this.bindEvents();
    this.app.syncNavVisibility?.();
    this.syncTopBarSpacer();
    requestAnimationFrame(() => this.syncTopBarSpacer());
    this.updateBackgroundLayerInset();
    this.backgroundInsetHandler = () => {
      this.updateBackgroundLayerInset();
      this.syncTopBarSpacer();
    };
    window.addEventListener('resize', this.backgroundInsetHandler);
    window.addEventListener('orientationchange', this.backgroundInsetHandler);
    window.visualViewport?.addEventListener('resize', this.backgroundInsetHandler);
    this.startBackgroundRotation(backgroundImages, showBackground);
  }

  bindCardEvents(root) {
    root.querySelectorAll('[data-select]').forEach((box) => {
      box.addEventListener('change', () => {
        const id = box.dataset.select;
        if (!id) return;
        if (box.checked) this.app.state.ui.selectedIds.add(id);
        else this.app.state.ui.selectedIds.delete(id);
        this.hideContinueBatchHint();
        this.render();
      });
    });

    const toggleCardSelection = (ticketId) => {
      if (!ticketId || !this.app.state.ui.selectionMode) return;
      if (this.app.state.ui.selectedIds.has(ticketId)) {
        this.app.state.ui.selectedIds.delete(ticketId);
      } else {
        this.app.state.ui.selectedIds.add(ticketId);
      }
      this.hideContinueBatchHint();
      this.render();
    };

    root.querySelectorAll('.ticket-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        const target = event.target;
        if (target.closest('button, a, input, textarea, select, label')) return;
        if (card.dataset.swipeSuppressClick === '1') {
          card.dataset.swipeSuppressClick = '0';
          return;
        }
        const ticketId = card.dataset.ticketId;
        if (!ticketId) return;

        if (this.app.state.ui.selectionMode) {
          toggleCardSelection(ticketId);
          return;
        }

        const ticket = this.app.state.tasks.find((item) => item.id === ticketId);
        if (!ticket || ticket.isDeleted) return;
        if (ticket.completed) {
          showToast('此票券已核銷，請至已使用視圖管理', 'success');
          return;
        }

        this.openRedeemModeModal(ticket);
      });

      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const target = event.target;
        if (target.closest('button, a, input, textarea, select, label')) return;
        event.preventDefault();
        toggleCardSelection(card.dataset.ticketId);
      });

      this.bindCardSwipeGesture(card);
    });

    root.querySelectorAll('[data-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        if (!tag) return;
        if (!this.app.state.ui.activeTags.includes(tag)) {
          this.app.state.ui.activeTags.push(tag);
        }
        this.render();
      });
    });

  }

  bindClearScopeButtons(root) {
    root.querySelectorAll('[data-clear-scope]').forEach((btn) => {
      btn.addEventListener('click', () => { this.clearFilterScope(); });
    });
  }

  async clearFilterScope() {
    this.app.state.ui.search = '';
    this.app.state.ui.activeTags = [];
    if (this.app.state.ui.selectionMode) {
      const visibleIds = new Set(this.filterTickets().map((ticket) => ticket.id));
      const before = this.app.state.ui.selectedIds.size;
      this.app.state.ui.selectedIds = new Set([...this.app.state.ui.selectedIds].filter((id) => visibleIds.has(id)));
      const pruned = before - this.app.state.ui.selectedIds.size;
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      await this.render();
    } else {
      await this.renderSearchResults();
    }
    const input = this.app.getRoot().querySelector('#ticket-search');
    if (input) input.value = '';
  }

  getCardRenderOptions() {
    const viewConfig = this.app.state.settings.viewConfigs?.[this.view] || {};
    const gridColumns = [1, 2, 3].includes(Number(viewConfig.gridColumns)) ? Number(viewConfig.gridColumns) : 2;
    const showThumbnail = viewConfig.showThumbnail !== false;
    const cardOpacity = clamp(viewConfig.cardOpacity, 0, 1, GLASS_CARD_OPACITY);
    const cardHeight = clamp(viewConfig.cardHeight, 0, 360, 0);
    const cardBgColor = viewConfig.cardBgColor || '#ffffff';
    const cardBorderColor = viewConfig.cardBorderColor || '#d7e3f0';
    const ultraCompactCard = viewConfig.ultraCompactCard === true;
    const compactGrid = gridColumns > 1;
    const thumbnailScale = Number.isFinite(Number(viewConfig.thumbnailScale))
      ? clamp(viewConfig.thumbnailScale, 10, 100, 100)
      : Number.isFinite(Number(viewConfig.gridImageHeight))
        ? clamp(Math.round((Number(viewConfig.gridImageHeight) / 84) * 100), 10, 100, 100)
        : 100;
    let ticketGridClass = gridColumns === 3
      ? 'grid grid-cols-3 gap-1.5'
      : gridColumns === 2
        ? 'grid grid-cols-2 gap-2'
        : 'grid gap-3';
    if (ultraCompactCard) {
      ticketGridClass = gridColumns === 3
        ? 'grid grid-cols-3 gap-1.5'
        : gridColumns === 2
          ? 'grid grid-cols-2 gap-1.5'
          : 'grid gap-1.5';
    }
    return { gridColumns, showThumbnail, compactGrid, ultraCompactCard, cardOpacity, cardHeight, thumbnailScale, cardBgColor, cardBorderColor, ticketGridClass };
  }

  getSummaryContext(tickets) {
    const tasks = this.app.state.tasks;
    const activeTotalCount = tasks.filter((t) => !t.completed && !t.isDeleted).length;
    const completedTotalCount = tasks.filter((t) => t.completed && !t.isDeleted).length;
    const deletedTotalCount = tasks.filter((t) => t.isDeleted).length;
    const urgentActiveCount = tasks.filter((t) => {
      if (t.completed || t.isDeleted) return false;
      const st = getExpiryState(t.expiry, this.app.state.settings.notifyDays);
      return st === 'expired' || st === 'today' || st === 'soon';
    }).length;
    const pinnedVisibleCount = tickets.filter((t) => t.pinned && !t.completed && !t.isDeleted).length;
    const currentViewTotal = this.view === 'active' ? activeTotalCount : this.view === 'completed' ? completedTotalCount : deletedTotalCount;
    const viewStatusCaption = this.view === 'active'
      ? `快到期 ${urgentActiveCount} 張${pinnedVisibleCount ? ` · 優先 ${pinnedVisibleCount} 張` : ''}`
      : this.view === 'completed'
        ? `已核銷 ${completedTotalCount} 張`
        : `待整理 ${deletedTotalCount} 張`;
    const searchKeyword = this.app.state.ui.search.trim();
    const activeTagLabels = this.app.state.ui.activeTags.map((tag) => (
      tag === ORIGINAL_IMAGE_FILTER_TAG ? '原圖'
        : tag === EXPIRY_URGENT_FILTER_TAG ? '到期警示'
        : tag === DUPLICATE_FILTER_TAG ? '重複票券'
        : `#${escapeHtml(tag)}`
    ));
    const scopeParts = [];
    if (searchKeyword) scopeParts.push(`關鍵字「${escapeHtml(searchKeyword)}」`);
    if (activeTagLabels.length) scopeParts.push(`標籤 ${activeTagLabels.join('、')}`);
    const compactScopeText = scopeParts.length ? `目前範圍：${scopeParts.join('、')}` : '目前範圍：全部票券';
    return { ticketsCount: tickets.length, currentViewTotal, viewStatusCaption, compactScopeText, hasScope: !!searchKeyword || this.app.state.ui.activeTags.length > 0 };
  }

  buildSummaryLineHtml(ctx) {
    return `<span>${ctx.ticketsCount} / ${ctx.currentViewTotal} 張 · ${ctx.viewStatusCaption}</span>${ctx.hasScope ? `<span class="app-summary-line-scope">· ${ctx.compactScopeText}</span><button type="button" data-clear-scope="1" class="app-summary-line-clear">清除篩選</button>` : ''}`;
  }

  // Typing in the search box must NOT rebuild the whole page: recreating
  // the input and re-focusing it makes iOS reset the keyboard layout
  // after every keystroke (digits fall back to the English keyboard).
  // Update only the summary line and the card grid; the input element
  // itself is never touched, so the keyboard session survives.
  async renderSearchResults(focusRestore = null) {
    if (this.app.state.ui.selectionMode) {
      await this.render();
      if (focusRestore) {
        const input = this.app.getRoot().querySelector('#ticket-search');
        if (input) {
          input.focus({ preventScroll: true });
          const len = input.value.length;
          const start = Number.isFinite(focusRestore.selectionStart) ? Math.max(0, Math.min(len, focusRestore.selectionStart)) : len;
          const end = Number.isFinite(focusRestore.selectionEnd) ? Math.max(0, Math.min(len, focusRestore.selectionEnd)) : start;
          input.setSelectionRange(start, end);
        }
      }
      return;
    }
    const root = this.app.getRoot();
    const grid = root.querySelector('#tickets-grid');
    if (!grid) { await this.render(); return; }
    const tickets = this.filterTickets();
    const opts = this.getCardRenderOptions();
    grid.className = `${opts.ticketGridClass} ${opts.ultraCompactCard ? 'ticket-grid--ultra' : ''}`;
    grid.innerHTML = this.buildCards(tickets, opts);
    const summary = root.querySelector('#tickets-summary-line');
    if (summary) summary.innerHTML = this.buildSummaryLineHtml(this.getSummaryContext(tickets));
    const hasKeyword = !!this.app.state.ui.search.trim();
    const clearBtn = root.querySelector('[data-clear-search]');
    clearBtn?.classList.toggle('hidden', !hasKeyword);
    const input = root.querySelector('#ticket-search');
    input?.classList.toggle('pr-9', hasKeyword);
    input?.classList.toggle('pr-3', !hasKeyword);
    this.bindCardEvents(root);
    this.bindClearScopeButtons(root);
  }

  bindEvents() {
    const root = this.app.getRoot();
    if (this.toolbarScrollHandler) {
      window.removeEventListener('scroll', this.toolbarScrollHandler);
      this.toolbarScrollHandler = null;
    }

    const batchToolbar = root.querySelector('.batch-toolbar');
    if (batchToolbar) {
      this.toolbarScrollHandler = () => {
        const stuck = batchToolbar.getBoundingClientRect().top <= 12.5;
        batchToolbar.classList.toggle('batch-toolbar--elevated', stuck && window.scrollY > 0);
      };
      window.addEventListener('scroll', this.toolbarScrollHandler, { passive: true });
      this.toolbarScrollHandler();
    }

    const pruneSelectionToVisible = () => {
      if (!this.app.state.ui.selectionMode) return 0;
      const visibleIds = new Set(this.filterTickets().map((ticket) => ticket.id));
      const before = this.app.state.ui.selectedIds.size;
      this.app.state.ui.selectedIds = new Set(
        [...this.app.state.ui.selectedIds].filter((id) => visibleIds.has(id))
      );
      return before - this.app.state.ui.selectedIds.size;
    };

    const handleSearchValueChange = async (event) => {
      this.app.state.ui.search = event.target.value;
      const pruned = pruneSelectionToVisible();
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      await this.renderSearchResults({ selectionStart: event.target.selectionStart, selectionEnd: event.target.selectionEnd });
    };

    const searchInput = root.querySelector('#ticket-search');
    searchInput?.addEventListener('compositionstart', () => {
      this.searchIsComposing = true;
    });
    searchInput?.addEventListener('compositionend', async (event) => {
      this.searchIsComposing = false;
      await handleSearchValueChange(event);
    });
    searchInput?.addEventListener('input', async (event) => {
      if (this.searchIsComposing || event.isComposing) return;
      await handleSearchValueChange(event);
    });

    root.querySelector('[data-clear-search]')?.addEventListener('click', async () => {
      this.app.state.ui.search = '';
      const pruned = pruneSelectionToVisible();
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      if (this.app.state.ui.selectionMode) {
        await this.render();
      } else {
        await this.renderSearchResults();
      }
      const nextSearchInput = this.app.getRoot().querySelector('#ticket-search');
      if (nextSearchInput) {
        nextSearchInput.value = '';
        nextSearchInput.focus({ preventScroll: true });
      }
    });

    this.bindClearScopeButtons(root);

    root.querySelector('#ticket-sort')?.addEventListener('change', (event) => {
      this.app.state.ui.sort = event.target.value;
      const pruned = pruneSelectionToVisible();
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      this.render();
    });

    const toolbarMenuButton = root.querySelector('#toggle-toolbar-menu');
    const toolbarMoreMenu = root.querySelector('#toolbar-more-menu');
    let toolbarMenuOpen = false;

    const closeToolbarMenu = () => {
      if (!toolbarMoreMenu || !toolbarMenuButton) return;
      toolbarMenuOpen = false;
      toolbarMoreMenu.classList.add('hidden');
      toolbarMenuButton.setAttribute('aria-expanded', 'false');
    };

    toolbarMenuButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!toolbarMoreMenu) return;
      toolbarMenuOpen = !toolbarMenuOpen;
      toolbarMoreMenu.classList.toggle('hidden', !toolbarMenuOpen);
      toolbarMenuButton.setAttribute('aria-expanded', toolbarMenuOpen ? 'true' : 'false');
    });

    toolbarMoreMenu?.addEventListener('click', () => {
      closeToolbarMenu();
    });

    root.addEventListener('click', (event) => {
      if (!toolbarMenuOpen) return;
      if (event.target.closest('#toolbar-more-menu, #toggle-toolbar-menu')) return;
      closeToolbarMenu();
    });

    // Gear settings link: navigate explicitly as well as via the anchor's
    // default hash change, so the tap still works if anything swallows the
    // default anchor behaviour.
    root.querySelector('#open-settings-btn')?.addEventListener('click', (event) => {
      event.preventDefault();
      if (window.location.hash !== '#settings') {
        window.location.hash = 'settings';
      }
    });

    root.querySelector('#quick-grid-columns')?.addEventListener('click', async () => {
      const prevViewConfigs = this.app.state.settings.viewConfigs || {};
      const prevViewConfig = prevViewConfigs[this.view] || {};
      const current = [1, 2, 3].includes(Number(prevViewConfig.gridColumns)) ? Number(prevViewConfig.gridColumns) : 2;
      const next = current === 1 ? 2 : current === 2 ? 3 : 1;
      this.app.state.settings = {
        ...this.app.state.settings,
        viewConfigs: {
          ...prevViewConfigs,
          [this.view]: {
            ...prevViewConfig,
            gridColumns: next,
          },
        },
      };
      await this.app.persistSettings();
      showToast(`已切換為 ${next} 欄排列`, 'success', 700);
      this.render();
    });

    root.querySelector('#toggle-ultra-compact-btn')?.addEventListener('click', async () => {
      const prevViewConfigs = this.app.state.settings.viewConfigs || {};
      const prevViewConfig = prevViewConfigs[this.view] || {};
      const nextUltraCompact = prevViewConfig.ultraCompactCard !== true;
      this.app.state.settings = {
        ...this.app.state.settings,
        viewConfigs: {
          ...prevViewConfigs,
          [this.view]: {
            ...prevViewConfig,
            ultraCompactCard: nextUltraCompact,
          },
        },
      };
      await this.app.persistSettings();
      showToast(nextUltraCompact ? '已切換超精簡卡片模式' : '已切換標準卡片模式', 'success', 900);
      this.render();
    });

    root.querySelector('#quick-clear-completed-to-trash')?.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.view !== 'completed' && this.view !== 'deleted') return;
      const targets = this.app.state.tasks.filter((ticket) => ticket.completed && !ticket.isDeleted);
      if (!targets.length) {
        showToast('沒有可回收的已使用票券', 'error');
        return;
      }
      const ok = window.confirm(`確定將 ${targets.length} 張已使用票券全部移到回收桶？`);
      if (!ok) return;

      const deletedAt = Date.now();
      this.app.state.tasks = this.app.state.tasks.map((ticket) => {
        if (!ticket.completed || ticket.isDeleted) return ticket;
        return {
          ...ticket,
          isDeleted: true,
          deletedAt,
          pinned: false,
        };
      });
      this.app.state.ui.selectedIds.clear();
      await this.app.persistTasks();
      showToast(`已將 ${targets.length} 張票券移至回收桶`, 'success');
      this.render();
    });

    root.querySelector('#quick-purge-deleted')?.addEventListener('click', async () => {
      if (this.view !== 'deleted') return;
      const targets = this.app.state.tasks.filter((ticket) => ticket.isDeleted);
      if (!targets.length) {
        showToast('回收桶沒有可刪除票券', 'error');
        return;
      }
      const ok = window.confirm(`確定永久刪除回收桶內 ${targets.length} 張票券？`);
      if (!ok) return;

      this.app.state.tasks = this.app.state.tasks.filter((ticket) => !ticket.isDeleted);
      this.app.state.ui.selectedIds.clear();
      await this.app.persistTasks();
      showToast(`已永久刪除 ${targets.length} 張票券`, 'success');
      this.render();
    });

    root.querySelector('#toggle-view-background')?.addEventListener('click', async () => {
      const prevViewConfigs = this.app.state.settings.viewConfigs || {};
      const prevConfig = prevViewConfigs[this.view] || {};
      const nextShowBackground = prevConfig.showBackground === false;
      this.app.state.settings = {
        ...this.app.state.settings,
        viewConfigs: {
          ...prevViewConfigs,
          [this.view]: {
            ...prevConfig,
            showBackground: nextShowBackground,
          },
        },
      };
      await this.app.persistSettings();
      showToast(nextShowBackground ? '已顯示背景圖片' : '已隱藏背景圖片', 'success');
      this.render();
    });

    root.querySelector('#cycle-view-background')?.addEventListener('click', () => {
      if (this.cycleBackground(backgroundImages)) {
        this.clearBackgroundRotationTimer();
        this.startBackgroundRotation(backgroundImages, showBackground);
        showToast('已切換到下一張背景', 'success', 900);
      }
    });

    root.querySelector('#toggle-selection-btn')?.addEventListener('click', () => {
      const willEnable = !this.app.state.ui.selectionMode;
      this.app.state.ui.selectionMode = willEnable;
      if (!this.app.state.ui.keepSelectionMode) {
        this.app.state.ui.selectedIds.clear();
      } else if (willEnable && this.app.state.ui.selectedIds.size > 0) {
        showToast(`已恢復 ${this.app.state.ui.selectedIds.size} 張保留選取`, 'success');
      }
      if (!willEnable) this.hideContinueBatchHint();
      this.render();
    });

    root.querySelectorAll('[data-tag-filter]').forEach((chip) => chip.addEventListener('click', () => {
      const selectedValue = chip.dataset.tagFilter || '';
      this.app.state.ui.activeTags = selectedValue ? [selectedValue] : [];
      const pruned = pruneSelectionToVisible();
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      this.render();
    }));

    root.querySelector('[data-tag-clear]')?.addEventListener('click', () => {
      this.app.state.ui.activeTags = [];
      const pruned = pruneSelectionToVisible();
      if (pruned > 0) showToast(`已移除 ${pruned} 張不可見選取`, 'success');
      this.render();
    });

    root.querySelector('#keep-selection-mode')?.addEventListener('change', (event) => {
      const next = !!event.target.checked;
      this.app.state.ui.keepSelectionMode = next;
      if (!next && this.app.state.ui.selectedIds.size > 0) {
        const cleared = this.app.state.ui.selectedIds.size;
        this.app.state.ui.selectedIds.clear();
        this.hideContinueBatchHint();
        showToast(`已清空 ${cleared} 張保留選取`, 'success');
        this.render();
      }
    });

    root.querySelector('#continue-batch-hint-btn')?.addEventListener('click', () => {
      const firstEnabledBatchBtn = root.querySelector('.batch-actions [data-batch]:not([disabled])');
      if (!firstEnabledBatchBtn) return;
      firstEnabledBatchBtn.focus();
      showToast('已定位到批次操作', 'success');
      this.hideContinueBatchHint();
      const hintBtn = root.querySelector('#continue-batch-hint-btn');
      hintBtn?.classList.add('hidden');
      hintBtn?.setAttribute('aria-hidden', 'true');
    });

    root.querySelector('#continue-batch-hint-btn')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.currentTarget.click();
    });

    this.bindCardEvents(root);

    root.querySelectorAll('[data-batch]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.batch;
        const ids = [...this.app.state.ui.selectedIds];
        const finishBatch = () => {
          if (this.app.state.ui.keepSelectionMode) {
            const validIds = new Set(this.app.state.tasks.map((ticket) => ticket.id));
            this.app.state.ui.selectedIds = new Set(ids.filter((id) => validIds.has(id)));
            this.app.state.ui.selectionMode = true;
            if (this.app.state.ui.selectedIds.size > 0) {
              this.showContinueBatchHint();
            } else {
              this.hideContinueBatchHint();
            }
            return;
          }
          this.app.state.ui.selectedIds.clear();
          this.app.state.ui.selectionMode = false;
          this.hideContinueBatchHint();
        };
        if (!ids.length && action !== 'select-all' && action !== 'clear') {
          showToast('請先選擇票券', 'error');
          return;
        }

        if (action === 'select-all' || action === 'select-all-shortcut') {
          const visibleTickets = this.filterTickets();
          const allSelected = visibleTickets.length > 0 && visibleTickets.every((ticket) => this.app.state.ui.selectedIds.has(ticket.id));
          if (allSelected) {
            visibleTickets.forEach((ticket) => this.app.state.ui.selectedIds.delete(ticket.id));
            if (action === 'select-all-shortcut') {
              showToast('已取消全選', 'success');
            }
          } else {
            visibleTickets.forEach((ticket) => this.app.state.ui.selectedIds.add(ticket.id));
            if (action === 'select-all-shortcut') {
              showToast(`已選取 ${visibleTickets.length} 張，可直接執行批次操作`, 'success');
            }
          }
          this.hideContinueBatchHint();
          this.render();
          return;
        }

        if (action === 'clear') {
          this.app.state.ui.selectedIds.clear();
          this.hideContinueBatchHint();
          this.render();
          return;
        }

        if (action === 'purge') {
          const ok = window.confirm(`確定永久刪除選取的 ${ids.length} 張票券？此操作無法復原。`);
          if (!ok) return;
        }

        if (action === 'delete') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券移至回收桶？`);
          if (!ok) return;
        }

        if (action === 'complete') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券標記為已使用？`);
          if (!ok) return;
        }

        if (action === 'uncomplete') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券改回未使用？`);
          if (!ok) return;
        }

        if (action === 'restore') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券從回收桶還原？`);
          if (!ok) return;
        }

        if (action === 'pin') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券設為置頂？`);
          if (!ok) return;
        }

        if (action === 'unpin') {
          const ok = window.confirm(`確定將選取的 ${ids.length} 張票券取消置頂？`);
          if (!ok) return;
        }

        if (action === 'add-tag') {
          const picked = await this.pickTagsForBatch('add');
          if (picked.cancelled) return;
          const tags = picked.tags;
          if (!tags.length) return;

          this.app.state.tasks = this.app.state.tasks.map((ticket) => {
            if (!ids.includes(ticket.id)) return ticket;
            const merged = [...new Set([...(ticket.tags || []), ...tags])];
            return { ...ticket, tags: merged };
          });
          await this.app.persistTasks();
          finishBatch();
          showToast('已完成批次加標籤', 'success');
          this.render();
          return;
        }

        if (action === 'remove-tag') {
          const picked = await this.pickTagsForBatch('remove');
          if (picked.cancelled) return;
          const tags = picked.tags;
          if (!tags.length) return;

          this.app.state.tasks = this.app.state.tasks.map((ticket) => {
            if (!ids.includes(ticket.id)) return ticket;
            return { ...ticket, tags: (ticket.tags || []).filter((tag) => !tags.includes(tag)) };
          });
          await this.app.persistTasks();
          finishBatch();
          showToast('已完成批次移除標籤', 'success');
          this.render();
          return;
        }

        if (action === 'set-redeem-url') {
          const picked = await this.pickRedeemUrlForBatch();
          if (picked.cancelled) return;
          const url = picked.value || '';
          this.app.state.tasks = this.app.state.tasks.map((ticket) => {
            if (!ids.includes(ticket.id)) return ticket;
            return { ...ticket, redeemUrl: url };
          });
          await this.app.persistTasks();
          finishBatch();
          showToast('已更新批次兌換網址', 'success');
          this.render();
          return;
        }

        if (action === 'apply-template') {
          if (!this.app.state.templates.length) {
            showToast('尚無可用範本', 'error');
            return;
          }
          const template = await this.pickTemplateForBatch();
          if (!template) return;
          const impactedFields = ['票券名稱'];
          if (template.serial) impactedFields.push('序號');
          if (template.expiry) impactedFields.push('到期日');
          if (template.image) impactedFields.push('圖片');
          if (Array.isArray(template.tags) && template.tags.length > 0) impactedFields.push('標籤');
          if (template.redeemUrlPresetId || template.redeemUrl) impactedFields.push('兌換網址');
          if (template.barcodeFormat) impactedFields.push('條碼格式');
          const ok = window.confirm(
            `將對 ${ids.length} 張票券套用範本「${template.label || template.productName || '未命名範本'}」。\n` +
            `預計覆蓋欄位：${impactedFields.join('、')}\n是否繼續？`
          );
          if (!ok) return;

          const preset = template.redeemUrlPresetId
            ? (this.app.state.settings.redeemUrlPresets || []).find((item) => item.id === template.redeemUrlPresetId)
            : null;
          const resolvedRedeemUrl = preset?.url || template.redeemUrl || '';

          this.app.state.tasks = this.app.state.tasks.map((ticket) => {
            if (!ids.includes(ticket.id)) return ticket;
            return {
              ...ticket,
              productName: template.productName || ticket.productName,
              serial: template.serial || ticket.serial,
              expiry: template.expiry || ticket.expiry,
              image: template.image || ticket.image,
              tags: Array.isArray(template.tags) && template.tags.length > 0 ? [...template.tags] : ticket.tags,
              redeemUrl: resolvedRedeemUrl || ticket.redeemUrl,
              barcodeFormat: template.barcodeFormat || ticket.barcodeFormat,
            };
          });
          await this.app.persistTasks();
          finishBatch();
          showToast('已完成批次套用範本', 'success');
          this.render();
          return;
        }

        const ticketsCompletedNow = [];
        const next = this.app.state.tasks.map((ticket) => {
          if (!ids.includes(ticket.id)) return ticket;
          if (action === 'delete') return { ...ticket, isDeleted: true, deletedAt: Date.now(), pinned: false };
          if (action === 'restore') return { ...ticket, isDeleted: false, deletedAt: undefined, pinned: false };
          if (action === 'complete') {
            const completedAt = Date.now();
            ticketsCompletedNow.push({ ...ticket, completedAt });
            return { ...ticket, completed: true, completedAt, pinned: false };
          }
          if (action === 'uncomplete') return { ...ticket, completed: false, completedAt: undefined, pinned: false };
          // 置頂只適用於未使用票券，已使用／回收桶中的票券不套用。
          if (action === 'pin') return ticket.completed || ticket.isDeleted ? ticket : { ...ticket, pinned: true };
          if (action === 'unpin') return { ...ticket, pinned: false };
          return ticket;
        }).filter((ticket) => !(action === 'purge' && ids.includes(ticket.id)));

        this.app.state.tasks = next;
        await this.app.persistTasks();
        if (action === 'complete' && ticketsCompletedNow.length > 0) {
          await this.app.sendBatchRedeemNotification(ticketsCompletedNow);
        }
        finishBatch();
        const actionMessages = {
          delete: '已移至回收桶',
          restore: '已批次還原',
          purge: '已永久刪除選取票券',
          complete: '已標記為已使用',
          uncomplete: '已改回未使用',
          pin: '已批次置頂',
          unpin: '已取消批次置頂',
        };
        showToast(actionMessages[action] || '批次操作完成', 'success');
        this.render();
      });
    });

    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const article = btn.closest('[data-ticket-id]');
        const ticketId = article?.dataset.ticketId;
        if (!ticketId) return;

        const ticket = this.app.state.tasks.find((t) => t.id === ticketId);
        if (!ticket) return;

        const action = btn.dataset.action;
        if (action === 'edit') {
          this.app.state.ui.selectionMode = false;
          this.app.state.ui.selectedIds.clear();
          this.app.state.ui.editingTicketId = ticketId;
          this.app.state.ui.editingFromRoute = this.view;
          window.location.hash = 'add';
          return;
        }

        if (action === 'toggle-pin') {
          // 置頂只適用於未使用票券：已使用／回收桶中的票券不可置頂，並順手清除殘留標記。
          if (ticket.completed || ticket.isDeleted) {
            if (ticket.pinned) {
              ticket.pinned = false;
              await this.app.persistTasks();
              this.render();
            }
            return;
          }
          ticket.pinned = !ticket.pinned;
          await this.app.persistTasks();
          this.render();
          return;
        }

        if (action === 'redeem-mode') {
          if (ticket.completed) {
            showToast('此票券已核銷，無法再次核銷', 'error');
            return;
          }
          this.openRedeemModeModal(ticket);
          return;
        }

        if (action === 'redeem') {
          if (!ticket.redeemUrl) return;
          window.open(ticket.redeemUrl, '_blank', 'noopener');
          return;
        }

        if (action === 'toggle-complete') {
          ticket.completed = !ticket.completed;
          ticket.completedAt = ticket.completed ? Date.now() : undefined;
          ticket.pinned = false;
          await this.app.persistTasks();
          if (ticket.completed) {
            await this.app.sendRedeemNotification(ticket);
          }
          this.render();
          return;
        }

        if (action === 'delete') {
          ticket.isDeleted = true;
          ticket.deletedAt = Date.now();
          ticket.pinned = false;
          await this.app.persistTasks();
          this.render();
          return;
        }

        if (action === 'restore') {
          ticket.isDeleted = false;
          ticket.deletedAt = undefined;
          ticket.pinned = false;
          await this.app.persistTasks();
          this.render();
          return;
        }

        if (action === 'purge') {
          if (!window.confirm('確定永久刪除？')) return;
          this.app.state.tasks = this.app.state.tasks.filter((t) => t.id !== ticketId);
          await this.app.persistTasks();
          this.render();
        }
      });
    });
  }
}
