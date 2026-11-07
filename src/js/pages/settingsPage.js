import {
  compressImage,
  DB_KEYS,
  downloadJson,
  escapeHtml,
  forceRefreshToLatest,
  formatDateTime,
  parseTags,
  sendTelegramMessage,
  showToast,
  validateImportData,
  GLASS_CARD_OPACITY,
} from '../utils.js';
import { buildBatchTickets, validateBatchRows } from '../services/batchImportService.js';
import { SCAN_SUCCESS_SOUNDS, playScanSuccessSound } from '../services/omniCoreService.js';

const SWIPE_HINT_STORAGE_KEY = 'wallet_swipe_hint_seen_v1';
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0-omnitrunk';
let barcodeServicePromise = null;

async function getBarcodeScanner() {
  barcodeServicePromise ||= import('../services/barcodeService.js');
  return barcodeServicePromise;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(1)} ${units[index]}`;
}

function formatSince(timestamp) {
  if (!timestamp) return '從未備份';
  const diff = Date.now() - Number(timestamp);
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days > 0) return `${days} 天前`;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  if (hours > 0) return `${hours} 小時前`;
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes > 0) return `${minutes} 分鐘前`;
  return '剛剛';
}

export class SettingsPage {
  constructor(app) {
    this.app = app;
    this.health = null;
    this.barcodeAudit = null;
    this.pendingImport = null;
    this.importKeydownHandler = null;
    this.importOptions = {
      mode: 'append',
      restoreSettings: true,
    };
    this.batchImportStatus = '';
    this.batchImportPreview = '';
    this.batchImportRedeemPresetId = '';
    this.currentTab = 'general';
  }

  templateListHtml() {
    if (!this.app.state.templates.length) {
      return '<p class="text-sm text-wabi-text-secondary">尚未建立範本</p>';
    }
    const defaultTemplateId = this.app.state.settings.defaultTemplateId || '';
    return this.app.state.templates.map((tpl) => `
      <div class="flex items-center justify-between gap-2 py-2 border-b border-wabi-border/60" data-template-id="${tpl.id}">
        <div class="min-w-0 flex items-start gap-2">
          ${tpl.image
            ? `<img src="${escapeHtml(tpl.image)}" class="w-12 h-12 rounded-lg border border-wabi-border object-cover bg-slate-50 shrink-0" alt="範本縮圖" />`
            : '<div class="w-12 h-12 rounded-lg border border-dashed border-wabi-border text-[10px] text-wabi-text-secondary flex items-center justify-center shrink-0">無縮圖</div>'
          }
          <div class="min-w-0">
            <div class="flex items-center gap-1.5 min-w-0">
              <p class="font-medium text-sm truncate">${escapeHtml(tpl.label || tpl.productName || '未命名範本')}</p>
              ${tpl.id === defaultTemplateId ? '<span class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-100">預設</span>' : ''}
            </div>
            <p class="text-xs text-wabi-text-secondary truncate">${escapeHtml(tpl.productName || '')}</p>
            <p class="text-[11px] text-wabi-text-secondary mt-0.5">${tpl.image ? '已設定縮圖範本' : '未設定縮圖範本'}</p>
          </div>
        </div>
        <div class="flex gap-1 flex-wrap justify-end">
          ${tpl.id === defaultTemplateId
            ? `<button data-clear-default-template="${tpl.id}" class="px-2 py-1 rounded bg-emerald-50 text-emerald-700 text-xs border border-emerald-100">取消預設</button>`
            : `<button data-set-default-template="${tpl.id}" class="px-2 py-1 rounded bg-wabi-accent/40 text-wabi-primary text-xs">設預設</button>`
          }
          <button data-edit-template-thumb="${tpl.id}" class="px-2 py-1 rounded bg-wabi-primary/10 text-wabi-primary text-xs">${tpl.image ? '換縮圖' : '設縮圖'}</button>
          ${tpl.image ? `<button data-clear-template-thumb="${tpl.id}" class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs">清縮圖</button>` : ''}
          <button data-move-template-up="${tpl.id}" class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs">↑</button>
          <button data-move-template-down="${tpl.id}" class="px-2 py-1 rounded bg-slate-100 text-slate-700 text-xs">↓</button>
          <button data-rename-template="${tpl.id}" class="px-2 py-1 rounded bg-wabi-primary/10 text-wabi-primary text-xs">改名</button>
          <button data-delete-template="${tpl.id}" class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs">刪除</button>
        </div>
      </div>
    `).join('');
  }

  redeemPresetHtml() {
    const presets = this.app.state.settings.redeemUrlPresets || [];
    if (!presets.length) return '<p class="text-sm text-wabi-text-secondary">尚未建立兌換網址預設</p>';
    return presets.map((preset) => `
      <div class="flex items-center justify-between gap-2 py-2 border-b border-wabi-border/60">
        <div class="min-w-0">
          <p class="font-medium text-sm truncate">${escapeHtml(preset.label)}</p>
          <p class="text-xs text-wabi-text-secondary truncate">${escapeHtml(preset.url)}</p>
        </div>
        <button data-delete-preset="${preset.id}" class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs">刪除</button>
      </div>
    `).join('');
  }

  tagsHtml() {
    const tags = [...new Set(this.app.state.tasks.flatMap((t) => t.tags || []))].sort();
    if (!tags.length) return '<p class="text-sm text-wabi-text-secondary">尚無標籤</p>';

    return tags.map((tag) => `
      <div class="flex items-center justify-between gap-2 py-1">
        <span class="text-sm">#${escapeHtml(tag)}</span>
        <button data-delete-tag="${escapeHtml(tag)}" class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs">移除所有票券上的此標籤</button>
      </div>
    `).join('');
  }

  healthHtml() {
    if (!this.health) {
      return '<p class="text-sm text-wabi-text-secondary">尚未執行檢查</p>';
    }
    const usagePercent = this.health.storageQuota > 0
      ? `${((this.health.totalSize / this.health.storageQuota) * 100).toFixed(1)}%`
      : '未知';
    return `
      <div class="text-sm space-y-1">
        <p>狀態：<span class="font-semibold ${this.health.isHealthy ? 'text-emerald-700' : 'text-red-700'}">${this.health.isHealthy ? '正常' : '需修正'}</span></p>
        <p>資料鍵數：${this.health.totalKeys}</p>
        <p>估計大小：${formatBytes(this.health.totalSize)}</p>
        <p>容量占比：${usagePercent}</p>
        <p>上次備份：${formatSince(this.health.lastBackup)}</p>
        <p>持久化儲存：${this.health.isPersisted === undefined ? '不支援' : this.health.isPersisted ? '已啟用' : '未啟用'}</p>
        <p>問題：${this.health.issues.length ? this.health.issues.join('；') : '無'}</p>
        <p>建議：${this.health.recommendations.length ? this.health.recommendations.join('；') : '無'}</p>
      </div>
    `;
  }

  barcodeAuditHtml() {
    if (!this.barcodeAudit) {
      return '<p class="text-sm text-wabi-text-secondary">尚未執行條碼一致性檢查</p>';
    }

    const { total, matched, mismatched, noBarcode } = this.barcodeAudit;
    return `
      <div class="text-sm space-y-1">
        <p>檢查筆數：${total}</p>
        <p>一致：<span class="text-emerald-700 font-semibold">${matched}</span></p>
        <p>不一致：<span class="text-red-700 font-semibold">${mismatched.length}</span></p>
        <p>無法辨識：<span class="text-amber-700 font-semibold">${noBarcode.length}</span></p>
        ${mismatched.length ? `<p class="text-xs text-red-700">不一致清單：${mismatched.map((item) => `${escapeHtml(item.name)}(${escapeHtml(item.serial)}→${escapeHtml(item.scannedSerial)})`).join('、')}</p>` : ''}
        ${noBarcode.length ? `<p class="text-xs text-amber-700">未讀到條碼：${noBarcode.map((name) => escapeHtml(name)).join('、')}</p>` : ''}
      </div>
    `;
  }

  importConfirmHtml() {
    if (!this.pendingImport) return '';
    const mode = this.pendingImport.mode || 'append';
    return `
      <div class="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="w-full max-w-md rounded-2xl border border-wabi-border bg-white shadow-2xl p-4">
          <h3 class="text-lg font-semibold text-wabi-primary mb-1">準備匯入資料</h3>
          <p class="text-sm text-wabi-text-secondary">檔案：${escapeHtml(this.pendingImport.fileName || '匯入檔')}</p>
          <p class="text-sm text-wabi-text-secondary mb-3">偵測到 ${this.pendingImport.count} 筆票券</p>
          <div class="flex bg-slate-100 p-1 rounded-xl mb-3">
            <button data-import-mode="append" class="flex-1 py-2 rounded-lg text-sm ${mode === 'append' ? 'bg-white text-wabi-primary shadow' : 'text-slate-600'}">追加</button>
            <button data-import-mode="overwrite" class="flex-1 py-2 rounded-lg text-sm ${mode === 'overwrite' ? 'bg-white text-red-700 shadow' : 'text-slate-600'}">覆蓋</button>
          </div>
          ${this.pendingImport.hasSettings ? `
            <label class="inline-flex items-center gap-2 text-sm mb-4">
              <input id="import-confirm-restore-settings" type="checkbox" ${this.pendingImport.restoreSettings ? 'checked' : ''} />
              套用匯入設定（標題、提醒、預設網址）
            </label>
          ` : ''}
          <div class="flex gap-2">
            <button id="cancel-import-confirm" class="flex-1 px-3 py-2 rounded-lg border border-wabi-border text-sm">取消</button>
            <button id="confirm-import-confirm" class="flex-1 px-3 py-2 rounded-lg bg-wabi-primary text-white text-sm">確認匯入</button>
          </div>
        </div>
      </div>
    `;
  }

  async render() {
    const settings = this.app.state.settings;
    const activeViewConfig = settings.viewConfigs?.active || {};
    const completedViewConfig = settings.viewConfigs?.completed || {};
    const deletedViewConfig = settings.viewConfigs?.deleted || {};
    const activeGridColumns = [1, 2, 3].includes(Number(activeViewConfig.gridColumns))
      ? Number(activeViewConfig.gridColumns)
      : 2;
    const completedGridColumns = [1, 2, 3].includes(Number(completedViewConfig.gridColumns))
      ? Number(completedViewConfig.gridColumns)
      : 2;
    const deletedGridColumns = [1, 2, 3].includes(Number(deletedViewConfig.gridColumns))
      ? Number(deletedViewConfig.gridColumns)
      : 2;
    const activeHideThumbnail = activeViewConfig.showThumbnail === false;
    const completedHideThumbnail = completedViewConfig.showThumbnail === false;
    const deletedHideThumbnail = deletedViewConfig.showThumbnail === false;
    const activeUltraCompactCard = activeViewConfig.ultraCompactCard === true;
    const completedUltraCompactCard = completedViewConfig.ultraCompactCard === true;
    const deletedUltraCompactCard = deletedViewConfig.ultraCompactCard === true;
    const activeBackgroundImages = Array.isArray(activeViewConfig.backgroundImages)
      ? activeViewConfig.backgroundImages.filter(Boolean)
      : [];
    if (!activeBackgroundImages.length && activeViewConfig.backgroundImage) {
      activeBackgroundImages.push(activeViewConfig.backgroundImage);
    }
    const activeBackgroundPreviewHtml = activeBackgroundImages.map((img, index) => `
      <div class="relative rounded-xl overflow-hidden border border-wabi-border">
        <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
        <button type="button" data-active-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
      </div>
    `).join('');
    const completedBackgroundImages = Array.isArray(completedViewConfig.backgroundImages)
      ? completedViewConfig.backgroundImages.filter(Boolean)
      : [];
    if (!completedBackgroundImages.length && completedViewConfig.backgroundImage) {
      completedBackgroundImages.push(completedViewConfig.backgroundImage);
    }
    const completedBackgroundPreviewHtml = completedBackgroundImages.map((img, index) => `
      <div class="relative rounded-xl overflow-hidden border border-wabi-border">
        <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
        <button type="button" data-completed-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
      </div>
    `).join('');
    const completedShowBackground = completedViewConfig.showBackground !== false;
    const deletedBackgroundImages = Array.isArray(deletedViewConfig.backgroundImages)
      ? deletedViewConfig.backgroundImages.filter(Boolean)
      : [];
    if (!deletedBackgroundImages.length && deletedViewConfig.backgroundImage) {
      deletedBackgroundImages.push(deletedViewConfig.backgroundImage);
    }
    const deletedBackgroundPreviewHtml = deletedBackgroundImages.map((img, index) => `
      <div class="relative rounded-xl overflow-hidden border border-wabi-border">
        <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
        <button type="button" data-deleted-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
      </div>
    `).join('');
    const deletedShowBackground = deletedViewConfig.showBackground !== false;
    const activeShowBackground = activeViewConfig.showBackground !== false;
    const activeBgOpacity = Number.isFinite(Number(activeViewConfig.bgOpacity))
      ? Math.max(0, Math.min(1, Number(activeViewConfig.bgOpacity)))
      : 1;
    const completedBgOpacity = Number.isFinite(Number(completedViewConfig.bgOpacity))
      ? Math.max(0, Math.min(1, Number(completedViewConfig.bgOpacity)))
      : 1;
    const deletedBgOpacity = Number.isFinite(Number(deletedViewConfig.bgOpacity))
      ? Math.max(0, Math.min(1, Number(deletedViewConfig.bgOpacity)))
      : 1;
    const activeCardOpacity = Number.isFinite(Number(activeViewConfig.cardOpacity))
      ? Math.max(0, Math.min(1, Number(activeViewConfig.cardOpacity)))
      : GLASS_CARD_OPACITY;
    const completedCardOpacity = Number.isFinite(Number(completedViewConfig.cardOpacity))
      ? Math.max(0, Math.min(1, Number(completedViewConfig.cardOpacity)))
      : GLASS_CARD_OPACITY;
    const deletedCardOpacity = Number.isFinite(Number(deletedViewConfig.cardOpacity))
      ? Math.max(0, Math.min(1, Number(deletedViewConfig.cardOpacity)))
      : GLASS_CARD_OPACITY;
    const activeCardTransparencyPercent = Math.round((1 - activeCardOpacity) * 100);
    const completedCardTransparencyPercent = Math.round((1 - completedCardOpacity) * 100);
    const deletedCardTransparencyPercent = Math.round((1 - deletedCardOpacity) * 100);
    const activeCardHeight = Number.isFinite(Number(activeViewConfig.cardHeight))
      ? Math.max(0, Math.min(360, Number(activeViewConfig.cardHeight)))
      : 0;
    const completedCardHeight = Number.isFinite(Number(completedViewConfig.cardHeight))
      ? Math.max(0, Math.min(360, Number(completedViewConfig.cardHeight)))
      : 0;
    const deletedCardHeight = Number.isFinite(Number(deletedViewConfig.cardHeight))
      ? Math.max(0, Math.min(360, Number(deletedViewConfig.cardHeight)))
      : 0;
    const activeThumbnailScale = Number.isFinite(Number(activeViewConfig.thumbnailScale))
      ? Math.max(10, Math.min(100, Number(activeViewConfig.thumbnailScale)))
      : Number.isFinite(Number(activeViewConfig.gridImageHeight))
        ? Math.max(10, Math.min(100, Math.round((Number(activeViewConfig.gridImageHeight) / 84) * 100)))
        : 100;
    const quickTagsText = (settings.quickTags || []).join(', ');
    const swipeTriggerDistancePx = Number.isFinite(Number(settings.swipeTriggerDistance))
      ? Math.max(40, Math.min(120, Number(settings.swipeTriggerDistance)))
      : 72;
    this.app.mount(`
      <section class="page active px-4 pt-0 pb-24 md:pb-8 max-w-4xl mx-auto space-y-4">
        <div class="app-top-bar sticky z-30 -mx-4 px-4 pb-3 mb-3" style="top: 0; padding-top: calc(var(--safe-top) + 0.5rem);">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h1 class="text-2xl font-bold text-wabi-primary">設定</h1>
              <p class="text-sm text-wabi-text-secondary">調整票券顯示、通知與資料管理</p>
            </div>
            <div class="flex items-center gap-2">
              <a href="#active" class="px-3 py-2 rounded-lg bg-white border border-wabi-border text-sm">返回</a>
              <button type="submit" form="settings-form" class="px-4 py-2 rounded-lg bg-wabi-primary text-white text-sm">儲存設定</button>
            </div>
          </div>
        </div>

        <form id="settings-form" class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">基本設定</h2>
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">App 名稱</label>
              <input id="app-title" value="${escapeHtml(settings.appTitle || '輕鬆票券')}" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">到期提醒天數</label>
              <input id="notify-days" type="number" min="1" max="60" value="${Number(settings.notifyDays || 7)}" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
            </div>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">Telegram Bot Token</label>
              <input id="tg-token" value="${escapeHtml(settings.tgToken || '')}" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">Telegram Chat ID</label>
              <input id="tg-chat-id" value="${escapeHtml(settings.tgChatId || '')}" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
            </div>
          </div>
          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">本機備份檔名</label>
            <input id="backup-file-name" value="${escapeHtml(settings.localBackupFileName || 'ticket_backup')}" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">新增票券快速標籤（逗號分隔）</label>
            <input id="quick-tags" value="${escapeHtml(quickTagsText)}" placeholder="例如：超商,咖啡,餐券" class="w-full rounded-lg border border-wabi-border px-3 py-2" />
          </div>
          <div class="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="text-sm font-bold text-wabi-primary">🔊 OmniPass 掃碼與核銷成功音效</h3>
                <p class="text-xs text-wabi-text-secondary">使用 Web Audio API 即時合成，無須載入外部音檔</p>
              </div>
              <button type="button" id="preview-scan-sound" class="px-3 py-1.5 rounded-lg bg-wabi-primary text-white text-xs font-bold shrink-0">試聽音效</button>
            </div>
            <select id="scan-success-sound" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
              ${Object.entries(SCAN_SUCCESS_SOUNDS).map(([key, item]) => `
                <option value="${key}" ${(settings.scanSuccessSound || 'market') === key ? 'selected' : ''}>${escapeHtml(item.label)} — ${escapeHtml(item.description)}</option>
              `).join('')}
            </select>
          </div>
          <div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
            <div>
              <h3 class="text-sm font-bold text-emerald-900">🪪 OmniPass 結帳前置條碼（載具 / 會員卡）</h3>
              <p class="text-xs text-emerald-800/80">啟用後會自動排在「結帳連刷模式」第一張，先刷載具/會員再滑動刷票券</p>
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <div class="rounded-lg bg-white p-2.5 border border-emerald-200 space-y-2">
                <label class="inline-flex items-center gap-2 text-xs font-bold text-slate-800">
                  <input id="qp-carrier-enabled" type="checkbox" ${(settings.quickPasses?.[0]?.enabled) ? 'checked' : ''} />
                  啟用手機條碼載具 (CODE_39)
                </label>
                <input id="qp-carrier-code" placeholder="例如：/ABC1234" value="${escapeHtml(settings.quickPasses?.[0]?.code || '')}" class="w-full rounded-lg border border-wabi-border px-3 py-1.5 text-sm font-mono" />
              </div>
              <div class="rounded-lg bg-white p-2.5 border border-emerald-200 space-y-2">
                <label class="inline-flex items-center gap-2 text-xs font-bold text-slate-800">
                  <input id="qp-member-enabled" type="checkbox" ${(settings.quickPasses?.[1]?.enabled) ? 'checked' : ''} />
                  啟用常用會員條碼 (CODE_128)
                </label>
                <input id="qp-member-code" placeholder="輸入會員卡號或條碼" value="${escapeHtml(settings.quickPasses?.[1]?.code || '')}" class="w-full rounded-lg border border-wabi-border px-3 py-1.5 text-sm font-mono" />
              </div>
            </div>
          </div>
          <div class="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h3 class="text-sm font-semibold text-amber-800">強制更新到最新版</h3>
                <p class="text-xs text-amber-700 mt-1">遇到 PWA 還停在舊版時，可清除快取並重新載入最新程式；不會刪除票券資料。</p>
              </div>
              <button type="button" id="force-refresh-settings" class="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm shrink-0">立即更新</button>
            </div>
          </div>
          <div class="rounded-lg border border-wabi-border/70 p-3">
            <label class="inline-flex items-center gap-2 text-sm">
              <input id="swipe-gestures-enabled" type="checkbox" ${settings.swipeGesturesEnabled !== false ? 'checked' : ''} />
              啟用票券手勢操作（左滑 / 右滑）
            </label>
            <div class="mt-3">
              <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                <label for="swipe-trigger-distance">手勢觸發距離</label>
                <span id="swipe-trigger-distance-value">${swipeTriggerDistancePx}px</span>
              </div>
              <input id="swipe-trigger-distance" type="range" min="40" max="120" step="4" value="${swipeTriggerDistancePx}" class="w-full accent-wabi-primary" ${settings.swipeGesturesEnabled !== false ? '' : 'disabled'} />
              <p class="text-xs text-wabi-text-secondary mt-1">數值越小越靈敏，越大越不容易誤觸。</p>
              <button type="button" id="reset-swipe-hint" class="mt-2 px-3 py-1.5 rounded-lg border border-wabi-border text-xs">
                重設手勢提示
              </button>
            </div>
          </div>
          <div class="rounded-xl border border-wabi-border/70 p-3 space-y-3">
            <h3 class="text-sm font-semibold text-wabi-primary">待使用視圖版面</h3>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm text-wabi-text-secondary mb-1">票券排列欄數</label>
                <select id="active-grid-columns" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
                  <option value="1" ${activeGridColumns === 1 ? 'selected' : ''}>1 欄</option>
                  <option value="2" ${activeGridColumns === 2 ? 'selected' : ''}>2 欄（2x2）</option>
                  <option value="3" ${activeGridColumns === 3 ? 'selected' : ''}>3 欄</option>
                </select>
              </div>
              <div class="space-y-2">
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="active-hide-thumbnail" type="checkbox" ${activeHideThumbnail ? 'checked' : ''} />
                  不顯示縮圖（主頁卡片）
                </label>
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="active-ultra-compact" type="checkbox" ${activeUltraCompactCard ? 'checked' : ''} />
                  超精簡卡片模式（手機）
                </label>
              </div>
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="active-bg-opacity">背景顯示強度</label>
                  <span id="active-bg-opacity-value">${Math.round(activeBgOpacity * 100)}%</span>
                </div>
                <input id="active-bg-opacity" type="range" min="0" max="100" step="5" value="${Math.round(activeBgOpacity * 100)}" class="w-full accent-wabi-primary" ${activeShowBackground ? '' : 'disabled'} />
              </div>
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="active-card-transparency">卡片透明度</label>
                  <span id="active-card-transparency-value">${activeCardTransparencyPercent}%</span>
                </div>
                <input id="active-card-transparency" type="range" min="0" max="100" step="5" value="${activeCardTransparencyPercent}" class="w-full accent-wabi-primary" />
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                <label for="active-card-height">待使用票券高度</label>
                <span id="active-card-height-value">${activeCardHeight > 0 ? `${activeCardHeight}px` : '自動'}</span>
              </div>
              <input id="active-card-height" type="range" min="0" max="360" step="10" value="${activeCardHeight}" class="w-full accent-wabi-primary" />
              <p class="text-xs text-wabi-text-secondary mt-1">調整待使用頁票券卡片高度；0 代表自動高度。</p>
            </div>
            <div>
              <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                <label for="active-thumbnail-scale">主頁縮圖比例</label>
                <span id="active-thumbnail-scale-value">${activeThumbnailScale}%</span>
              </div>
              <input id="active-thumbnail-scale" type="range" min="10" max="100" step="2" value="${activeThumbnailScale}" class="w-full accent-wabi-primary" />
              <p class="text-xs text-wabi-text-secondary mt-1">依原圖長寬比例縮小或放大，不再強制固定縮圖高度。</p>
            </div>
            <div class="flex items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 text-sm">
                <input id="active-show-background" type="checkbox" ${activeShowBackground ? 'checked' : ''} />
                顯示背景圖片
              </label>
              <button id="active-toggle-background" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">
                ${activeShowBackground ? '一鍵關閉背景' : '一鍵顯示背景'}
              </button>
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">待使用背景圖片（可多選）</label>
              <input id="active-bg-file" type="file" accept="image/*" multiple class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
              <p id="active-bg-count" class="text-xs text-wabi-text-secondary mt-1">${activeBackgroundImages.length ? `已加入 ${activeBackgroundImages.length} 張，待使用頁會輪流顯示` : '尚未加入背景圖片'}</p>
              <div id="active-bg-preview-wrap" class="mt-2 ${activeBackgroundImages.length ? '' : 'hidden'} space-y-2">
                <div id="active-bg-preview-list" class="grid grid-cols-2 md:grid-cols-3 gap-2">
                  ${activeBackgroundPreviewHtml}
                </div>
                <button id="active-bg-clear" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除全部背景</button>
              </div>
            </div>
          </div>
          <div class="rounded-xl border border-wabi-border/70 p-3 space-y-3">
            <h3 class="text-sm font-semibold text-wabi-primary">已使用視圖版面與背景</h3>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm text-wabi-text-secondary mb-1">票券排列欄數</label>
                <select id="completed-grid-columns" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
                  <option value="1" ${completedGridColumns === 1 ? 'selected' : ''}>1 欄</option>
                  <option value="2" ${completedGridColumns === 2 ? 'selected' : ''}>2 欄（2x2）</option>
                  <option value="3" ${completedGridColumns === 3 ? 'selected' : ''}>3 欄</option>
                </select>
              </div>
              <div class="space-y-2">
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="completed-hide-thumbnail" type="checkbox" ${completedHideThumbnail ? 'checked' : ''} />
                  不顯示縮圖
                </label>
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="completed-ultra-compact" type="checkbox" ${completedUltraCompactCard ? 'checked' : ''} />
                  超精簡卡片模式
                </label>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                <label for="completed-card-height">已使用票券高度</label>
                <span id="completed-card-height-value">${completedCardHeight > 0 ? `${completedCardHeight}px` : '自動'}</span>
              </div>
              <input id="completed-card-height" type="range" min="0" max="360" step="10" value="${completedCardHeight}" class="w-full accent-wabi-primary" />
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="completed-bg-opacity">背景顯示強度</label>
                  <span id="completed-bg-opacity-value">${Math.round(completedBgOpacity * 100)}%</span>
                </div>
                <input id="completed-bg-opacity" type="range" min="0" max="100" step="5" value="${Math.round(completedBgOpacity * 100)}" class="w-full accent-wabi-primary" ${completedShowBackground ? '' : 'disabled'} />
              </div>
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="completed-card-transparency">卡片透明度</label>
                  <span id="completed-card-transparency-value">${completedCardTransparencyPercent}%</span>
                </div>
                <input id="completed-card-transparency" type="range" min="0" max="100" step="5" value="${completedCardTransparencyPercent}" class="w-full accent-wabi-primary" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 text-sm">
                <input id="completed-show-background" type="checkbox" ${completedShowBackground ? 'checked' : ''} />
                顯示背景圖片
              </label>
              <button id="completed-toggle-background" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">
                ${completedShowBackground ? '一鍵關閉背景' : '一鍵顯示背景'}
              </button>
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">已使用背景圖片（可多選）</label>
              <input id="completed-bg-file" type="file" accept="image/*" multiple class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
              <p id="completed-bg-count" class="text-xs text-wabi-text-secondary mt-1">${completedBackgroundImages.length ? `已加入 ${completedBackgroundImages.length} 張，已使用頁會輪流顯示` : '尚未加入背景圖片'}</p>
              <div id="completed-bg-preview-wrap" class="mt-2 ${completedBackgroundImages.length ? '' : 'hidden'} space-y-2">
                <div id="completed-bg-preview-list" class="grid grid-cols-2 md:grid-cols-3 gap-2">
                  ${completedBackgroundPreviewHtml}
                </div>
                <button id="completed-bg-clear" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除全部背景</button>
              </div>
            </div>
          </div>
          <div class="rounded-xl border border-wabi-border/70 p-3 space-y-3">
            <h3 class="text-sm font-semibold text-wabi-primary">回收桶視圖版面與背景</h3>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm text-wabi-text-secondary mb-1">票券排列欄數</label>
                <select id="deleted-grid-columns" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
                  <option value="1" ${deletedGridColumns === 1 ? 'selected' : ''}>1 欄</option>
                  <option value="2" ${deletedGridColumns === 2 ? 'selected' : ''}>2 欄（2x2）</option>
                  <option value="3" ${deletedGridColumns === 3 ? 'selected' : ''}>3 欄</option>
                </select>
              </div>
              <div class="space-y-2">
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="deleted-hide-thumbnail" type="checkbox" ${deletedHideThumbnail ? 'checked' : ''} />
                  不顯示縮圖
                </label>
                <label class="inline-flex items-center gap-2 text-sm">
                  <input id="deleted-ultra-compact" type="checkbox" ${deletedUltraCompactCard ? 'checked' : ''} />
                  超精簡卡片模式
                </label>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                <label for="deleted-card-height">回收桶票券高度</label>
                <span id="deleted-card-height-value">${deletedCardHeight > 0 ? `${deletedCardHeight}px` : '自動'}</span>
              </div>
              <input id="deleted-card-height" type="range" min="0" max="360" step="10" value="${deletedCardHeight}" class="w-full accent-wabi-primary" />
            </div>
            <div class="grid md:grid-cols-2 gap-3">
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="deleted-bg-opacity">背景顯示強度</label>
                  <span id="deleted-bg-opacity-value">${Math.round(deletedBgOpacity * 100)}%</span>
                </div>
                <input id="deleted-bg-opacity" type="range" min="0" max="100" step="5" value="${Math.round(deletedBgOpacity * 100)}" class="w-full accent-wabi-primary" ${deletedShowBackground ? '' : 'disabled'} />
              </div>
              <div>
                <div class="flex items-center justify-between text-sm text-wabi-text-secondary mb-1">
                  <label for="deleted-card-transparency">卡片透明度</label>
                  <span id="deleted-card-transparency-value">${deletedCardTransparencyPercent}%</span>
                </div>
                <input id="deleted-card-transparency" type="range" min="0" max="100" step="5" value="${deletedCardTransparencyPercent}" class="w-full accent-wabi-primary" />
              </div>
            </div>
            <div class="flex items-center justify-between gap-2">
              <label class="inline-flex items-center gap-2 text-sm">
                <input id="deleted-show-background" type="checkbox" ${deletedShowBackground ? 'checked' : ''} />
                顯示背景圖片
              </label>
              <button id="deleted-toggle-background" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">
                ${deletedShowBackground ? '一鍵關閉背景' : '一鍵顯示背景'}
              </button>
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">回收桶背景圖片（可多選）</label>
              <input id="deleted-bg-file" type="file" accept="image/*" multiple class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
              <p id="deleted-bg-count" class="text-xs text-wabi-text-secondary mt-1">${deletedBackgroundImages.length ? `已加入 ${deletedBackgroundImages.length} 張，回收桶頁會輪流顯示` : '尚未加入背景圖片'}</p>
              <div id="deleted-bg-preview-wrap" class="mt-2 ${deletedBackgroundImages.length ? '' : 'hidden'} space-y-2">
                <div id="deleted-bg-preview-list" class="grid grid-cols-2 md:grid-cols-3 gap-2">
                  ${deletedBackgroundPreviewHtml}
                </div>
                <button id="deleted-bg-clear" type="button" class="px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除全部背景</button>
              </div>
            </div>
          </div>
          <div class="flex gap-2">
            <button type="button" id="send-test-telegram" class="px-4 py-2 rounded-lg bg-wabi-accent/40 text-wabi-primary">發送 Telegram 測試</button>
          </div>
        </form>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">範本管理</h2>
          <p class="text-xs text-wabi-text-secondary">可把常用範本設為新增票券的預設值；只記住設定，不會修改既有票券。</p>
          <form id="template-form" class="grid md:grid-cols-5 gap-2 items-end">
            <input id="tpl-label" placeholder="範本名稱" class="md:col-span-1 rounded-lg border border-wabi-border px-3 py-2" />
            <input id="tpl-product" placeholder="票券名稱" class="md:col-span-2 rounded-lg border border-wabi-border px-3 py-2" />
            <input id="tpl-tags" placeholder="標籤 (逗號)" class="md:col-span-1 rounded-lg border border-wabi-border px-3 py-2" />
            <button class="md:col-span-1 rounded-lg bg-wabi-primary text-white px-3 py-2">新增範本</button>
          </form>
          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">縮圖範本（選填）</label>
            <input id="tpl-thumb-file" type="file" accept="image/*" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
            <div id="tpl-thumb-preview-wrap" class="mt-2 hidden">
              <img id="tpl-thumb-preview" src="" class="w-full max-h-36 object-cover rounded-xl border border-wabi-border bg-slate-50" />
              <button id="tpl-thumb-clear" type="button" class="mt-2 px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除縮圖</button>
            </div>
          </div>
          <input id="template-thumb-edit-file" type="file" accept="image/*" class="hidden" />
          <div>${this.templateListHtml()}</div>
        </section>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">兌換網址預設</h2>
          <form id="preset-form" class="grid md:grid-cols-3 gap-2 items-end">
            <input id="preset-label" placeholder="預設名稱" class="rounded-lg border border-wabi-border px-3 py-2" />
            <input id="preset-url" placeholder="https://..." class="rounded-lg border border-wabi-border px-3 py-2 md:col-span-2" />
            <button class="rounded-lg bg-wabi-primary text-white px-3 py-2 md:col-span-3">新增預設</button>
          </form>
          <div>${this.redeemPresetHtml()}</div>
        </section>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h2 class="font-semibold text-wabi-primary">🔐 OmniPass 加密備份與還原 (.opbackup)</h2>
              <p class="text-xs text-wabi-text-secondary mt-0.5">採用 PBKDF2-SHA256 (600,000 次迭代) + AES-256-GCM 高強度加密，亦可直接匯入原版 OmniPass 備份檔</p>
            </div>
          </div>
          <div class="grid md:grid-cols-2 gap-2">
            <input id="opbackup-password" type="password" autocomplete="new-password" placeholder="輸入加密/解密密碼（至少 8 碼）" class="rounded-lg border border-wabi-border px-3 py-2 text-sm" />
            <input id="opbackup-password-confirm" type="password" autocomplete="new-password" placeholder="再次輸入密碼（匯出時驗證）" class="rounded-lg border border-wabi-border px-3 py-2 text-sm" />
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" id="export-opbackup" class="px-4 py-2 rounded-lg bg-wabi-primary text-white text-sm font-semibold">匯出 .opbackup 加密備份</button>
            <label class="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200 text-sm font-semibold cursor-pointer">
              還原 .opbackup 加密備份
              <input id="import-opbackup" type="file" accept=".opbackup,.json,application/json,application/octet-stream" class="hidden" />
            </label>
          </div>
        </section>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">資料匯入 / 匯出 (JSON)</h2>
          <div class="flex gap-2 flex-wrap">
            <button id="export-json" class="px-4 py-2 rounded-lg bg-wabi-primary/10 text-wabi-primary">匯出 JSON</button>
            <label class="px-4 py-2 rounded-lg bg-wabi-accent/40 text-wabi-primary cursor-pointer">
              匯入 JSON
              <input id="import-json" type="file" accept=".json,application/json" class="hidden" />
            </label>
            <select id="import-mode" class="rounded-lg border border-wabi-border px-3 py-2">
              <option value="append" ${this.importOptions.mode === 'append' ? 'selected' : ''}>追加</option>
              <option value="overwrite" ${this.importOptions.mode === 'overwrite' ? 'selected' : ''}>覆蓋</option>
            </select>
            <label class="inline-flex items-center gap-2 text-sm px-2">
              <input id="restore-settings" type="checkbox" ${this.importOptions.restoreSettings ? 'checked' : ''} />
              套用匯入設定
            </label>
          </div>
          <p class="text-xs text-wabi-text-secondary">檔案匯入僅支援 task-trunk v3 完整備份 JSON；批量資料請使用下方文字框。</p>
          <div class="pt-2 border-t border-wabi-border/70">
            <button id="full-reset" class="px-4 py-2 rounded-lg bg-red-100 text-red-700">清空全部資料</button>
            <p class="text-xs text-wabi-text-secondary mt-2">會清除票券、設定、範本與通知紀錄。請先匯出備份。</p>
          </div>
        </section>

        <section class="bg-white border border-purple-200 rounded-2xl p-4 space-y-3">
          <div>
            <h2 class="font-semibold text-purple-900">批量新增票券</h2>
            <p class="text-xs text-wabi-text-secondary mt-1">請直接貼上 ticketNumber、expiryDate、productName、buyer JSON。系統會使用內建票券版型自動產生名稱、期限、序號與 QR code 圖片。</p>
          </div>
          <textarea id="batch-json-input" class="ios-zoom-safe w-full min-h-40 rounded-xl border border-wabi-border bg-white p-3 font-mono" placeholder='[{"ticketNumber":"E123","expiryDate":"2027/02/12","productName":"票券名稱","buyer":"持有人"}]'></textarea>
          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">批量套用支付預設</label>
            <select id="batch-redeem-preset" class="ios-zoom-safe w-full rounded-xl border border-wabi-border bg-white px-3 py-2">
              <option value="">不套用支付預設</option>
              ${(this.app.state.settings.redeemUrlPresets || []).map((preset) => `<option value="${escapeHtml(preset.id)}" ${preset.id === this.batchImportRedeemPresetId ? 'selected' : ''}>${escapeHtml(preset.label)}</option>`).join('')}
            </select>
            <p class="mt-1 text-[11px] text-wabi-text-secondary">選擇後，批量新增的每張票券都會帶入該支付網址。</p>
          </div>
          <p class="text-xs text-purple-700 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2">目前使用內建版型：85 度 C 電子票券</p>
          <button id="batch-import-submit" type="button" class="px-4 py-2 rounded-lg bg-purple-700 text-white">解析並批量新增</button>
          <p id="batch-import-status" class="text-xs text-wabi-text-secondary">${escapeHtml(this.batchImportStatus || '尚未開始批量新增')}</p>
          ${this.batchImportPreview ? `<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-2"><p class="text-xs font-semibold text-emerald-800 mb-2">第一張產生圖片預覽</p><img src="${escapeHtml(this.batchImportPreview)}" class="w-full max-h-80 object-contain bg-white rounded-lg" alt="批量產生票券預覽" /></div>` : ''}
        </section>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">資料健康檢查</h2>
          <div id="health-report">${this.healthHtml()}</div>
          <div id="barcode-audit-report">${this.barcodeAuditHtml()}</div>
          <div class="flex gap-2 flex-wrap">
            <button id="run-health-check" class="px-4 py-2 rounded-lg bg-wabi-primary/10 text-wabi-primary">立即檢查</button>
            <button id="run-barcode-audit" class="px-4 py-2 rounded-lg bg-wabi-primary/10 text-wabi-primary">條碼一致性檢查</button>
            <button id="cleanup-residual-data" class="px-4 py-2 rounded-lg bg-amber-100 text-amber-800">清理殘留資料</button>
            <button id="request-persistence" class="px-4 py-2 rounded-lg bg-wabi-accent/40 text-wabi-primary">啟用持久化儲存</button>
          </div>
        </section>

        <section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3">
          <h2 class="font-semibold text-wabi-primary">標籤管理</h2>
          <div>${this.tagsHtml()}</div>
        </section>

        <section class="text-xs text-wabi-text-secondary text-center py-2">
          版本時間：${escapeHtml(formatDateTime(Date.now()))}
        </section>
      </section>
      ${this.importConfirmHtml()}
    `);

    this.bindEvents();
  }

  bindEvents() {
    const root = this.app.getRoot();
    const settingsPage = root.querySelector('.page.active');
    const settingsForm = root.querySelector('#settings-form');
    const settingsTabs = [
      { id: 'general', label: '一般', icon: 'fa-sliders' },
      { id: 'views', label: '版面', icon: 'fa-table-cells-large' },
      { id: 'templates', label: '範本', icon: 'fa-layer-group' },
      { id: 'data', label: '資料', icon: 'fa-database' },
      { id: 'about', label: '版本', icon: 'fa-circle-info' },
    ];

    if (settingsPage && settingsForm) {
      const subtitle = settingsPage.querySelector('.sticky p.text-sm.text-wabi-text-secondary');
      if (subtitle && !root.querySelector('#settings-version-text')) {
        const versionText = document.createElement('p');
        versionText.id = 'settings-version-text';
        versionText.className = 'text-xs text-wabi-text-secondary mt-1';
        versionText.textContent = '目前版本 v' + APP_VERSION;
        subtitle.insertAdjacentElement('afterend', versionText);
      }

      const topLevelSections = Array.from(settingsPage.children).filter((element) => element.tagName === 'SECTION');
      const templateSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('範本管理'));
      const presetSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('兌換網址預設'));
      const importSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('資料匯入 / 匯出'));
      const batchSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('批量新增票券'));
      const healthSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('資料健康檢查'));
      const tagsSection = topLevelSections.find((element) => element.querySelector('h2')?.textContent?.includes('標籤管理'));
      const versionSection = topLevelSections.find((element) => !element.querySelector('h2') && element.textContent?.includes('版本時間'));

      const formChildren = Array.from(settingsForm.children);
      const generalIndexes = new Set([0, 1, 2, 3, 4, 6, 10]);
      const viewIndexes = new Set([7, 8, 9]);
      const aboutIndexes = new Set([5]);
      const generalNodes = formChildren.filter((_, index) => generalIndexes.has(index));
      const viewNodes = formChildren.filter((_, index) => viewIndexes.has(index));
      const aboutNodes = formChildren.filter((_, index) => aboutIndexes.has(index));

      for (const child of formChildren) {
        settingsForm.removeChild(child);
      }
      for (const node of generalNodes) {
        settingsForm.appendChild(node);
      }
      settingsForm.className = 'bg-white border border-wabi-border rounded-2xl p-4 space-y-3';

      const tabsShell = document.createElement('div');
      tabsShell.id = 'settings-tabs-shell';
      tabsShell.className = 'sticky z-20 -mx-4 px-4';
      tabsShell.style.top = 'calc(var(--safe-top) + 4.5rem)';
      tabsShell.innerHTML = '<div class="overflow-x-auto pb-1"><div class="flex gap-2 min-w-max">' + settingsTabs.map((tab) => (
        '<button type="button" data-settings-tab="' + tab.id + '" class="settings-tab-btn inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm whitespace-nowrap">' +
          '<i class="fa-solid ' + tab.icon + ' text-xs"></i>' +
          '<span>' + tab.label + '</span>' +
        '</button>'
      )).join('') + '</div></div>';
      settingsForm.before(tabsShell);

      const createPanel = () => {
        const panel = document.createElement('div');
        panel.className = 'space-y-4';
        return panel;
      };

      const viewsPanel = createPanel();
      viewsPanel.dataset.settingsPanel = 'views';
      viewsPanel.insertAdjacentHTML('beforeend', '<section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3"><h2 class="font-semibold text-wabi-primary">版面與背景</h2><p class="text-sm text-wabi-text-secondary">調整待使用、已使用與回收桶頁面的顯示方式。</p></section>');
      for (const node of viewNodes) {
        viewsPanel.appendChild(node);
      }

      const templatesPanel = createPanel();
      templatesPanel.dataset.settingsPanel = 'templates';
      if (templateSection) templatesPanel.appendChild(templateSection);
      if (presetSection) templatesPanel.appendChild(presetSection);

      const dataPanel = createPanel();
      dataPanel.dataset.settingsPanel = 'data';
      if (importSection) dataPanel.appendChild(importSection);
      if (batchSection) dataPanel.appendChild(batchSection);
      if (healthSection) dataPanel.appendChild(healthSection);
      if (tagsSection) dataPanel.appendChild(tagsSection);

      const aboutPanel = createPanel();
      aboutPanel.dataset.settingsPanel = 'about';
      aboutPanel.insertAdjacentHTML('beforeend', '<section class="bg-white border border-wabi-border rounded-2xl p-4 space-y-3"><h2 class="font-semibold text-wabi-primary">版本與更新</h2><div class="grid md:grid-cols-2 gap-3"><div class="rounded-xl border border-wabi-border/70 bg-wabi-bg/50 p-4"><p class="text-sm text-wabi-text-secondary">目前版本</p><p class="text-2xl font-bold text-wabi-primary mt-1">v' + escapeHtml(APP_VERSION) + '</p><p class="text-xs text-wabi-text-secondary mt-2">版本時間：' + escapeHtml(formatDateTime(Date.now())) + '</p></div><div class="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 class="text-sm font-semibold text-amber-800">版本說明</h3><p class="text-xs text-amber-700 mt-1">設定頁已改成依功能分頁顯示，並加入版本編號，方便確認目前安裝版本。</p></div></div></section>');
      for (const node of aboutNodes) {
        aboutPanel.appendChild(node);
      }
      if (versionSection) aboutPanel.appendChild(versionSection);

      settingsForm.dataset.settingsPanel = 'general';
      settingsForm.after(viewsPanel, templatesPanel, dataPanel, aboutPanel);

      if (!settingsTabs.some((tab) => tab.id === this.currentTab)) {
        this.currentTab = 'general';
      }

      const syncSettingsTabs = () => {
        root.querySelectorAll('[data-settings-tab]').forEach((button) => {
          const active = button.dataset.settingsTab === this.currentTab;
          button.className = 'settings-tab-btn inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm whitespace-nowrap ' + (active
            ? 'bg-wabi-primary text-white border-wabi-primary shadow-sm'
            : 'bg-white text-wabi-text-secondary border-wabi-border');
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        root.querySelectorAll('[data-settings-panel]').forEach((panel) => {
          panel.classList.toggle('hidden', panel.dataset.settingsPanel !== this.currentTab);
        });
      };

      root.querySelectorAll('[data-settings-tab]').forEach((button) => {
        button.addEventListener('click', () => {
          this.currentTab = button.dataset.settingsTab || 'general';
          syncSettingsTabs();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });

      syncSettingsTabs();
    }
    let activeBackgroundImages = Array.isArray(this.app.state.settings.viewConfigs?.active?.backgroundImages)
      ? this.app.state.settings.viewConfigs.active.backgroundImages.filter(Boolean)
      : [];
    if (!activeBackgroundImages.length && this.app.state.settings.viewConfigs?.active?.backgroundImage) {
      activeBackgroundImages = [this.app.state.settings.viewConfigs.active.backgroundImage];
    }
    let completedBackgroundImages = Array.isArray(this.app.state.settings.viewConfigs?.completed?.backgroundImages)
      ? this.app.state.settings.viewConfigs.completed.backgroundImages.filter(Boolean)
      : [];
    if (!completedBackgroundImages.length && this.app.state.settings.viewConfigs?.completed?.backgroundImage) {
      completedBackgroundImages = [this.app.state.settings.viewConfigs.completed.backgroundImage];
    }
    let deletedBackgroundImages = Array.isArray(this.app.state.settings.viewConfigs?.deleted?.backgroundImages)
      ? this.app.state.settings.viewConfigs.deleted.backgroundImages.filter(Boolean)
      : [];
    if (!deletedBackgroundImages.length && this.app.state.settings.viewConfigs?.deleted?.backgroundImage) {
      deletedBackgroundImages = [this.app.state.settings.viewConfigs.deleted.backgroundImage];
    }
    const activeShowBackgroundInput = root.querySelector('#active-show-background');
    const activeToggleBackgroundButton = root.querySelector('#active-toggle-background');
    const completedShowBackgroundInput = root.querySelector('#completed-show-background');
    const completedToggleBackgroundButton = root.querySelector('#completed-toggle-background');
    const deletedShowBackgroundInput = root.querySelector('#deleted-show-background');
    const deletedToggleBackgroundButton = root.querySelector('#deleted-toggle-background');
    const activeBgOpacityInput = root.querySelector('#active-bg-opacity');
    const activeBgOpacityValue = root.querySelector('#active-bg-opacity-value');
    const activeCardTransparencyInput = root.querySelector('#active-card-transparency');
    const activeCardTransparencyValue = root.querySelector('#active-card-transparency-value');
    const completedBgOpacityInput = root.querySelector('#completed-bg-opacity');
    const completedBgOpacityValue = root.querySelector('#completed-bg-opacity-value');
    const completedCardTransparencyInput = root.querySelector('#completed-card-transparency');
    const completedCardTransparencyValue = root.querySelector('#completed-card-transparency-value');
    const deletedBgOpacityInput = root.querySelector('#deleted-bg-opacity');
    const deletedBgOpacityValue = root.querySelector('#deleted-bg-opacity-value');
    const deletedCardTransparencyInput = root.querySelector('#deleted-card-transparency');
    const deletedCardTransparencyValue = root.querySelector('#deleted-card-transparency-value');
    const activeCardHeightInput = root.querySelector('#active-card-height');
    const activeCardHeightValue = root.querySelector('#active-card-height-value');
    const completedCardHeightInput = root.querySelector('#completed-card-height');
    const completedCardHeightValue = root.querySelector('#completed-card-height-value');
    const deletedCardHeightInput = root.querySelector('#deleted-card-height');
    const deletedCardHeightValue = root.querySelector('#deleted-card-height-value');
    const activeThumbnailScaleInput = root.querySelector('#active-thumbnail-scale');
    const activeThumbnailScaleValue = root.querySelector('#active-thumbnail-scale-value');
    const swipeGesturesEnabledInput = root.querySelector('#swipe-gestures-enabled');
    const swipeTriggerDistanceInput = root.querySelector('#swipe-trigger-distance');
    const swipeTriggerDistanceValue = root.querySelector('#swipe-trigger-distance-value');
    const activeBgPreviewWrap = root.querySelector('#active-bg-preview-wrap');
    const activeBgPreviewList = root.querySelector('#active-bg-preview-list');
    const activeBgCount = root.querySelector('#active-bg-count');
    const completedBgPreviewWrap = root.querySelector('#completed-bg-preview-wrap');
    const completedBgPreviewList = root.querySelector('#completed-bg-preview-list');
    const completedBgCount = root.querySelector('#completed-bg-count');
    const deletedBgPreviewWrap = root.querySelector('#deleted-bg-preview-wrap');
    const deletedBgPreviewList = root.querySelector('#deleted-bg-preview-list');
    const deletedBgCount = root.querySelector('#deleted-bg-count');
    const renderActiveBackgroundList = () => {
      if (activeBgPreviewList) {
        activeBgPreviewList.innerHTML = activeBackgroundImages.map((img, index) => `
          <div class="relative rounded-xl overflow-hidden border border-wabi-border">
            <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
            <button type="button" data-active-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
          </div>
        `).join('');
      }
      if (activeBgPreviewWrap) {
        activeBgPreviewWrap.classList.toggle('hidden', activeBackgroundImages.length === 0);
      }
      if (activeBgCount) {
        activeBgCount.textContent = activeBackgroundImages.length
          ? `已加入 ${activeBackgroundImages.length} 張，待使用頁會輪流顯示`
          : '尚未加入背景圖片';
      }
    };
    const renderCompletedBackgroundList = () => {
      if (completedBgPreviewList) {
        completedBgPreviewList.innerHTML = completedBackgroundImages.map((img, index) => `
          <div class="relative rounded-xl overflow-hidden border border-wabi-border">
            <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
            <button type="button" data-completed-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
          </div>
        `).join('');
      }
      if (completedBgPreviewWrap) {
        completedBgPreviewWrap.classList.toggle('hidden', completedBackgroundImages.length === 0);
      }
      if (completedBgCount) {
        completedBgCount.textContent = completedBackgroundImages.length
          ? `已加入 ${completedBackgroundImages.length} 張，已使用頁會輪流顯示`
          : '尚未加入背景圖片';
      }
    };
    const renderDeletedBackgroundList = () => {
      if (deletedBgPreviewList) {
        deletedBgPreviewList.innerHTML = deletedBackgroundImages.map((img, index) => `
          <div class="relative rounded-xl overflow-hidden border border-wabi-border">
            <img src="${escapeHtml(img)}" class="w-full h-24 object-cover bg-slate-50" />
            <button type="button" data-deleted-bg-remove="${index}" class="absolute top-1 right-1 px-2 py-1 rounded-md bg-black/65 text-white text-[11px]">移除</button>
          </div>
        `).join('');
      }
      if (deletedBgPreviewWrap) {
        deletedBgPreviewWrap.classList.toggle('hidden', deletedBackgroundImages.length === 0);
      }
      if (deletedBgCount) {
        deletedBgCount.textContent = deletedBackgroundImages.length
          ? `已加入 ${deletedBackgroundImages.length} 張，回收桶頁會輪流顯示`
          : '尚未加入背景圖片';
      }
    };
    const syncBackgroundControls = () => {
      const showBackground = activeShowBackgroundInput?.checked !== false;
      if (activeBgOpacityInput) activeBgOpacityInput.disabled = !showBackground;
      if (activeToggleBackgroundButton) {
        activeToggleBackgroundButton.textContent = showBackground ? '一鍵關閉背景' : '一鍵顯示背景';
      }
    };
    const syncCompletedBackgroundControls = () => {
      const showBackground = completedShowBackgroundInput?.checked !== false;
      if (completedBgOpacityInput) completedBgOpacityInput.disabled = !showBackground;
      if (completedToggleBackgroundButton) {
        completedToggleBackgroundButton.textContent = showBackground ? '一鍵關閉背景' : '一鍵顯示背景';
      }
    };
    const syncDeletedBackgroundControls = () => {
      const showBackground = deletedShowBackgroundInput?.checked !== false;
      if (deletedBgOpacityInput) deletedBgOpacityInput.disabled = !showBackground;
      if (deletedToggleBackgroundButton) {
        deletedToggleBackgroundButton.textContent = showBackground ? '一鍵關閉背景' : '一鍵顯示背景';
      }
    };
    const syncOpacityLabels = () => {
      if (activeBgOpacityValue && activeBgOpacityInput) {
        activeBgOpacityValue.textContent = `${Math.max(0, Math.min(100, Number(activeBgOpacityInput.value) || 0))}%`;
      }
      if (activeCardTransparencyValue && activeCardTransparencyInput) {
        activeCardTransparencyValue.textContent = `${Math.max(0, Math.min(100, Number(activeCardTransparencyInput.value) || 0))}%`;
      }
      if (completedBgOpacityValue && completedBgOpacityInput) {
        completedBgOpacityValue.textContent = `${Math.max(0, Math.min(100, Number(completedBgOpacityInput.value) || 0))}%`;
      }
      if (completedCardTransparencyValue && completedCardTransparencyInput) {
        completedCardTransparencyValue.textContent = `${Math.max(0, Math.min(100, Number(completedCardTransparencyInput.value) || 0))}%`;
      }
      if (deletedBgOpacityValue && deletedBgOpacityInput) {
        deletedBgOpacityValue.textContent = `${Math.max(0, Math.min(100, Number(deletedBgOpacityInput.value) || 0))}%`;
      }
      if (deletedCardTransparencyValue && deletedCardTransparencyInput) {
        deletedCardTransparencyValue.textContent = `${Math.max(0, Math.min(100, Number(deletedCardTransparencyInput.value) || 0))}%`;
      }
      if (activeCardHeightValue && activeCardHeightInput) {
        const cardHeight = Math.max(0, Math.min(360, Number(activeCardHeightInput.value) || 0));
        activeCardHeightValue.textContent = cardHeight > 0 ? `${cardHeight}px` : '自動';
      }
      if (completedCardHeightValue && completedCardHeightInput) {
        const cardHeight = Math.max(0, Math.min(360, Number(completedCardHeightInput.value) || 0));
        completedCardHeightValue.textContent = cardHeight > 0 ? `${cardHeight}px` : '自動';
      }
      if (deletedCardHeightValue && deletedCardHeightInput) {
        const cardHeight = Math.max(0, Math.min(360, Number(deletedCardHeightInput.value) || 0));
        deletedCardHeightValue.textContent = cardHeight > 0 ? `${cardHeight}px` : '自動';
      }
      if (activeThumbnailScaleValue && activeThumbnailScaleInput) {
        const thumbScale = Math.max(10, Math.min(100, Number(activeThumbnailScaleInput.value) || 100));
        activeThumbnailScaleValue.textContent = `${thumbScale}%`;
      }
    };
    const syncSwipeControls = () => {
      const enabled = swipeGesturesEnabledInput?.checked !== false;
      if (swipeTriggerDistanceInput) swipeTriggerDistanceInput.disabled = !enabled;
      if (swipeTriggerDistanceValue && swipeTriggerDistanceInput) {
        const nextDistance = Math.max(40, Math.min(120, Number(swipeTriggerDistanceInput.value) || 72));
        swipeTriggerDistanceValue.textContent = `${nextDistance}px`;
      }
    };
    if (this.importKeydownHandler) {
      window.removeEventListener('keydown', this.importKeydownHandler);
      this.importKeydownHandler = null;
    }
    syncBackgroundControls();
    syncCompletedBackgroundControls();
    syncDeletedBackgroundControls();
    syncOpacityLabels();
    syncSwipeControls();
    renderActiveBackgroundList();
    renderCompletedBackgroundList();
    renderDeletedBackgroundList();

    if (this.pendingImport) {
      this.importKeydownHandler = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.pendingImport = null;
          this.render();
          return;
        }
        if (event.key === 'Enter') {
          const target = event.target;
          if (target && target.tagName === 'TEXTAREA') return;
          event.preventDefault();
          root.querySelector('#confirm-import-confirm')?.click();
        }
      };
      window.addEventListener('keydown', this.importKeydownHandler);
    }

    root.querySelector('#settings-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const prevViewConfigs = this.app.state.settings.viewConfigs || {};
      const prevActiveViewConfig = prevViewConfigs.active || {};
      const prevCompletedViewConfig = prevViewConfigs.completed || {};
      const prevDeletedViewConfig = prevViewConfigs.deleted || {};
      const bgOpacityRaw = Number(activeBgOpacityInput?.value);
      const cardTransparencyRaw = Number(activeCardTransparencyInput?.value);
      const completedBgOpacityRaw = Number(completedBgOpacityInput?.value);
      const completedCardTransparencyRaw = Number(completedCardTransparencyInput?.value);
      const deletedBgOpacityRaw = Number(deletedBgOpacityInput?.value);
      const deletedCardTransparencyRaw = Number(deletedCardTransparencyInput?.value);
      const cardHeightRaw = Number(activeCardHeightInput?.value);
      const completedCardHeightRaw = Number(completedCardHeightInput?.value);
      const deletedCardHeightRaw = Number(deletedCardHeightInput?.value);
      const thumbnailScaleRaw = Number(activeThumbnailScaleInput?.value);
      const swipeTriggerDistanceRaw = Number(swipeTriggerDistanceInput?.value);
      const bgOpacityPercent = Math.max(0, Math.min(100, Number.isFinite(bgOpacityRaw) ? bgOpacityRaw : 100));
      const cardTransparencyPercent = Math.max(0, Math.min(100, Number.isFinite(cardTransparencyRaw) ? cardTransparencyRaw : 5));
      const completedBgOpacityPercent = Math.max(0, Math.min(100, Number.isFinite(completedBgOpacityRaw) ? completedBgOpacityRaw : 100));
      const completedCardTransparencyPercent = Math.max(0, Math.min(100, Number.isFinite(completedCardTransparencyRaw) ? completedCardTransparencyRaw : 5));
      const deletedBgOpacityPercent = Math.max(0, Math.min(100, Number.isFinite(deletedBgOpacityRaw) ? deletedBgOpacityRaw : 100));
      const deletedCardTransparencyPercent = Math.max(0, Math.min(100, Number.isFinite(deletedCardTransparencyRaw) ? deletedCardTransparencyRaw : 5));
      const cardHeight = Math.max(0, Math.min(360, Number.isFinite(cardHeightRaw) ? cardHeightRaw : 0));
      const completedCardHeight = Math.max(0, Math.min(360, Number.isFinite(completedCardHeightRaw) ? completedCardHeightRaw : 0));
      const deletedCardHeight = Math.max(0, Math.min(360, Number.isFinite(deletedCardHeightRaw) ? deletedCardHeightRaw : 0));
      const thumbnailScale = Math.max(10, Math.min(100, Number.isFinite(thumbnailScaleRaw) ? thumbnailScaleRaw : 100));
      const swipeTriggerDistance = Math.max(40, Math.min(120, Number.isFinite(swipeTriggerDistanceRaw) ? swipeTriggerDistanceRaw : 72));
      const nextActiveViewConfig = {
        ...prevActiveViewConfig,
        gridColumns: Math.max(1, Math.min(3, Number(root.querySelector('#active-grid-columns')?.value || 2))),
        showThumbnail: !(root.querySelector('#active-hide-thumbnail')?.checked),
        ultraCompactCard: root.querySelector('#active-ultra-compact')?.checked === true,
        backgroundImage: '',
        backgroundImages: [...activeBackgroundImages],
        showBackground: activeShowBackgroundInput?.checked !== false,
        bgOpacity: bgOpacityPercent / 100,
        cardOpacity: 1 - (cardTransparencyPercent / 100),
        cardHeight,
        thumbnailScale,
      };
      const nextCompletedViewConfig = {
        ...prevCompletedViewConfig,
        gridColumns: Math.max(1, Math.min(3, Number(root.querySelector('#completed-grid-columns')?.value || 2))),
        showThumbnail: !(root.querySelector('#completed-hide-thumbnail')?.checked),
        ultraCompactCard: root.querySelector('#completed-ultra-compact')?.checked === true,
        backgroundImage: '',
        backgroundImages: [...completedBackgroundImages],
        showBackground: completedShowBackgroundInput?.checked !== false,
        bgOpacity: completedBgOpacityPercent / 100,
        cardOpacity: 1 - (completedCardTransparencyPercent / 100),
        cardHeight: completedCardHeight,
      };
      const nextDeletedViewConfig = {
        ...prevDeletedViewConfig,
        gridColumns: Math.max(1, Math.min(3, Number(root.querySelector('#deleted-grid-columns')?.value || 2))),
        showThumbnail: !(root.querySelector('#deleted-hide-thumbnail')?.checked),
        ultraCompactCard: root.querySelector('#deleted-ultra-compact')?.checked === true,
        backgroundImage: '',
        backgroundImages: [...deletedBackgroundImages],
        showBackground: deletedShowBackgroundInput?.checked !== false,
        bgOpacity: deletedBgOpacityPercent / 100,
        cardOpacity: 1 - (deletedCardTransparencyPercent / 100),
        cardHeight: deletedCardHeight,
      };
      const carrierCode = (root.querySelector('#qp-carrier-code')?.value || '').trim();
      const memberCode = (root.querySelector('#qp-member-code')?.value || '').trim();
      const settings = {
        ...this.app.state.settings,
        appTitle: root.querySelector('#app-title').value.trim() || '歐米票夾 OmniTrunk',
        notifyDays: Math.max(1, Number(root.querySelector('#notify-days').value || 7)),
        tgToken: root.querySelector('#tg-token').value.trim(),
        tgChatId: root.querySelector('#tg-chat-id').value.trim(),
        localBackupFileName: root.querySelector('#backup-file-name').value.trim() || 'omnitrunk_backup',
        quickTags: parseTags(root.querySelector('#quick-tags')?.value || ''),
        scanSuccessSound: root.querySelector('#scan-success-sound')?.value || 'market',
        quickPasses: [
          {
            id: 'qp_carrier',
            label: '手機條碼載具',
            code: carrierCode,
            format: 'CODE_39',
            enabled: Boolean(root.querySelector('#qp-carrier-enabled')?.checked && carrierCode),
          },
          {
            id: 'qp_member',
            label: '常用會員條碼',
            code: memberCode,
            format: 'CODE_128',
            enabled: Boolean(root.querySelector('#qp-member-enabled')?.checked && memberCode),
          },
        ],
        swipeGesturesEnabled: root.querySelector('#swipe-gestures-enabled')?.checked !== false,
        swipeTriggerDistance,
        viewConfigs: {
          ...prevViewConfigs,
          active: nextActiveViewConfig,
          completed: nextCompletedViewConfig,
          deleted: nextDeletedViewConfig,
        },
      };
      this.app.state.settings = settings;
      await this.app.persistSettings();
      showToast('設定已儲存', 'success');
      window.location.hash = 'active';
    });

    activeShowBackgroundInput?.addEventListener('change', syncBackgroundControls);
    activeToggleBackgroundButton?.addEventListener('click', () => {
      if (!activeShowBackgroundInput) return;
      activeShowBackgroundInput.checked = !activeShowBackgroundInput.checked;
      syncBackgroundControls();
    });
    completedShowBackgroundInput?.addEventListener('change', syncCompletedBackgroundControls);
    completedToggleBackgroundButton?.addEventListener('click', () => {
      if (!completedShowBackgroundInput) return;
      completedShowBackgroundInput.checked = !completedShowBackgroundInput.checked;
      syncCompletedBackgroundControls();
    });
    deletedShowBackgroundInput?.addEventListener('change', syncDeletedBackgroundControls);
    deletedToggleBackgroundButton?.addEventListener('click', () => {
      if (!deletedShowBackgroundInput) return;
      deletedShowBackgroundInput.checked = !deletedShowBackgroundInput.checked;
      syncDeletedBackgroundControls();
    });
    activeBgOpacityInput?.addEventListener('input', syncOpacityLabels);
    activeCardTransparencyInput?.addEventListener('input', syncOpacityLabels);
    completedBgOpacityInput?.addEventListener('input', syncOpacityLabels);
    completedCardTransparencyInput?.addEventListener('input', syncOpacityLabels);
    deletedBgOpacityInput?.addEventListener('input', syncOpacityLabels);
    deletedCardTransparencyInput?.addEventListener('input', syncOpacityLabels);
    activeCardHeightInput?.addEventListener('input', syncOpacityLabels);
    completedCardHeightInput?.addEventListener('input', syncOpacityLabels);
    deletedCardHeightInput?.addEventListener('input', syncOpacityLabels);
    activeThumbnailScaleInput?.addEventListener('input', syncOpacityLabels);
    swipeGesturesEnabledInput?.addEventListener('change', syncSwipeControls);
    swipeTriggerDistanceInput?.addEventListener('input', syncSwipeControls);
    root.querySelector('#reset-swipe-hint')?.addEventListener('click', () => {
      try {
        window.localStorage?.removeItem(SWIPE_HINT_STORAGE_KEY);
      } catch (_error) {
        // Ignore storage errors.
      }
      showToast('已重設手勢提示，下次進入票券頁會再次顯示', 'success');
    });

    root.querySelector('#active-bg-file')?.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      let addedCount = 0;
      try {
        for (const file of files) {
          const compressed = await compressImage(file, 'thumbnail');
          activeBackgroundImages.push(compressed);
          addedCount += 1;
        }
        activeBackgroundImages = [...new Set(activeBackgroundImages)];
        if (activeShowBackgroundInput) {
          activeShowBackgroundInput.checked = true;
          syncBackgroundControls();
        }
        renderActiveBackgroundList();
        showToast(`背景圖片已加入 ${addedCount} 張（記得按儲存設定）`, 'success');
      } catch (error) {
        showToast(`背景圖片處理失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#active-bg-preview-list')?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-active-bg-remove]');
      if (!removeBtn) return;
      const index = Number(removeBtn.dataset.activeBgRemove);
      if (!Number.isFinite(index)) return;
      activeBackgroundImages.splice(index, 1);
      renderActiveBackgroundList();
      showToast('已移除背景圖片（記得按儲存設定）', 'success');
    });

    root.querySelector('#active-bg-clear')?.addEventListener('click', () => {
      activeBackgroundImages = [];
      renderActiveBackgroundList();
      showToast('背景圖片已清除（記得按儲存設定）', 'success');
    });
    root.querySelector('#completed-bg-file')?.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      let addedCount = 0;
      try {
        for (const file of files) {
          const compressed = await compressImage(file, 'thumbnail');
          completedBackgroundImages.push(compressed);
          addedCount += 1;
        }
        completedBackgroundImages = [...new Set(completedBackgroundImages)];
        if (completedShowBackgroundInput) {
          completedShowBackgroundInput.checked = true;
          syncCompletedBackgroundControls();
        }
        renderCompletedBackgroundList();
        showToast(`已使用背景已加入 ${addedCount} 張（記得按儲存設定）`, 'success');
      } catch (error) {
        showToast(`已使用背景處理失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#completed-bg-preview-list')?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-completed-bg-remove]');
      if (!removeBtn) return;
      const index = Number(removeBtn.dataset.completedBgRemove);
      if (!Number.isFinite(index)) return;
      completedBackgroundImages.splice(index, 1);
      renderCompletedBackgroundList();
      showToast('已移除已使用背景（記得按儲存設定）', 'success');
    });

    root.querySelector('#completed-bg-clear')?.addEventListener('click', () => {
      completedBackgroundImages = [];
      renderCompletedBackgroundList();
      showToast('已使用背景已清除（記得按儲存設定）', 'success');
    });

    root.querySelector('#deleted-bg-file')?.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []);
      if (!files.length) return;
      let addedCount = 0;
      try {
        for (const file of files) {
          const compressed = await compressImage(file, 'thumbnail');
          deletedBackgroundImages.push(compressed);
          addedCount += 1;
        }
        deletedBackgroundImages = [...new Set(deletedBackgroundImages)];
        if (deletedShowBackgroundInput) {
          deletedShowBackgroundInput.checked = true;
          syncDeletedBackgroundControls();
        }
        renderDeletedBackgroundList();
        showToast(`回收桶背景已加入 ${addedCount} 張（記得按儲存設定）`, 'success');
      } catch (error) {
        showToast(`回收桶背景處理失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#deleted-bg-preview-list')?.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-deleted-bg-remove]');
      if (!removeBtn) return;
      const index = Number(removeBtn.dataset.deletedBgRemove);
      if (!Number.isFinite(index)) return;
      deletedBackgroundImages.splice(index, 1);
      renderDeletedBackgroundList();
      showToast('已移除回收桶背景（記得按儲存設定）', 'success');
    });

    root.querySelector('#deleted-bg-clear')?.addEventListener('click', () => {
      deletedBackgroundImages = [];
      renderDeletedBackgroundList();
      showToast('回收桶背景已清除（記得按儲存設定）', 'success');
    });

    root.querySelector('#preview-scan-sound')?.addEventListener('click', () => {
      const soundId = root.querySelector('#scan-success-sound')?.value || 'market';
      playScanSuccessSound(soundId);
    });

    root.querySelector('#export-opbackup')?.addEventListener('click', async () => {
      const pwd = root.querySelector('#opbackup-password')?.value || '';
      const confirmPwd = root.querySelector('#opbackup-password-confirm')?.value || '';
      if (pwd.length < 8) {
        showToast('加密密碼至少需要 8 個字元', 'error');
        return;
      }
      if (pwd !== confirmPwd) {
        showToast('兩次輸入的備份密碼不一致', 'error');
        return;
      }
      try {
        showToast('正在以 PBKDF2 (600,000次) + AES-256-GCM 加密備份...');
        const { envelope, count } = await this.app.dataService.exportEncryptedBackup(pwd);
        const filename = `${(this.app.state.settings.localBackupFileName || 'omnitrunk_backup').trim()}-${new Date().toISOString().slice(0, 10)}.opbackup`;
        downloadJson(filename, envelope);
        showToast(`已匯出 ${count} 張票券的 .opbackup 加密備份`, 'success');
      } catch (err) {
        showToast(`加密備份失敗：${err.message}`, 'error');
      }
    });

    root.querySelector('#import-opbackup')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const pwd = root.querySelector('#opbackup-password')?.value || window.prompt('請輸入 .opbackup 備份檔密碼（至少 8 碼）') || '';
      if (!pwd) {
        showToast('已取消還原加密備份', 'error');
        event.target.value = '';
        return;
      }
      try {
        const text = await file.text();
        const mode = window.confirm('按「確定」以附加合併模式匯入（推薦，自動去重）；按「取消」以覆蓋模式匯入。') ? 'append' : 'overwrite';
        const nextState = await this.app.dataService.importEncryptedBackup(text, pwd, mode, true);
        this.app.state.tasks = nextState.tasks;
        this.app.state.settings = nextState.settings;
        this.app.state.templates = nextState.templates;
        this.app.state.expiryNotified = nextState.expiryNotified;
        this.app.updateNavVisibility?.();
        showToast(`加密備份還原成功（目前共 ${nextState.tasks.length} 張票券）`, 'success');
        this.render();
      } catch (err) {
        showToast(`解密還原失敗：${err.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#send-test-telegram')?.addEventListener('click', async () => {
      const { tgToken, tgChatId } = this.app.state.settings;
      const result = await sendTelegramMessage(tgToken, tgChatId, '🔔 這是一則來自「票夾」的測試訊息。');
      if (result.success) {
        showToast('Telegram 測試成功', 'success');
      } else {
        showToast(`Telegram 失敗：${result.error || '未知錯誤'}`, 'error');
      }
    });

    let templateDraftImage = '';
    let editingTemplateThumbId = '';
    const tplThumbFileInput = root.querySelector('#tpl-thumb-file');
    const tplThumbPreview = root.querySelector('#tpl-thumb-preview');
    const tplThumbPreviewWrap = root.querySelector('#tpl-thumb-preview-wrap');
    const templateThumbEditInput = root.querySelector('#template-thumb-edit-file');
    const syncTemplateDraftThumbPreview = () => {
      if (tplThumbPreview) tplThumbPreview.src = templateDraftImage || '';
      tplThumbPreviewWrap?.classList.toggle('hidden', !templateDraftImage);
    };
    syncTemplateDraftThumbPreview();

    tplThumbFileInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        templateDraftImage = await compressImage(file, 'thumbnail');
        syncTemplateDraftThumbPreview();
        showToast('範本縮圖已加入（記得按新增範本）', 'success');
      } catch (error) {
        showToast(`範本縮圖處理失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#tpl-thumb-clear')?.addEventListener('click', () => {
      templateDraftImage = '';
      syncTemplateDraftThumbPreview();
      showToast('已清除範本縮圖', 'success');
    });

    root.querySelector('#template-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const label = root.querySelector('#tpl-label').value.trim();
      const productName = root.querySelector('#tpl-product').value.trim();
      if (!label || !productName) {
        showToast('範本名稱與票券名稱必填', 'error');
        return;
      }
      const existed = this.app.state.templates.some((item) => (item.label || '').trim().toLowerCase() === label.toLowerCase());
      if (existed) {
        showToast('已有相同名稱範本', 'error');
        return;
      }
      const template = {
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        productName,
        tags: parseTags(root.querySelector('#tpl-tags').value),
        image: templateDraftImage,
      };
      this.app.state.templates = [template, ...this.app.state.templates];
      await this.app.persistTemplates();
      showToast('範本已新增', 'success');
      this.render();
    });

    root.querySelectorAll('[data-rename-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.renameTemplate;
        const tpl = this.app.state.templates.find((t) => t.id === id);
        if (!tpl) return;
        const next = window.prompt('新的範本名稱', tpl.label || tpl.productName || '');
        if (!next) return;
        const normalized = next.trim();
        if (!normalized) {
          showToast('範本名稱不可為空', 'error');
          return;
        }
        const existed = this.app.state.templates.some((item) => item.id !== tpl.id && (item.label || '').trim().toLowerCase() === normalized.toLowerCase());
        if (existed) {
          showToast('已有相同名稱範本', 'error');
          return;
        }
        tpl.label = normalized;
        await this.app.persistTemplates();
        showToast('範本名稱已更新', 'success');
        this.render();
      });
    });

    root.querySelectorAll('[data-set-default-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.setDefaultTemplate;
        const target = this.app.state.templates.find((tpl) => tpl.id === id);
        if (!target) return;
        this.app.state.settings = {
          ...this.app.state.settings,
          defaultTemplateId: id,
        };
        await this.app.persistSettings();
        showToast(`已設為預設範本：${target.label || target.productName || '未命名範本'}`, 'success');
        this.render();
      });
    });

    root.querySelectorAll('[data-clear-default-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if ((this.app.state.settings.defaultTemplateId || '') !== btn.dataset.clearDefaultTemplate) return;
        this.app.state.settings = {
          ...this.app.state.settings,
          defaultTemplateId: '',
        };
        await this.app.persistSettings();
        showToast('已取消預設範本', 'success');
        this.render();
      });
    });

    root.querySelectorAll('[data-move-template-up]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.moveTemplateUp;
        const index = this.app.state.templates.findIndex((tpl) => tpl.id === id);
        if (index <= 0) return;
        const list = [...this.app.state.templates];
        [list[index - 1], list[index]] = [list[index], list[index - 1]];
        this.app.state.templates = list;
        await this.app.persistTemplates();
        this.render();
      });
    });

    root.querySelectorAll('[data-move-template-down]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.moveTemplateDown;
        const index = this.app.state.templates.findIndex((tpl) => tpl.id === id);
        if (index < 0 || index >= this.app.state.templates.length - 1) return;
        const list = [...this.app.state.templates];
        [list[index + 1], list[index]] = [list[index], list[index + 1]];
        this.app.state.templates = list;
        await this.app.persistTemplates();
        this.render();
      });
    });

    root.querySelectorAll('[data-delete-template]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteTemplate;
        const target = this.app.state.templates.find((tpl) => tpl.id === id);
        const label = target?.label || target?.productName || '未命名範本';
        if (!window.confirm(`確定刪除範本「${label}」？`)) return;
        this.app.state.templates = this.app.state.templates.filter((tpl) => tpl.id !== id);
        const shouldClearDefaultTemplate = (this.app.state.settings.defaultTemplateId || '') === id;
        if (shouldClearDefaultTemplate) {
          this.app.state.settings = {
            ...this.app.state.settings,
            defaultTemplateId: '',
          };
        }
        await this.app.persistTemplates();
        if (shouldClearDefaultTemplate) await this.app.persistSettings();
        showToast(shouldClearDefaultTemplate ? '範本已刪除，並取消預設範本' : '範本已刪除', 'success');
        this.render();
      });
    });

    root.querySelectorAll('[data-edit-template-thumb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        editingTemplateThumbId = btn.dataset.editTemplateThumb || '';
        if (!editingTemplateThumbId) return;
        templateThumbEditInput?.click();
      });
    });

    templateThumbEditInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file || !editingTemplateThumbId) return;
      try {
        const image = await compressImage(file, 'thumbnail');
        const target = this.app.state.templates.find((tpl) => tpl.id === editingTemplateThumbId);
        if (!target) return;
        target.image = image;
        await this.app.persistTemplates();
        showToast('範本縮圖已更新', 'success');
        this.render();
      } catch (error) {
        showToast(`範本縮圖更新失敗：${error.message}`, 'error');
      } finally {
        editingTemplateThumbId = '';
        event.target.value = '';
      }
    });

    root.querySelectorAll('[data-clear-template-thumb]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.clearTemplateThumb;
        const target = this.app.state.templates.find((tpl) => tpl.id === id);
        if (!target?.image) return;
        target.image = '';
        await this.app.persistTemplates();
        showToast('範本縮圖已清除', 'success');
        this.render();
      });
    });

    root.querySelector('#preset-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const label = root.querySelector('#preset-label').value.trim();
      const url = root.querySelector('#preset-url').value.trim();
      if (!label || !url) {
        showToast('預設名稱與網址必填', 'error');
        return;
      }

      const presets = this.app.state.settings.redeemUrlPresets || [];
      const duplicatedLabel = presets.some((preset) => (preset.label || '').trim().toLowerCase() === label.toLowerCase());
      if (duplicatedLabel) {
        showToast('已有相同名稱的兌換網址預設', 'error');
        return;
      }

      const normalizedUrl = url.trim();

      const duplicatedUrl = presets.some((preset) => {
        if (!preset.url) return false;
        return (preset.url || '').trim() === normalizedUrl;
      });
      if (duplicatedUrl) {
        showToast('已有相同網址的兌換網址預設', 'error');
        return;
      }

      const preset = {
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label,
        url: normalizedUrl,
      };
      const nextSettings = {
        ...this.app.state.settings,
        redeemUrlPresets: [preset, ...presets],
      };
      this.app.state.settings = nextSettings;
      await this.app.persistSettings();
      showToast('兌換網址預設已新增', 'success');
      this.render();
    });

    root.querySelectorAll('[data-delete-preset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deletePreset;
        const preset = (this.app.state.settings.redeemUrlPresets || []).find((item) => item.id === id);
        const presetLabel = preset?.label || '未命名預設';
        const linkedCount = this.app.state.templates.filter((tpl) => tpl.redeemUrlPresetId === id).length;
        const message = linkedCount > 0
          ? `確定刪除預設「${presetLabel}」？\n將影響 ${linkedCount} 個範本引用。`
          : `確定刪除預設「${presetLabel}」？`;
        if (!window.confirm(message)) return;

        const nextSettings = {
          ...this.app.state.settings,
          redeemUrlPresets: (this.app.state.settings.redeemUrlPresets || []).filter((p) => p.id !== id),
        };
        this.app.state.settings = nextSettings;
        let cleanedCount = 0;
        this.app.state.templates = this.app.state.templates.map((tpl) => {
          if (tpl.redeemUrlPresetId !== id) return tpl;
          cleanedCount += 1;
          return { ...tpl, redeemUrlPresetId: '' };
        });
        await this.app.persistSettings();
        if (cleanedCount > 0) {
          await this.app.persistTemplates();
        }
        showToast(cleanedCount > 0 ? `已刪除預設並清理 ${cleanedCount} 個範本引用` : '已刪除兌換網址預設', 'success');
        this.render();
      });
    });

    root.querySelector('#batch-json-input')?.addEventListener('input', (event) => {
      const status = root.querySelector('#batch-import-status');
      if (!status) return;
      const value = event.target.value.trim();
      if (!value) {
        status.textContent = '尚未開始批量新增';
        return;
      }
      try {
        const validation = validateBatchRows(JSON.parse(value));
        status.textContent = validation.success ? `已解析 ${validation.data.length} 筆，按下按鈕後會產生票券與 QR code 圖片。` : validation.error;
      } catch {
        status.textContent = 'JSON 尚未完成或格式錯誤';
      }
    });

    root.querySelector('#batch-redeem-preset')?.addEventListener('change', (event) => {
      this.batchImportRedeemPresetId = event.target.value || '';
    });

    root.querySelector('#batch-import-submit')?.addEventListener('click', async () => {
      const status = root.querySelector('#batch-import-status');
      const jsonText = root.querySelector('#batch-json-input')?.value?.trim() || '';
      if (!jsonText) {
        showToast('請先貼上批量 JSON', 'error');
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        showToast('JSON 格式錯誤，請確認內容可以解析', 'error');
        return;
      }
      const validation = validateBatchRows(parsed);
      if (!validation.success) {
        showToast(validation.error, 'error');
        return;
      }
      const button = root.querySelector('#batch-import-submit');
      if (button) {
        button.disabled = true;
        button.textContent = '產生中...';
      }
      try {
        // Blur before replacing the focused textarea. On iOS PWA, replacing a
        // focused small-text input can leave Safari's visual viewport zoomed in.
        document.activeElement?.blur?.();
        const preset = (this.app.state.settings.redeemUrlPresets || []).find((item) => item.id === this.batchImportRedeemPresetId);
        const result = await buildBatchTickets(validation.data, this.app.state.tasks, preset?.url || '');
        this.app.state.tasks = [...result.tickets, ...this.app.state.tasks];
        await this.app.persistTasks();
        this.batchImportPreview = result.tickets[0]?.image || '';
        this.batchImportStatus = `批量新增完成：${result.tickets.length} 張，重複序號 ${result.duplicates} 張。已加入「批量生成」標籤。`;
        showToast(this.batchImportStatus, 'success', 4000);
        this.currentTab = 'data';
        this.render();
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
          document.getElementById('app-container')?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
          document.activeElement?.blur?.();
        });
      } catch (error) {
        showToast(`批量新增失敗：${error.message}`, 'error');
        if (button) {
          button.disabled = false;
          button.textContent = '解析並批量新增';
        }
      }
    });

    root.querySelector('#export-json')?.addEventListener('click', async () => {
      const backup = await this.app.dataService.exportAllData();
      const baseName = this.app.state.settings.localBackupFileName || 'ticket_backup';
      const now = new Date();
      const filename = `${baseName}_${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}.json`;
      downloadJson(filename, backup);
      await this.app.dataService.recordBackup();
      showToast('匯出完成', 'success');
    });

    root.querySelector('#import-mode')?.addEventListener('change', (event) => {
      this.importOptions.mode = event.target.value === 'overwrite' ? 'overwrite' : 'append';
    });

    root.querySelector('#restore-settings')?.addEventListener('change', (event) => {
      this.importOptions.restoreSettings = !!event.target.checked;
    });

    root.querySelector('#import-json')?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const raw = JSON.parse(text);
        const validation = validateImportData(raw);
        if (!validation.success) {
          showToast(validation.error || '匯入資料驗證失敗', 'error');
          return;
        }

        this.pendingImport = {
          data: validation.data,
          fileName: file.name,
          count: Array.isArray(validation.data.tasks) ? validation.data.tasks.length : 0,
          hasSettings: !!validation.data.settings,
          mode: this.importOptions.mode,
          restoreSettings: this.importOptions.restoreSettings,
        };
        this.render();
      } catch (error) {
        showToast(`匯入失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelectorAll('[data-import-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.pendingImport) return;
        this.pendingImport.mode = btn.dataset.importMode === 'overwrite' ? 'overwrite' : 'append';
        this.importOptions.mode = this.pendingImport.mode;
        this.render();
      });
    });

    root.querySelector('#cancel-import-confirm')?.addEventListener('click', () => {
      const restoreSettingsInput = root.querySelector('#import-confirm-restore-settings');
      if (restoreSettingsInput) {
        this.importOptions.restoreSettings = restoreSettingsInput.checked;
      }
      this.pendingImport = null;
      this.render();
    });

    root.querySelector('#confirm-import-confirm')?.addEventListener('click', async () => {
      if (!this.pendingImport) return;
      const mode = this.pendingImport.mode || 'append';
      const restoreSettingsInput = root.querySelector('#import-confirm-restore-settings');
      const restoreSettings = restoreSettingsInput ? restoreSettingsInput.checked : false;
      this.importOptions.mode = mode;
      this.importOptions.restoreSettings = restoreSettings;

      if (mode === 'overwrite') {
        const ok = window.confirm('覆蓋模式會取代現有票券資料，確定要繼續？');
        if (!ok) return;
      }

      const imported = await this.app.dataService.importData(this.pendingImport.data, mode, restoreSettings);
      this.app.state.tasks = imported.tasks;
      this.app.state.settings = imported.settings;
      this.app.state.templates = imported.templates;
      this.app.state.expiryNotified = imported.expiryNotified;

      this.pendingImport = null;
      showToast(`匯入完成，共 ${imported.tasks.length} 張票券`, 'success');
      this.render();
    });

    root.querySelector('#full-reset')?.addEventListener('click', async () => {
      const ok1 = window.confirm('此操作會清空本機所有資料，是否繼續？');
      if (!ok1) return;
      const ok2 = window.confirm('請再次確認：清空後無法復原，確定要刪除全部資料？');
      if (!ok2) return;

      const keys = [
        DB_KEYS.TASKS,
        DB_KEYS.SETTINGS,
        DB_KEYS.BG_HISTORY,
        DB_KEYS.TEMPLATES,
        DB_KEYS.EXPIRY_NOTIFIED,
        DB_KEYS.LAST_BACKUP,
      ];
      await Promise.all(keys.map((key) => this.app.dataService.removeItem(key)));
      showToast('資料已清空，正在重新載入', 'success');
      window.location.hash = 'active';
      window.location.reload();
    });

    root.querySelector('#force-refresh-settings')?.addEventListener('click', async () => {
      const ok = window.confirm('這會重新下載最新版並重新整理頁面，未儲存的設定可能遺失。要繼續嗎？');
      if (!ok) return;

      try {
        await forceRefreshToLatest();
      } catch (error) {
        showToast(error?.message || '強制更新失敗，請稍後再試。', 'error');
      }
    });

    root.querySelector('#run-health-check')?.addEventListener('click', async () => {
      this.health = await this.app.dataService.checkDataHealth();
      showToast(this.health.isHealthy ? '資料檢查完成：正常' : '資料檢查完成：發現問題', this.health.isHealthy ? 'success' : 'error');
      this.render();
    });

    root.querySelector('#cleanup-residual-data')?.addEventListener('click', async () => {
      const ok = window.confirm('將清理舊版殘留 key 與冗餘設定欄位，不會刪除票券資料。是否繼續？');
      if (!ok) return;

      const result = await this.app.dataService.cleanupResidualData();
      const refreshed = await this.app.dataService.loadState();
      this.app.state.tasks = refreshed.tasks;
      this.app.state.settings = refreshed.settings;
      this.app.state.templates = refreshed.templates;
      this.app.state.expiryNotified = refreshed.expiryNotified;

      const hints = [];
      if (result.removedKeys.length > 0) hints.push(`清除 ${result.removedKeys.length} 個舊索引`);
      if (result.settingsCompacted) hints.push('已壓縮設定欄位');
      if (result.removedExpiryNotifiedCount > 0) hints.push(`移除 ${result.removedExpiryNotifiedCount} 筆無效通知紀錄`);
      if (result.reclaimedBytes > 0) hints.push(`釋放 ${formatBytes(result.reclaimedBytes)}`);

      showToast(hints.length ? `清理完成：${hints.join('、')}` : '清理完成：未偵測到可清理項目', 'success');
      this.health = await this.app.dataService.checkDataHealth();
      this.render();
    });

    root.querySelector('#run-barcode-audit')?.addEventListener('click', async () => {
      const candidates = this.app.state.tasks.filter((ticket) => !ticket.isDeleted && ticket.serial && (ticket.originalImage || ticket.image));
      if (!candidates.length) {
        showToast('沒有可檢查的票券（需包含序號與圖片）', 'error');
        return;
      }

      const report = {
        total: candidates.length,
        matched: 0,
        mismatched: [],
        noBarcode: [],
      };

      showToast('正在進行條碼一致性檢查...');
      const { scanMultipleBarcodesFromImage } = await getBarcodeScanner();

      for (const ticket of candidates) {
        const source = ticket.originalImage || ticket.image;
        try {
          const results = await scanMultipleBarcodesFromImage(source, { preferredFormat: ticket.barcodeFormat });
          if (!results.length) {
            report.noBarcode.push(ticket.productName || ticket.id);
            continue;
          }

          if (results.some((result) => result.content === ticket.serial)) {
            report.matched += 1;
          } else {
            report.mismatched.push({
              name: ticket.productName || ticket.id,
              serial: ticket.serial,
              scannedSerial: results[0].content,
            });
          }
        } catch (_error) {
          report.noBarcode.push(ticket.productName || ticket.id);
        }
      }

      this.barcodeAudit = report;
      showToast('條碼一致性檢查完成', report.mismatched.length === 0 ? 'success' : 'error');
      this.render();
    });

    root.querySelector('#request-persistence')?.addEventListener('click', async () => {
      const granted = await this.app.dataService.requestPersistentStorage();
      showToast(granted ? '已啟用持久化儲存' : '瀏覽器未授權持久化儲存', granted ? 'success' : 'error');
      this.health = await this.app.dataService.checkDataHealth();
      this.render();
    });

    root.querySelectorAll('[data-delete-tag]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tag = btn.dataset.deleteTag;
        if (!tag) return;
        if (!window.confirm(`確定刪除標籤「${tag}」？將從所有票券移除此標籤。`)) return;
        this.app.state.tasks = this.app.state.tasks.map((ticket) => ({
          ...ticket,
          tags: (ticket.tags || []).filter((t) => t !== tag),
        }));
        await this.app.persistTasks();
        showToast(`標籤 #${tag} 已移除`, 'success');
        this.render();
      });
    });
  }
}
