import { escapeHtml, checkIsExpiringSoon, showToast } from '../utils.js';
import { renderBarcodeCanvas, renderQrCanvas } from '../services/barcodeService.js';
import { playScanSuccessSound } from '../services/omniCoreService.js';

export class CheckoutPage {
  constructor(app) {
    this.app = app;
    this.selectedIds = new Set();
    this.currentSlideIndex = 0;
    this.viewMode = 'standard'; // 'standard' | 'original'
    this.initializedSelection = false;
  }

  getActiveTickets() {
    const tasks = Array.isArray(this.app.state.tasks) ? this.app.state.tasks : [];
    const notifyDays = Number(this.app.state.settings?.notifyDays || 7);
    return tasks
      .filter((t) => !t.completed && !t.isDeleted)
      .sort((a, b) => {
        if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
        const aExp = checkIsExpiringSoon(a.expiry, notifyDays);
        const bExp = checkIsExpiringSoon(b.expiry, notifyDays);
        if (aExp !== bExp) return aExp ? -1 : 1;
        const aTime = a.expiry ? new Date(a.expiry.replace(/[.\-]/g, '/')).getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = b.expiry ? new Date(b.expiry.replace(/[.\-]/g, '/')).getTime() : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      });
  }

  getEnabledQuickPasses() {
    const passes = Array.isArray(this.app.state.settings?.quickPasses)
      ? this.app.state.settings.quickPasses
      : [];
    return passes.filter((p) => p && p.enabled && String(p.code || '').trim());
  }

  ensureSelectionInitialized(activeTickets) {
    const validIds = new Set(activeTickets.map((t) => t.id));
    for (const id of [...this.selectedIds]) {
      if (!validIds.has(id)) this.selectedIds.delete(id);
    }
    if (!this.initializedSelection && activeTickets.length > 0) {
      const notifyDays = Number(this.app.state.settings?.notifyDays || 7);
      const priority = activeTickets.filter((t) => t.pinned || checkIsExpiringSoon(t.expiry, notifyDays));
      const initialList = (priority.length > 0 ? priority : activeTickets).slice(0, 6);
      initialList.forEach((t) => this.selectedIds.add(t.id));
      this.initializedSelection = true;
    }
  }

  buildDeck(activeTickets) {
    const deck = [];
    const quickPasses = this.getEnabledQuickPasses();
    for (const qp of quickPasses) {
      deck.push({
        kind: 'quick-pass',
        id: qp.id,
        title: qp.label || '常用條碼',
        serial: qp.code,
        barcodeFormat: qp.format || 'CODE_128',
        subtitle: '結帳前置條碼（載具 / 會員）',
      });
    }
    for (const ticket of activeTickets) {
      if (this.selectedIds.has(ticket.id)) {
        deck.push({
          kind: 'ticket',
          id: ticket.id,
          ticket,
          title: ticket.productName || '未命名票券',
          serial: ticket.serial || '',
          barcodeFormat: ticket.barcodeFormat || 'CODE_128',
          subtitle: ticket.expiry ? `有效期限：${ticket.expiry}` : '無到期日限制',
        });
      }
    }
    return deck;
  }

  async render() {
    const container = document.getElementById('app-container');
    if (!container) return;

    const activeTickets = this.getActiveTickets();
    this.ensureSelectionInitialized(activeTickets);
    const deck = this.buildDeck(activeTickets);
    if (this.currentSlideIndex >= deck.length) {
      this.currentSlideIndex = Math.max(0, deck.length - 1);
    }
    const currentSlide = deck[this.currentSlideIndex] || null;

    container.innerHTML = `
      <div class="page max-w-2xl mx-auto px-4 pt-3 pb-28 space-y-4">
        <div class="omni-hero-card rounded-2xl p-4 text-white shadow-xl">
          <div class="flex items-center justify-between gap-2">
            <div>
              <span class="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white/15 text-indigo-100">
                <i class="fa-solid fa-bolt"></i> OmniPass Checkout Deck
              </span>
              <h1 class="text-xl font-extrabold mt-1 tracking-tight">結帳連刷模式</h1>
              <p class="text-xs text-indigo-100/90 mt-0.5">先刷載具/會員，再左右滑動連刷票券，一鍵核銷自動跳下一張</p>
            </div>
            <div class="text-right">
              <div class="text-2xl font-black tabular-nums">${deck.length}</div>
              <div class="text-[11px] text-indigo-200">連刷佇列</div>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between gap-2 rounded-xl bg-amber-400/20 border border-amber-300/35 px-3 py-2 text-xs text-amber-100 font-semibold">
            <span>💡 建議將手機螢幕亮度調至最高，以加快門市掃碼槍辨識速度</span>
            <button type="button" id="checkout-ToggleMode" class="shrink-0 px-2.5 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold transition">
              ${this.viewMode === 'original' ? '切換標準條碼' : '優先顯示原圖'}
            </button>
          </div>
        </div>

        ${currentSlide ? `
          <div id="checkout-slide-card" class="bg-white rounded-3xl p-5 shadow-2xl border border-slate-200 select-none relative overflow-hidden">
            <div class="flex items-center justify-between gap-2 mb-3">
              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-extrabold ${currentSlide.kind === 'quick-pass' ? 'bg-emerald-100 text-emerald-800' : 'bg-indigo-100 text-indigo-800'}">
                <i class="fa-solid ${currentSlide.kind === 'quick-pass' ? 'fa-id-card' : 'fa-ticket'}"></i>
                ${currentSlide.kind === 'quick-pass' ? '前置條碼' : `票券 ${this.currentSlideIndex + 1} / ${deck.length}`}
              </span>
              <div class="flex items-center gap-1.5">
                <button type="button" id="checkout-prev-btn" class="h-8 w-8 rounded-full border border-slate-300 bg-slate-50 text-slate-700 disabled:opacity-40" ${this.currentSlideIndex <= 0 ? 'disabled' : ''} aria-label="上一張">
                  <i class="fa-solid fa-chevron-left text-xs"></i>
                </button>
                <span class="text-xs font-bold text-slate-600 tabular-nums px-1">${this.currentSlideIndex + 1} / ${deck.length}</span>
                <button type="button" id="checkout-next-btn" class="h-8 w-8 rounded-full border border-slate-300 bg-slate-50 text-slate-700 disabled:opacity-40" ${this.currentSlideIndex >= deck.length - 1 ? 'disabled' : ''} aria-label="下一張">
                  <i class="fa-solid fa-chevron-right text-xs"></i>
                </button>
              </div>
            </div>

            <h2 class="text-lg font-extrabold text-slate-900 leading-snug">${escapeHtml(currentSlide.title)}</h2>
            <p class="text-xs font-semibold text-slate-500 mt-0.5">${escapeHtml(currentSlide.subtitle)}</p>

            ${currentSlide.kind === 'ticket' && (this.viewMode === 'original' && (currentSlide.ticket.originalImage || currentSlide.ticket.image)) ? `
              <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-2 flex justify-center">
                <img src="${currentSlide.ticket.originalImage || currentSlide.ticket.image}" alt="${escapeHtml(currentSlide.title)}" class="max-h-[420px] w-auto object-contain rounded-xl" />
              </div>
            ` : `
              <div class="mt-4 rounded-2xl border-2 border-slate-200 bg-white p-4 flex flex-col items-center justify-center space-y-3">
                ${currentSlide.serial ? `
                  <canvas id="checkout-barcode-canvas" class="max-w-full h-auto"></canvas>
                  ${currentSlide.kind === 'ticket' ? `
                    <canvas id="checkout-qr-canvas" class="mt-2 rounded-xl border border-slate-100 p-1"></canvas>
                  ` : ''}
                  <div class="flex items-center gap-2 pt-1">
                    <code class="text-sm font-black tracking-wider text-slate-900 bg-slate-100 px-3 py-1 rounded-lg">${escapeHtml(currentSlide.serial)}</code>
                    <button type="button" id="checkout-copy-serial" class="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100">
                      <i class="fa-regular fa-copy mr-1"></i>複製
                    </button>
                  </div>
                ` : `
                  <div class="py-8 text-center text-slate-400 text-sm">此張票券未設定條碼序號，請切換「優先顯示原圖」檢視截圖</div>
                `}
              </div>
            `}

            <div class="mt-4 flex flex-wrap items-center gap-2">
              ${currentSlide.kind === 'ticket' ? `
                <button type="button" id="checkout-redeem-next" class="flex-1 min-w-[160px] py-3 px-4 rounded-xl font-extrabold text-white text-sm shadow-lg" style="background: linear-gradient(135deg, #16b889, #0b956e);">
                  <i class="fa-solid fa-circle-check mr-1.5"></i>核銷此張並跳下一張
                </button>
                ${currentSlide.ticket.redeemUrl ? `
                  <a href="${escapeHtml(currentSlide.ticket.redeemUrl)}" target="_blank" rel="noopener noreferrer" class="py-3 px-4 rounded-xl font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 text-sm">
                    <i class="fa-solid fa-up-right-from-square mr-1"></i>外部兌換連結
                  </a>
                ` : ''}
              ` : `
                <button type="button" id="checkout-beep-next" class="flex-1 py-3 px-4 rounded-xl font-extrabold text-white text-sm shadow-lg" style="background: linear-gradient(135deg, #536dfe, #3656db);">
                  <i class="fa-solid fa-forward-step mr-1.5"></i>已刷載具/會員，跳下一張
                </button>
              `}
            </div>
          </div>
        ` : `
          <div class="bg-white/95 rounded-2xl p-6 text-center border border-slate-200 shadow-lg">
            <div class="text-2xl mb-2">🛒</div>
            <div class="font-extrabold text-slate-800">尚未勾選要連刷的票券</div>
            <p class="text-xs text-slate-500 mt-1">請從下方待使用票券清單勾選本次結帳要使用的票券，或至「設定」啟用手機載具條碼。</p>
          </div>
        `}

        <div class="bg-white/95 rounded-2xl p-4 border border-slate-200 shadow-lg space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <h3 class="text-sm font-extrabold text-slate-900">勾選本次結帳連刷票券 (${this.selectedIds.size} / ${activeTickets.length})</h3>
              <p class="text-[11px] text-slate-500">預設自動帶入置頂與即將到期票券，可隨時增減</p>
            </div>
            <div class="flex items-center gap-1.5">
              <button type="button" id="checkout-select-all" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">全選</button>
              <button type="button" id="checkout-select-clear" class="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">清空</button>
            </div>
          </div>

          <div class="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            ${activeTickets.length ? activeTickets.map((t) => {
              const checked = this.selectedIds.has(t.id);
              return `
                <label class="flex items-center justify-between gap-3 py-2.5 px-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <input type="checkbox" data-checkout-ticket="${escapeHtml(t.id)}" ${checked ? 'checked' : ''} class="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    <div class="min-w-0">
                      <div class="text-xs font-bold text-slate-900 truncate">
                        ${t.pinned ? '<span class="text-amber-600 mr-1">📌</span>' : ''}${escapeHtml(t.productName)}
                      </div>
                      <div class="text-[11px] text-slate-500 truncate">
                        ${t.serial ? `序號: ${escapeHtml(t.serial)}` : '無序號（原圖）'} ${t.expiry ? `· 期限: ${escapeHtml(t.expiry)}` : ''}
                      </div>
                    </div>
                  </div>
                  ${t.originalImage ? '<span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">原圖</span>' : ''}
                </label>
              `;
            }).join('') : `
              <div class="py-6 text-center text-xs text-slate-400">目前沒有待使用票券，請先新增或掃描票券</div>
            `}
          </div>
        </div>
      </div>
    `;

    if (currentSlide && currentSlide.serial) {
      const barcodeCanvas = document.getElementById('checkout-barcode-canvas');
      if (barcodeCanvas) {
        await renderBarcodeCanvas(barcodeCanvas, currentSlide.serial, currentSlide.barcodeFormat || 'CODE_128');
      }
      const qrCanvas = document.getElementById('checkout-qr-canvas');
      if (qrCanvas) {
        await renderQrCanvas(qrCanvas, currentSlide.serial, 156);
      }
    }

    this.bindEvents(activeTickets, deck, currentSlide);
  }

  bindEvents(activeTickets, deck, currentSlide) {
    document.getElementById('checkout-ToggleMode')?.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'original' ? 'standard' : 'original';
      this.render();
    });

    document.getElementById('checkout-prev-btn')?.addEventListener('click', () => {
      if (this.currentSlideIndex > 0) {
        this.currentSlideIndex -= 1;
        this.render();
      }
    });

    document.getElementById('checkout-next-btn')?.addEventListener('click', () => {
      if (this.currentSlideIndex < deck.length - 1) {
        this.currentSlideIndex += 1;
        this.render();
      }
    });

    document.getElementById('checkout-beep-next')?.addEventListener('click', () => {
      playScanSuccessSound(this.app.state.settings?.scanSuccessSound || 'market');
      if (this.currentSlideIndex < deck.length - 1) {
        this.currentSlideIndex += 1;
      }
      this.render();
    });

    document.getElementById('checkout-copy-serial')?.addEventListener('click', async () => {
      if (!currentSlide?.serial) return;
      try {
        await navigator.clipboard.writeText(currentSlide.serial);
        showToast('已複製條碼序號', 'success');
      } catch {
        showToast(`序號：${currentSlide.serial}`, 'info');
      }
    });

    document.getElementById('checkout-redeem-next')?.addEventListener('click', async () => {
      if (!currentSlide || currentSlide.kind !== 'ticket') return;
      const ticket = currentSlide.ticket;
      ticket.completed = true;
      ticket.completedAt = Date.now();
      ticket.pinned = false;
      this.selectedIds.delete(ticket.id);
      playScanSuccessSound(this.app.state.settings?.scanSuccessSound || 'market');
      await this.app.persistState({ tasks: this.app.state.tasks });
      this.app.updateNavVisibility?.();
      showToast(`已核銷「${ticket.productName}」`, 'success');
      this.render();
    });

    document.getElementById('checkout-select-all')?.addEventListener('click', () => {
      activeTickets.forEach((t) => this.selectedIds.add(t.id));
      this.currentSlideIndex = 0;
      this.render();
    });

    document.getElementById('checkout-select-clear')?.addEventListener('click', () => {
      this.selectedIds.clear();
      this.currentSlideIndex = 0;
      this.render();
    });

    document.querySelectorAll('[data-checkout-ticket]').forEach((checkbox) => {
      checkbox.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-checkout-ticket');
        if (!id) return;
        if (e.target.checked) {
          this.selectedIds.add(id);
        } else {
          this.selectedIds.delete(id);
        }
        this.render();
      });
    });

    // Touch swipe left/right on slide card
    const slideCard = document.getElementById('checkout-slide-card');
    if (slideCard) {
      let startX = 0;
      let startY = 0;
      slideCard.addEventListener('touchstart', (e) => {
        startX = e.touches[0]?.clientX || 0;
        startY = e.touches[0]?.clientY || 0;
      }, { passive: true });
      slideCard.addEventListener('touchend', (e) => {
        const dx = (e.changedTouches[0]?.clientX || 0) - startX;
        const dy = (e.changedTouches[0]?.clientY || 0) - startY;
        if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
          if (dx < 0 && this.currentSlideIndex < deck.length - 1) {
            this.currentSlideIndex += 1;
            this.render();
          } else if (dx > 0 && this.currentSlideIndex > 0) {
            this.currentSlideIndex -= 1;
            this.render();
          }
        }
      }, { passive: true });
    }
  }
}

