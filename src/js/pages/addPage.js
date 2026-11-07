import {
  BARCODE_FORMATS,
  compressImage,
  escapeHtml,
  generateId,
  parseTags,
  showToast,
  tagsToText,
  parseExpiryText,
  formatExpiryMask,
  ticketImageGenerationMode,
  formatExpiryText,
  findTitleAutoTemplate,
  TITLE_AUTO_TEMPLATE_KEYWORD,
} from '../utils.js';
import { BATCH_IMAGE_VERSION, renderBatchTicketImage } from '../services/batchImportService.js';
import { playScanSuccessSound } from '../services/omniCoreService.js';

let barcodeServicePromise = null;

async function getBarcodeScanner() {
  barcodeServicePromise ||= import('../services/barcodeService.js');
  return barcodeServicePromise;
}

export class AddPage {
  constructor(app) {
    this.app = app;
  }

  getDefaultExpiryAfterMonths(months = 6) {
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth();
    const day = now.getDate();

    const targetMonthTotal = monthIndex + months;
    const targetYear = year + Math.floor(targetMonthTotal / 12);
    const targetMonth = targetMonthTotal % 12;
    const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const targetDay = Math.min(day, lastDayOfTargetMonth);

    const mm = String(targetMonth + 1).padStart(2, '0');
    const dd = String(targetDay).padStart(2, '0');
    return `${targetYear}/${mm}/${dd}`;
  }

  getEditingTicket() {
    const id = this.app.state.ui.editingTicketId;
    if (!id) return null;
    return this.app.state.tasks.find((t) => t.id === id) || null;
  }

  buildTemplateOptions(selectedTemplateId = '') {
    const options = this.app.state.templates || [];
    const hasSelectedTemplate = options.some((tpl) => tpl.id === selectedTemplateId);
    return [
      `<option value="" ${!hasSelectedTemplate ? 'selected' : ''}>不套用範本</option>`,
      ...options.map((tpl) => `<option value="${tpl.id}" ${tpl.id === selectedTemplateId ? 'selected' : ''}>${escapeHtml(tpl.label || tpl.productName || '未命名範本')}</option>`),
    ]
      .join('');
  }

  buildBarcodeFormatOptions(selected = '') {
    return BARCODE_FORMATS.map((item) => `
      <option value="${item.value}" ${item.value === selected ? 'selected' : ''}>${item.label}</option>
    `).join('');
  }

  pickBarcodeResult(results) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-md bg-white rounded-2xl border border-wabi-border shadow-2xl p-4">
          <h3 class="text-lg font-semibold text-wabi-primary mb-1">選擇條碼</h3>
          <p class="text-sm text-wabi-text-secondary mb-3">偵測到 ${results.length} 個結果，請選擇要帶入的序號</p>
          <div class="space-y-2 max-h-72 overflow-auto">
            ${results.map((result, index) => `
              <button type="button" data-pick-barcode="${index}" class="w-full text-left px-3 py-2 rounded-lg border border-wabi-border hover:bg-wabi-primary/5">
                <p class="text-sm font-medium break-all">${escapeHtml(result.content || result.text || '')}</p>
                <p class="text-xs text-wabi-text-secondary mt-1">${escapeHtml(result.format || 'UNKNOWN')}</p>
              </button>
            `).join('')}
          </div>
          <div class="flex justify-end mt-3">
            <button type="button" data-cancel-barcode class="px-4 py-2 rounded-lg border border-wabi-border text-sm">取消</button>
          </div>
        </div>
      `;

      const cleanup = (picked) => {
        modal.remove();
        resolve(picked || null);
      };

      modal.addEventListener('click', (event) => {
        if (event.target === modal) cleanup(null);
      });

      modal.querySelector('[data-cancel-barcode]')?.addEventListener('click', () => cleanup(null));
      modal.querySelectorAll('[data-pick-barcode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const index = Number(btn.dataset.pickBarcode);
          cleanup(results[index]);
        });
      });

      document.body.appendChild(modal);
    });
  }

  async render() {
    const editing = this.getEditingTicket();
    const defaultExpiry = this.getDefaultExpiryAfterMonths(6);
    const defaultExpiryInputValue = formatExpiryText(editing?.expiry || defaultExpiry);
    const quickTags = (this.app.state.settings.quickTags || []).filter(Boolean);
    const selectedQuickTagSet = new Set(editing?.tags || []);
    const selectableTags = [...new Set([...quickTags, ...(editing?.tags || [])])];
    if (!editing && this.app.state.ui.editingTicketId) {
      this.app.state.ui.editingTicketId = null;
      this.app.state.ui.editingFromRoute = null;
    }
    const backRoute = editing ? (this.app.state.ui.editingFromRoute || 'active') : 'active';
    const routeLabel = backRoute === 'completed' ? '已使用' : backRoute === 'deleted' ? '回收桶' : '待使用';
    const defaultTemplateId = editing ? '' : this.app.state.settings.defaultTemplateId || '';
    const defaultTemplate = defaultTemplateId
      ? this.app.state.templates.find((tpl) => tpl.id === defaultTemplateId)
      : null;
    const defaultTemplateLabel = defaultTemplate?.label || defaultTemplate?.productName || '';

    this.app.mount(`
      <section class="page add-ticket-page active p-4 pb-24 md:pb-8 max-w-3xl mx-auto">
        <div class="omni-page-head flex items-center justify-between mb-4">
          <div>
            <h1 class="text-2xl font-bold text-wabi-primary">${editing ? '編輯票券' : '新增票券'}</h1>
            ${editing ? `<p class="text-xs text-wabi-text-secondary mt-1">來源視圖：${routeLabel}</p>` : ''}
          </div>
          <a id="add-back-link" href="#${backRoute}" class="px-3 py-2 rounded-lg bg-white border border-wabi-border text-sm">${editing ? '返回來源' : '返回'}</a>
        </div>

        <form id="ticket-form" class="space-y-4 bg-white border border-wabi-border rounded-2xl p-4">
          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">範本快速套用</label>
            <select id="template-id" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">${this.buildTemplateOptions(defaultTemplateId)}</select>
            <p class="mt-1 text-[11px] text-wabi-text-secondary">
              ${editing
                ? '編輯票券時不會自動套用預設範本。'
                : defaultTemplateLabel
                  ? `目前預設：${escapeHtml(defaultTemplateLabel)}。手動改選後會記住新的預設。`
                  : '手動選擇範本後會記住為下次新增的預設。'
              }
            </p>
          </div>

          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">票券名稱 *</label>
            <input id="product-name" required class="w-full rounded-lg border border-wabi-border px-3 py-2" value="${escapeHtml(editing?.productName || '')}" />
          </div>

          <div class="space-y-3 rounded-2xl border border-wabi-border/70 bg-wabi-bg/40 p-3">
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">縮圖模式（主頁卡片）</label>
              <input id="thumb-image-file" type="file" accept="image/*" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
              <div id="thumb-image-preview-wrap" class="mt-2 ${editing?.image ? '' : 'hidden'}">
                <img id="thumb-image-preview" src="${escapeHtml(editing?.image || '')}" class="w-full max-h-40 object-cover rounded-xl border border-wabi-border" />
                <button id="thumb-image-clear-btn" type="button" class="mt-2 px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除縮圖</button>
              </div>
            </div>

            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">原圖模式（核銷畫面）</label>
              <input id="original-image-file" type="file" accept="image/*" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
              <div id="original-image-preview-wrap" class="mt-2 ${editing?.originalImage ? '' : 'hidden'}">
                <img id="original-image-preview" src="${escapeHtml(editing?.originalImage || '')}" class="w-full max-h-56 object-contain rounded-xl border border-wabi-border bg-slate-50" />
                <button id="original-image-clear-btn" type="button" class="mt-2 px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除原圖</button>
              </div>
            </div>
            ${editing?.tags?.includes('批量生成') ? `
              <div>
                <label class="block text-sm text-wabi-text-secondary mb-1">名稱上方商品圖（兌換圖片）</label>
                <input id="batch-product-image-file" type="file" accept="image/*" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" />
                <div id="batch-product-image-preview-wrap" class="mt-2 ${editing?.batchProductImage ? '' : 'hidden'}">
                  <img id="batch-product-image-preview" src="${escapeHtml(editing?.batchProductImage || '')}" class="w-full max-h-40 object-contain rounded-xl border border-wabi-border bg-slate-50" alt="上方圖片替換區預覽" />
                  <button id="batch-product-image-clear-btn" type="button" class="mt-2 px-3 py-1.5 rounded-lg border border-wabi-border text-xs">清除自訂商品圖</button>
                </div>
              </div>
              <p class="text-xs text-purple-700 rounded-lg border border-purple-100 bg-purple-50 px-3 py-2">
                這是批量生成票券。上傳照片後，只會替換預設版面中的「咖啡＋85 度 C LOGO」圖片區，其他版面內容會保留。
              </p>
            ` : ''}
          </div>

          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <div class="flex items-center justify-between mb-1">
                <label class="block text-sm text-wabi-text-secondary">序號</label>
                <button id="live-camera-scan-btn" type="button" class="inline-flex items-center gap-1 text-xs font-extrabold text-wabi-primary hover:underline">
                  <i class="fa-solid fa-camera"></i> 相機即時掃碼
                </button>
              </div>
              <input id="serial" class="w-full rounded-lg border border-wabi-border px-3 py-2" value="${escapeHtml(editing?.serial || '')}" />
              <p id="serial-duplicate-warning" class="hidden text-xs text-amber-700 mt-1">此序號已存在於其他待用/已用票券</p>
              <div id="live-camera-panel" class="hidden mt-2 rounded-2xl border border-indigo-200 bg-slate-950 p-3 text-white space-y-2">
                <div class="flex items-center justify-between text-xs">
                  <span class="font-bold text-indigo-200">📷 OmniPass 即時條碼掃描器</span>
                  <button id="live-camera-stop-btn" type="button" class="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-white font-semibold">關閉相機</button>
                </div>
                <div class="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
                  <video id="live-camera-video" class="w-full h-full object-cover" playsinline muted></video>
                  <div class="pointer-events-none absolute inset-x-8 inset-y-6 border-2 border-indigo-400/80 rounded-xl shadow-[0_0_0_9999px_rgba(11,16,32,0.42)]"></div>
                </div>
                <p class="text-[11px] text-indigo-200/85 text-center">請將一維條碼或 QR Code 對準中央框線內</p>
              </div>
            </div>
            <div>
              <label class="block text-sm text-wabi-text-secondary mb-1">到期日</label>
              <input id="expiry" type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY/MM/DD" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white" value="${escapeHtml(defaultExpiryInputValue)}" />
            </div>
          </div>

          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">條碼格式</label>
            <select id="barcode-format" class="w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
              ${this.buildBarcodeFormatOptions(editing?.barcodeFormat || '')}
            </select>
          </div>

          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">兌換網址</label>
            <input id="redeem-url" class="w-full rounded-lg border border-wabi-border px-3 py-2" value="${escapeHtml(editing?.redeemUrl || '')}" />
            <select id="redeem-url-preset" class="mt-2 w-full rounded-lg border border-wabi-border px-3 py-2 bg-white">
              <option value="">套用兌換網址預設</option>
              ${(this.app.state.settings.redeemUrlPresets || []).map((preset) => `<option value="${preset.id}">${escapeHtml(preset.label)}</option>`).join('')}
            </select>
          </div>

          ${editing?.completed || editing?.isDeleted ? '' : `
          <div class="rounded-lg border border-wabi-border/70 p-3">
            <label class="inline-flex items-center gap-2 text-sm font-medium text-wabi-primary">
              <input id="ticket-pinned" type="checkbox" ${editing?.pinned ? 'checked' : ''} />
              設為置頂票券
            </label>
            <p class="text-xs text-wabi-text-secondary mt-1">置頂只適用於未使用票券，會優先顯示在待使用清單前面；票券一旦核銷或移至回收桶會自動取消置頂。</p>
          </div>`}

          <div>
            <label class="block text-sm text-wabi-text-secondary mb-1">標籤</label>
            <input id="tags" type="hidden" value="${escapeHtml(tagsToText(editing?.tags || []))}" />
            ${selectableTags.length ? `
              <div class="mt-2 flex flex-wrap gap-2">
                ${selectableTags.map((tag) => `
                  <button type="button" data-quick-tag="${escapeHtml(tag)}" class="px-2.5 py-1 rounded-full text-xs border ${selectedQuickTagSet.has(tag) ? 'bg-wabi-primary text-white border-wabi-primary' : 'bg-white border-wabi-border text-wabi-primary'}">#${escapeHtml(tag)}</button>
                `).join('')}
              </div>
            ` : '<p class="text-xs text-wabi-text-secondary">尚未設定預設標籤，請先到「設定」填寫快速標籤。</p>'}
            <div class="mt-3 flex gap-2">
              <input id="custom-tag-input" type="text" placeholder="輸入新標籤" class="min-w-0 flex-1 rounded-lg border border-wabi-border px-3 py-2 text-sm" />
              <button id="add-custom-tag" type="button" class="shrink-0 rounded-lg bg-wabi-primary/10 px-3 py-2 text-sm font-semibold text-wabi-primary">新增標籤</button>
            </div>
            <div id="selected-tags-preview" class="mt-2 flex flex-wrap gap-2"></div>
          </div>

          <div class="ticket-form-actions ticket-form-actions--bottom -mx-2 mt-2 rounded-2xl border border-wabi-border bg-white/95 p-2 shadow-lg backdrop-blur">
            <div class="grid grid-cols-2 gap-2">
              <button id="scan-barcode-btn" type="button" class="min-h-11 rounded-xl bg-wabi-primary/10 px-3 py-2 text-sm font-semibold text-wabi-primary">從原圖讀取條碼</button>
              <button id="save-template-btn" type="button" class="min-h-11 rounded-xl bg-wabi-accent/40 px-3 py-2 text-sm font-semibold text-wabi-primary">儲存為範本</button>
            </div>
            <div class="mt-2 grid grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] gap-2">
              <a id="add-cancel-link" href="#${backRoute}" class="flex min-h-12 items-center justify-center rounded-xl border border-wabi-border px-3 py-2 text-sm font-semibold text-wabi-primary">${editing ? '放棄變更' : '取消'}</a>
              <button class="min-h-12 rounded-xl bg-wabi-primary px-3 py-2 text-sm font-semibold text-white">${editing ? '儲存變更' : '新增票券'}</button>
            </div>
          </div>
        </form>
      </section>
    `);

    this.bindEvents(editing);
  }

  bindEvents(editing) {
    const defaultExpiry = this.getDefaultExpiryAfterMonths(6);
    const root = this.app.getRoot();
    const form = root.querySelector('#ticket-form');
    const thumbImageInput = root.querySelector('#thumb-image-file');
    const thumbImagePreview = root.querySelector('#thumb-image-preview');
    const thumbImageWrap = root.querySelector('#thumb-image-preview-wrap');
    const originalImageInput = root.querySelector('#original-image-file');
    const originalImagePreview = root.querySelector('#original-image-preview');
    const originalImageWrap = root.querySelector('#original-image-preview-wrap');
    const serialInput = root.querySelector('#serial');
    const expiryInput = root.querySelector('#expiry');
    let lastValidExpiry = expiryInput?.value || '';
    const commitExpiryInput = () => {
      if (!expiryInput) return true;
      const raw = expiryInput.value.trim();
      if (!raw) { lastValidExpiry = ''; return true; }
      const parsed = parseExpiryText(raw);
      if (!parsed) {
        showToast('到期日格式錯誤，請輸入 YYYY/MM/DD', 'error');
        expiryInput.value = lastValidExpiry;
        return false;
      }
      expiryInput.value = parsed;
      lastValidExpiry = parsed;
      return true;
    };
    expiryInput?.addEventListener('blur', commitExpiryInput);
    expiryInput?.addEventListener('input', () => {
      const masked = formatExpiryMask(expiryInput.value);
      if (masked !== expiryInput.value) expiryInput.value = masked;
    });
    const duplicateWarning = root.querySelector('#serial-duplicate-warning');
    const tagsInput = root.querySelector('#tags');
    const selectedTagsPreview = root.querySelector('#selected-tags-preview');
    const customTagInput = root.querySelector('#custom-tag-input');
    const addCustomTagButton = root.querySelector('#add-custom-tag');

    let imageData = editing?.image || '';
    let originalImage = editing?.originalImage || '';
    let batchProductImage = editing?.batchProductImage || '';
    // True while the original image is a borrowed template screenshot:
    // the serial/QR/expiry printed inside it belong to the template's
    // source voucher, so on save the picture is re-rendered from this
    // ticket's own serial/expiry instead of keeping the borrowed one.
    let originalImageFromTemplate = !!(
      editing?.originalImage
      && (
        editing.originalImageGenerated === true
        || (this.app.state.templates || []).some((tpl) => tpl.originalImage && tpl.originalImage === editing.originalImage)
      )
    );

    const isDuplicateSerial = (serial) => this.app.state.tasks.some((ticket) => {
        if (ticket.isDeleted) return false;
        if (editing && ticket.id === editing.id) return false;
        return (ticket.serial || '').trim() === serial;
      });

    const updateDuplicateSerialHint = () => {
      const serial = (serialInput?.value || '').trim();
      if (!serial) {
        duplicateWarning?.classList.add('hidden');
        return;
      }
      const duplicated = isDuplicateSerial(serial);
      duplicateWarning?.classList.toggle('hidden', !duplicated);
    };

    const syncQuickTagState = () => {
      const selectedTags = new Set(parseTags(tagsInput?.value || ''));
      root.querySelectorAll('[data-quick-tag]').forEach((btn) => {
        const tag = btn.dataset.quickTag;
        if (!tag) return;
        const active = selectedTags.has(tag);
        btn.classList.toggle('bg-wabi-primary', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('border-wabi-primary', active);
        btn.classList.toggle('bg-white', !active);
        btn.classList.toggle('border-wabi-border', !active);
        btn.classList.toggle('text-wabi-primary', !active);
      });
      if (selectedTagsPreview) {
        const selected = [...selectedTags];
        selectedTagsPreview.innerHTML = selected.length
          ? selected.map((tag) => `<span class="inline-flex items-center gap-1 rounded-full border border-wabi-primary/20 bg-wabi-primary/10 px-2.5 py-1 text-xs font-semibold text-wabi-primary">#${escapeHtml(tag)}<button type="button" data-remove-tag="${escapeHtml(tag)}" class="ml-0.5 leading-none text-wabi-primary" aria-label="移除標籤 ${escapeHtml(tag)}">×</button></span>`).join('')
          : '<span class="text-xs text-wabi-text-secondary">尚未選擇標籤</span>';
      }
    };

    const applyBarcodeResult = (selected) => {
      if (!selected || !serialInput) return;
      serialInput.value = selected.content || selected.text || '';
      const barcodeFormatSelect = root.querySelector('#barcode-format');
      if (barcodeFormatSelect) barcodeFormatSelect.value = selected.format || '';
      updateDuplicateSerialHint();
      playScanSuccessSound(this.app.state.settings?.scanSuccessSound || 'market');
      showToast('已帶入條碼序號', 'success');
    };

    // OmniPass Live Camera ROI Barcode Scanner
    let cameraStream = null;
    let cameraTimer = null;
    const stopLiveCamera = () => {
      if (cameraTimer) {
        clearInterval(cameraTimer);
        cameraTimer = null;
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
        cameraStream = null;
      }
      const video = root.querySelector('#live-camera-video');
      if (video) video.srcObject = null;
      root.querySelector('#live-camera-panel')?.classList.add('hidden');
    };

    root.querySelector('#live-camera-stop-btn')?.addEventListener('click', stopLiveCamera);
    root.querySelector('#live-camera-scan-btn')?.addEventListener('click', async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        showToast('目前瀏覽器不支援相機存取，請改用上傳原圖辨識', 'error');
        return;
      }
      try {
        stopLiveCamera();
        const panel = root.querySelector('#live-camera-panel');
        const video = root.querySelector('#live-camera-video');
        panel?.classList.remove('hidden');
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (video) {
          video.srcObject = cameraStream;
          await video.play();
        }
        const captureCanvas = document.createElement('canvas');
        cameraTimer = setInterval(async () => {
          if (!video || video.readyState < 2) return;
          captureCanvas.width = video.videoWidth || 640;
          captureCanvas.height = video.videoHeight || 360;
          const ctx = captureCanvas.getContext('2d');
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
          const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.8);
          const { scanBarcodeFromImage } = await getBarcodeScanner();
          const decoded = await scanBarcodeFromImage(dataUrl);
          if (decoded && (decoded.text || decoded.content)) {
            stopLiveCamera();
            applyBarcodeResult({ content: decoded.text || decoded.content, format: decoded.format || 'CODE_128' });
          }
        }, 450);
      } catch (err) {
        stopLiveCamera();
        showToast(`無法啟動相機：${err.message || '權限遭拒'}`, 'error');
      }
    });

    const scanAndApplyBarcode = async (scanSource, { allowPick = false } = {}) => {
      if (!scanSource) return false;
      showToast('正在辨識條碼...');
      const { scanMultipleBarcodesFromImage } = await getBarcodeScanner();
      const preferredFormat = root.querySelector('#barcode-format')?.value || '';
      const results = await scanMultipleBarcodesFromImage(scanSource, { preferredFormat });
      if (!results.length) {
        showToast('未找到條碼', 'error');
        return false;
      }

      let selected = results[0];
      if (allowPick && results.length > 1) {
        const picked = await this.pickBarcodeResult(results);
        if (!picked) return false;
        selected = picked;
      }

      applyBarcodeResult(selected);
      return true;
    };

    const applyTemplate = (template, { showAppliedToast = true, preserveMedia = false } = {}) => {
      if (!template) return;

      root.querySelector('#product-name').value = template.productName || '';
      root.querySelector('#serial').value = template.serial || '';
      root.querySelector('#expiry').value = formatExpiryText(template.expiry || defaultExpiry);
      lastValidExpiry = root.querySelector('#expiry').value;
      root.querySelector('#tags').value = tagsToText(template.tags || []);
      root.querySelector('#barcode-format').value = template.barcodeFormat || '';
      updateDuplicateSerialHint();
      syncQuickTagState();
      if (template.image && !(preserveMedia && imageData)) {
        imageData = template.image;
        if (thumbImagePreview) thumbImagePreview.src = template.image;
        thumbImageWrap?.classList.remove('hidden');
      }
      if (template.redeemUrlPresetId) {
        root.querySelector('#redeem-url-preset').value = template.redeemUrlPresetId;
        const preset = (this.app.state.settings.redeemUrlPresets || []).find((p) => p.id === template.redeemUrlPresetId);
        if (preset) root.querySelector('#redeem-url').value = preset.url || '';
      } else {
        root.querySelector('#redeem-url-preset').value = '';
      }
      if (showAppliedToast) showToast('已套用範本', 'success');
    };

    root.querySelector('#template-id')?.addEventListener('change', async (event) => {
      const id = event.target.value;
      this.app.state.settings = {
        ...this.app.state.settings,
        defaultTemplateId: id,
      };
      await this.app.persistSettings();

      if (!id) {
        showToast('已改為不套用預設範本', 'success');
        return;
      }

      const tpl = this.app.state.templates.find((t) => t.id === id);
      if (!tpl) {
        showToast('找不到此範本，已取消預設', 'error');
        return;
      }

      applyTemplate(tpl);
    });

    const savedDefaultTemplateId = editing ? '' : this.app.state.settings.defaultTemplateId || '';
    const savedDefaultTemplate = savedDefaultTemplateId
      ? this.app.state.templates.find((tpl) => tpl.id === savedDefaultTemplateId)
      : null;
    if (savedDefaultTemplate) {
      root.querySelector('#template-id').value = savedDefaultTemplate.id;
      applyTemplate(savedDefaultTemplate, { showAppliedToast: false });
    } else if (savedDefaultTemplateId) {
      this.app.state.settings = {
        ...this.app.state.settings,
        defaultTemplateId: '',
      };
      this.app.persistSettings();
    }
    // 編輯既有票券：有自己的原圖但還沒有序號時，自動從原圖抓一次序號。
    // 新票券套範本帶入的是範本的圖，不掃，避免抓到範本來源票券的序號。
    if (editing && originalImage && !(serialInput?.value || '').trim()) {
      scanAndApplyBarcode(originalImage, { quiet: true });
    }

    // Title rule: when the product name contains 85度C, auto-apply the
    // default template. The typed name and serial are preserved (they are
    // per-voucher); the template fills expiry, tags, barcode format,
    // thumbnail and redeem URL. Fires once per match and re-arms when the
    // title no longer contains the keyword.
    const productNameInput = root.querySelector('#product-name');
    let titleTemplateApplied = (productNameInput?.value || '').includes(TITLE_AUTO_TEMPLATE_KEYWORD);
    productNameInput?.addEventListener('input', () => {
      const matches = (productNameInput.value || '').includes(TITLE_AUTO_TEMPLATE_KEYWORD);
      if (!matches) {
        titleTemplateApplied = false;
        return;
      }
      if (titleTemplateApplied) return;
      const template = findTitleAutoTemplate(this.app.state.templates, this.app.state.settings.defaultTemplateId);
      if (!template) return;
      titleTemplateApplied = true;
      const typedName = productNameInput.value;
      const typedSerial = root.querySelector('#serial')?.value || '';
      applyTemplate(template, { showAppliedToast: false, preserveMedia: true });
      productNameInput.value = typedName;
      const serialInput = root.querySelector('#serial');
      if (serialInput) serialInput.value = typedSerial;
      const templateSelect = root.querySelector('#template-id');
      if (templateSelect) templateSelect.value = template.id;
      showToast('標題含 85度C，已自動套用預設範本', 'success');
    });

    root.querySelector('#redeem-url-preset')?.addEventListener('change', (event) => {
      const presetId = event.target.value;
      if (!presetId) return;
      const preset = (this.app.state.settings.redeemUrlPresets || []).find((p) => p.id === presetId);
      if (!preset) return;
      root.querySelector('#redeem-url').value = preset.url || '';
      showToast(`已套用預設網址：${preset.label}`, 'success');
    });

    root.querySelectorAll('[data-quick-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.quickTag;
        if (!tag) return;
        const tags = new Set(parseTags(tagsInput?.value || ''));
        if (tags.has(tag)) tags.delete(tag);
        else tags.add(tag);
        if (tagsInput) {
          tagsInput.value = tagsToText([...tags]);
        }
        syncQuickTagState();
      });
    });

    const addCustomTag = () => {
      const tag = (customTagInput?.value || '').trim();
      if (!tag) return;
      const tags = new Set(parseTags(tagsInput?.value || ''));
      tags.add(tag);
      if (tagsInput) tagsInput.value = tagsToText([...tags]);
      if (customTagInput) customTagInput.value = '';
      syncQuickTagState();
    };

    addCustomTagButton?.addEventListener('click', addCustomTag);
    customTagInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addCustomTag();
      }
    });
    selectedTagsPreview?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-tag]');
      if (!button) return;
      const tag = button.dataset.removeTag;
      const tags = parseTags(tagsInput?.value || '').filter((item) => item !== tag);
      if (tagsInput) tagsInput.value = tagsToText(tags);
      syncQuickTagState();
    });

    thumbImageInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        imageData = await compressImage(file, 'thumbnail');
        if (thumbImagePreview) thumbImagePreview.src = imageData;
        thumbImageWrap?.classList.remove('hidden');
      } catch (error) {
        showToast(`圖片處理失敗：${error.message}`, 'error');
      }
    });

    originalImageInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        originalImage = await compressImage(file, 'original');
        originalImageFromTemplate = false;
        if (originalImagePreview) originalImagePreview.src = originalImage;
        originalImageWrap?.classList.remove('hidden');
        await scanAndApplyBarcode(originalImage);
      } catch (error) {
        showToast(`原圖處理失敗：${error.message}`, 'error');
      }
    });

    const batchProductImageInput = root.querySelector('#batch-product-image-file');
    const batchProductImagePreview = root.querySelector('#batch-product-image-preview');
    const batchProductImageWrap = root.querySelector('#batch-product-image-preview-wrap');
    batchProductImageInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        batchProductImage = await compressImage(file, 'original');
        if (batchProductImagePreview) batchProductImagePreview.src = batchProductImage;
        batchProductImageWrap?.classList.remove('hidden');
        showToast('商品圖已載入，儲存後會替換名稱上方圖案', 'success');
      } catch (error) {
        showToast(`商品圖處理失敗：${error.message}`, 'error');
      } finally {
        event.target.value = '';
      }
    });

    root.querySelector('#batch-product-image-clear-btn')?.addEventListener('click', () => {
      batchProductImage = '';
      if (batchProductImageInput) batchProductImageInput.value = '';
      if (batchProductImagePreview) batchProductImagePreview.src = '';
      batchProductImageWrap?.classList.add('hidden');
      showToast('已清除自訂商品圖，會恢復版型原圖', 'success');
    });

    root.querySelector('#thumb-image-clear-btn')?.addEventListener('click', () => {
      imageData = '';
      if (thumbImageInput) thumbImageInput.value = '';
      if (thumbImagePreview) thumbImagePreview.src = '';
      thumbImageWrap?.classList.add('hidden');
      showToast('已清除縮圖', 'success');
    });

    root.querySelector('#original-image-clear-btn')?.addEventListener('click', () => {
      originalImage = '';
      originalImageFromTemplate = false;
      if (originalImageInput) originalImageInput.value = '';
      if (originalImagePreview) originalImagePreview.src = '';
      originalImageWrap?.classList.add('hidden');
      showToast('已清除原圖', 'success');
    });

    root.querySelector('#scan-barcode-btn')?.addEventListener('click', async () => {
      if (!originalImage && !imageData) {
        showToast('請先選擇原圖或縮圖', 'error');
        return;
      }

      const scanSource = originalImage || imageData;
      await scanAndApplyBarcode(scanSource, { allowPick: true });
    });

    root.querySelector('#save-template-btn')?.addEventListener('click', async () => {
      const productName = root.querySelector('#product-name').value.trim();
      if (!productName) {
        showToast('請先輸入票券名稱', 'error');
        return;
      }

      const label = window.prompt('範本名稱', `${productName} 範本`);
      if (!label) return;
      const normalizedLabel = label.trim();
      if (!normalizedLabel) {
        showToast('範本名稱不可為空', 'error');
        return;
      }
      const existed = this.app.state.templates.some((tpl) => (tpl.label || '').trim().toLowerCase() === normalizedLabel.toLowerCase());
      if (existed) {
        showToast('已有相同名稱範本', 'error');
        return;
      }

      const template = {
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: normalizedLabel,
        productName,
        expiry: parseExpiryText(root.querySelector('#expiry').value) || '',
        tags: parseTags(root.querySelector('#tags').value),
        image: imageData,
        barcodeFormat: root.querySelector('#barcode-format').value || '',
        redeemUrlPresetId: root.querySelector('#redeem-url-preset').value || '',
      };

      this.app.state.templates = [template, ...this.app.state.templates];
      await this.app.persistTemplates();
      showToast('已儲存範本', 'success');
      this.render();
    });

    const clearEditingContext = () => {
      this.app.state.ui.editingTicketId = null;
      this.app.state.ui.editingFromRoute = null;
    };
    root.querySelector('#add-back-link')?.addEventListener('click', clearEditingContext);
    root.querySelector('#add-cancel-link')?.addEventListener('click', clearEditingContext);

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const productName = root.querySelector('#product-name').value.trim();
      const redeemUrl = root.querySelector('#redeem-url').value.trim();

      if (!productName) {
        showToast('票券名稱必填', 'error');
        return;
      }

      const serial = root.querySelector('#serial').value.trim();
      const expiryRaw = root.querySelector('#expiry').value.trim();
      if (expiryRaw && !parseExpiryText(expiryRaw)) {
        showToast('到期日格式錯誤，請輸入 YYYY/MM/DD', 'error');
        return;
      }
      const expiry = parseExpiryText(expiryRaw) || '';
      const selectedBatchProductImage = batchProductImage || batchProductImagePreview?.src || '';
      if (serial && isDuplicateSerial(serial)) {
        const ok = window.confirm('此序號已存在於其他票券，仍要繼續儲存嗎？');
        if (!ok) return;
      }

      if (editing?.tags?.includes('批量生成')) {
        try {
          imageData = await renderBatchTicketImage(undefined, productName, serial, expiry, selectedBatchProductImage);
        } catch (error) {
          showToast(`兌換圖片重新產生失敗：${error.message}`, 'error');
          return;
        }
      }

      let generatedOriginalImage = false;
      const generationMode = ticketImageGenerationMode({
        borrowed: originalImageFromTemplate,
        hasOriginalImage: !!originalImage,
        serial,
        productName,
        isBatchEditing: (editing?.tags || []).includes('批量生成'),
      });
      if (generationMode) {
        try {
          originalImage = await renderBatchTicketImage(undefined, productName, serial, expiry, '');
          generatedOriginalImage = true;
        } catch (error) {
          console.warn('個人化票券圖片產生失敗，沿用範本原圖', error);
        }
      }

      const payload = {
        id: editing?.id || generateId(),
        productName,
        serial,
        expiry,
        image: imageData,
        originalImage,
        images: imageData ? [imageData] : (editing?.images || []),
        batchProductImage: editing?.tags?.includes('批量生成') ? selectedBatchProductImage : (editing?.batchProductImage || ''),
        batchImageVersion: editing?.tags?.includes('批量生成') ? BATCH_IMAGE_VERSION : (editing?.batchImageVersion || 0),
        tags: parseTags(root.querySelector('#tags').value),
        note: editing?.note || '',
        barcodeFormat: root.querySelector('#barcode-format').value || '',
        completed: editing?.completed || false,
        completedAt: editing?.completedAt,
        isDeleted: editing?.isDeleted || false,
        deletedAt: editing?.deletedAt,
        createdAt: editing?.createdAt || Date.now(),
        redeemUrl,
        // 置頂只適用於未使用票券。
        pinned: !editing?.completed && !editing?.isDeleted && !!root.querySelector('#ticket-pinned')?.checked,
      };

      if (editing) {
        this.app.state.tasks = this.app.state.tasks.map((item) => item.id === editing.id ? payload : item);
      } else {
        this.app.state.tasks = [payload, ...this.app.state.tasks];
      }

      await this.app.persistTasks();
      this.app.state.ui.editingTicketId = null;
      const nextRoute = editing ? (this.app.state.ui.editingFromRoute || 'active') : 'active';
      const nextRouteLabel = nextRoute === 'completed' ? '已使用' : nextRoute === 'deleted' ? '回收桶' : '待使用';
      this.app.state.ui.editingFromRoute = null;
      showToast(editing ? `票券已更新，已返回${nextRouteLabel}` : '票券已新增', 'success');
      window.location.hash = nextRoute;
    });

    serialInput?.addEventListener('input', updateDuplicateSerialHint);
    updateDuplicateSerialHint();
    syncQuickTagState();
  }
}
